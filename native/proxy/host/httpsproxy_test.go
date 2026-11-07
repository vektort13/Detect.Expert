package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"io"
	"math/big"
	"net"
	"sync"
	"testing"
	"time"
)

// testPKI is a throw-away certificate authority; leaf certificates are issued from it for the fake HTTPS proxies.
type testPKI struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	pool *x509.CertPool
}

func newTestPKI(t *testing.T, name string) *testPKI {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: name},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return &testPKI{cert: cert, key: key, pool: pool}
}

func (p *testPKI) leaf(t *testing.T, dns []string, ips []net.IP, notBefore, notAfter time.Time) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: "proxy"},
		DNSNames: dns, IPAddresses: ips, NotBefore: notBefore, NotAfter: notAfter,
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, p.cert, &key.PublicKey, p.key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

// validLeaf is valid now, for 127.0.0.1 and the name "localhost".
func (p *testPKI) validLeaf(t *testing.T) tls.Certificate {
	return p.leaf(t, []string{"localhost"}, []net.IP{net.ParseIP("127.0.0.1")}, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
}

// trust makes pool the trust store of https upstreams for one test (nil is the system pool).
func trust(t *testing.T, pool *x509.CertPool) {
	t.Helper()
	old := upstreamRoots.Load()
	upstreamRoots.Store(pool)
	t.Cleanup(func() { upstreamRoots.Store(old) })
}

// mapLocalhost lets a profile name "localhost" while the fake proxy listens on 127.0.0.1 only, whatever the resolver prefers.
func mapLocalhost(t *testing.T) {
	t.Helper()
	old := dialer.Load()
	mapped := dialFunc(func(ctx context.Context, address string, deadline time.Time) (net.Conn, error) {
		if host, port, err := net.SplitHostPort(address); err == nil && host == "localhost" {
			address = net.JoinHostPort("127.0.0.1", port)
		}
		return (*old)(ctx, address, deadline)
	})
	dialer.Store(&mapped)
	t.Cleanup(func() { dialer.Store(old) })
}

// hello records what the client offered in its ClientHello.
type hello struct {
	mu          sync.Mutex
	serverNames []string
	versions    [][]uint16
	protocols   [][]string
}

func (h *hello) config(cert tls.Certificate, delay time.Duration) *tls.Config {
	return &tls.Config{Certificates: []tls.Certificate{cert}, GetConfigForClient: func(info *tls.ClientHelloInfo) (*tls.Config, error) {
		h.mu.Lock()
		h.serverNames = append(h.serverNames, info.ServerName)
		h.versions = append(h.versions, info.SupportedVersions)
		h.protocols = append(h.protocols, info.SupportedProtos)
		h.mu.Unlock()
		time.Sleep(delay)
		return nil, nil
	}}
}

func tlsProxy(t *testing.T, config *tls.Config, reply func(c net.Conn, seen connectSeen)) (*net.TCPAddr, <-chan connectSeen) {
	t.Helper()
	listener, err := tls.Listen("tcp4", "127.0.0.1:0", config)
	if err != nil {
		t.Fatal(err)
	}
	return listener.Addr().(*net.TCPAddr), serveProxy(t, listener, reply)
}

func httpsClientProfile(host string, addr *net.TCPAddr, username, password string) profile {
	return profile{Type: "https", Host: host, Port: addr.Port, Username: username, Password: password}
}

func TestHTTPSUpstreamTunnelsOverAVerifiedConnection(t *testing.T) {
	pki := newTestPKI(t, "test CA")
	trust(t, pki.pool)
	var seenHello hello
	addr, seen := tlsProxy(t, seenHello.config(pki.validLeaf(t), 0), func(c net.Conn, _ connectSeen) {
		io.WriteString(c, "HTTP/1.1 200 Connection established\r\n\r\n220 banner behind the header\r\n")
		io.Copy(c, c)
	})
	c, err := httpConnect(context.Background(), httpsClientProfile("127.0.0.1", addr, "alice", "s3cr:et"), "must-stay-remote.invalid:443")
	if err != nil {
		t.Fatalf("a proxy with a certificate from a trusted CA was refused: %v", err)
	}
	defer c.Close()
	got := nextSeen(t, seen)
	if want := "CONNECT must-stay-remote.invalid:443 HTTP/1.1\r\nHost: must-stay-remote.invalid:443\r\nProxy-Authorization: Basic YWxpY2U6czNjcjpldA==\r\n\r\n"; got.raw != want {
		t.Fatalf("request over TLS: %q", got.raw)
	}
	banner := make([]byte, len("220 banner behind the header\r\n"))
	if _, err = io.ReadFull(c, banner); err != nil || string(banner) != "220 banner behind the header\r\n" {
		t.Fatalf("server-first bytes behind the header: %q, %v", banner, err)
	}
	c.Write([]byte("through TLS"))
	closeWrite(c) // close_notify: the TLS form of a half-close
	if echoed, err := io.ReadAll(c); err != nil || string(echoed) != "through TLS" {
		t.Fatalf("tunnel data %q, %v", echoed, err)
	}
	seenHello.mu.Lock()
	defer seenHello.mu.Unlock()
	for _, versions := range seenHello.versions {
		for _, version := range versions {
			if version < tls.VersionTLS12 && version&0x0f0f != 0x0a0a { // GREASE values are not versions
				t.Fatalf("the client offered protocol version %#x", version)
			}
		}
	}
	for _, protocols := range seenHello.protocols {
		if len(protocols) != 1 || protocols[0] != "http/1.1" {
			t.Fatalf("the client offered ALPN %v although only HTTP/1.1 is spoken", protocols)
		}
	}
}

func TestHTTPSUpstreamSendsServerNameForNamesAndNoneForIPs(t *testing.T) {
	pki := newTestPKI(t, "test CA")
	trust(t, pki.pool)
	mapLocalhost(t)
	for _, tc := range []struct {
		host string
		want string
	}{{"localhost", "localhost"}, {"127.0.0.1", ""}} {
		t.Run(tc.host, func(t *testing.T) {
			var seenHello hello
			addr, _ := tlsProxy(t, seenHello.config(pki.validLeaf(t), 0), echoTunnel)
			c, err := httpConnect(context.Background(), httpsClientProfile(tc.host, addr, "", ""), "destination.invalid:443")
			if err != nil {
				t.Fatal(err)
			}
			c.Close()
			seenHello.mu.Lock()
			defer seenHello.mu.Unlock()
			if len(seenHello.serverNames) != 1 || seenHello.serverNames[0] != tc.want {
				t.Fatalf("SNI %q, want %q", seenHello.serverNames, tc.want)
			}
		})
	}
}

func TestHTTPSUpstreamRefusesCertificatesItCannotVerify(t *testing.T) {
	good := newTestPKI(t, "trusted CA")
	other := newTestPKI(t, "unrelated CA")
	now := time.Now()
	loopback := []net.IP{net.ParseIP("127.0.0.1")}
	mapLocalhost(t)
	for _, tc := range []struct {
		name string
		pool *x509.CertPool
		cert tls.Certificate
		host string
	}{
		{"CA is not in the trust store", nil, good.validLeaf(t), "127.0.0.1"},
		{"signed by an unrelated CA", good.pool, other.validLeaf(t), "127.0.0.1"},
		{"certificate is for another name", good.pool, good.leaf(t, []string{"other.test"}, nil, now.Add(-time.Hour), now.Add(time.Hour)), "localhost"},
		{"certificate is for another IP", good.pool, good.leaf(t, nil, []net.IP{net.ParseIP("192.0.2.1")}, now.Add(-time.Hour), now.Add(time.Hour)), "127.0.0.1"},
		{"expired", good.pool, good.leaf(t, nil, loopback, now.Add(-48*time.Hour), now.Add(-24*time.Hour)), "127.0.0.1"},
		{"not yet valid", good.pool, good.leaf(t, nil, loopback, now.Add(24*time.Hour), now.Add(48*time.Hour)), "127.0.0.1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			trust(t, tc.pool)
			addr, seen := tlsProxy(t, &tls.Config{Certificates: []tls.Certificate{tc.cert}}, echoTunnel)
			c, err := httpConnect(context.Background(), httpsClientProfile(tc.host, addr, "alice", "s3cr:et"), "destination.invalid:443")
			if c != nil {
				c.Close()
				t.Fatal("the tunnel opened over an unverified connection")
			}
			wantDiagnostic(t, err, "tls-failed", "tls", false)
			noRequest(t, seen) // credentials must never be sent before the certificate has been verified
		})
	}
}

func TestHTTPSUpstreamRefusesPeersThatAreNotTLS(t *testing.T) {
	trust(t, nil)
	t.Run("a plain HTTP server on the port", func(t *testing.T) {
		addr := listenLoopback(t, func(c net.Conn) {
			io.ReadFull(c, make([]byte, 5))
			io.WriteString(c, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
		})
		_, err := httpConnect(context.Background(), httpsClientProfile("127.0.0.1", addr, "", ""), "destination.invalid:443")
		wantDiagnostic(t, err, "tls-failed", "tls", false)
	})
	t.Run("a server that hangs up during the handshake", func(t *testing.T) {
		addr := listenLoopback(t, func(c net.Conn) { io.ReadFull(c, make([]byte, 5)) })
		_, err := httpConnect(context.Background(), httpsClientProfile("127.0.0.1", addr, "", ""), "destination.invalid:443")
		wantDiagnostic(t, err, "tls-failed", "tls", false)
	})
	t.Run("a server that only speaks TLS 1.1", func(t *testing.T) {
		pki := newTestPKI(t, "test CA")
		trust(t, pki.pool)
		config := &tls.Config{Certificates: []tls.Certificate{pki.validLeaf(t)}, MinVersion: tls.VersionTLS10, MaxVersion: tls.VersionTLS11}
		addr, _ := tlsProxy(t, config, echoTunnel)
		// Control: this server does speak TLS 1.1 to a client that allows it, so the refusal below is the client's doing.
		control, err := tls.Dial("tcp4", addr.String(), &tls.Config{RootCAs: pki.pool, ServerName: "127.0.0.1", MinVersion: tls.VersionTLS10, MaxVersion: tls.VersionTLS11})
		if err != nil {
			t.Fatalf("the fake TLS 1.1 server is not usable: %v", err)
		}
		if control.ConnectionState().Version != tls.VersionTLS11 {
			t.Fatalf("control negotiated %#x", control.ConnectionState().Version)
		}
		control.Close()
		_, err = httpConnect(context.Background(), httpsClientProfile("127.0.0.1", addr, "", ""), "destination.invalid:443")
		wantDiagnostic(t, err, "tls-failed", "tls", false)
	})
}

func TestHTTPSHandshakeSharesTheDialBudgetAndTheExchangeGetsItsOwn(t *testing.T) {
	pki := newTestPKI(t, "test CA")
	trust(t, pki.pool)
	slowDial := func(delay time.Duration) {
		replaceDialer(t, func(ctx context.Context, address string, deadline time.Time) (net.Conn, error) {
			time.Sleep(delay)
			dialer := net.Dialer{Deadline: deadline}
			return dialer.DialContext(ctx, "tcp", address)
		})
	}
	var slow hello
	addr, _ := tlsProxy(t, slow.config(pki.validLeaf(t), 400*time.Millisecond), func(c net.Conn, _ connectSeen) {
		time.Sleep(300 * time.Millisecond) // the proxy is slow to answer CONNECT as well
		io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n")
	})
	t.Run("connect and handshake together exceed the budget", func(t *testing.T) {
		shortTimeouts(t, 600*time.Millisecond, 2*time.Second)
		slowDial(250 * time.Millisecond) // 250 ms to connect + 400 ms handshake: each fits 600 ms, the sum does not
		_, err := httpConnect(context.Background(), httpsClientProfile("127.0.0.1", addr, "", ""), "destination.invalid:443")
		wantDiagnostic(t, err, "timeout", "tls", true)
	})
	t.Run("the same proxy within a larger budget, and the CONNECT answer has a budget of its own", func(t *testing.T) {
		shortTimeouts(t, 2*time.Second, 600*time.Millisecond)
		slowDial(100 * time.Millisecond)
		// handshake 400 ms + answer 300 ms = 700 ms: more than the exchange budget alone, so the handshake must not count there.
		c, err := httpConnect(context.Background(), httpsClientProfile("127.0.0.1", addr, "", ""), "destination.invalid:443")
		if err != nil {
			t.Fatalf("the handshake time was charged to the CONNECT exchange: %v", err)
		}
		c.Close()
	})
}

func TestRelayTunnelsThroughAnHTTPSProxyAndStartTunnelVerifiesItFirst(t *testing.T) {
	pki := newTestPKI(t, "test CA")
	addr, seen := tlsProxy(t, &tls.Config{Certificates: []tls.Certificate{pki.validLeaf(t)}}, echoTunnel)
	p := httpsClientProfile("127.0.0.1", addr, "alice", "s3cr:et")

	trust(t, nil)
	if tunnel, err := startTunnel(t.TempDir(), p); err == nil {
		tunnel.Close()
		t.Fatal("a tunnel started although the proxy certificate is not trusted")
	} else {
		wantDiagnostic(t, err, "tls-failed", "tls", false)
	}
	noRequest(t, seen)

	trust(t, pki.pool)
	tunnel, err := startTunnel(t.TempDir(), p)
	if err != nil {
		t.Fatal(err)
	}
	c, reply := browserConnect(t, tunnel.relay, 3, domainAddress("must-stay-remote.invalid", 443))
	if !bytes.Equal(reply, []byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}) {
		t.Fatalf("reply %x", reply)
	}
	c.Write([]byte("ping"))
	c.(*net.TCPConn).CloseWrite()
	if echoed, err := io.ReadAll(c); err != nil || string(echoed) != "ping" {
		t.Fatalf("tunnel data %q, %v", echoed, err)
	}
	if got := nextSeen(t, seen); got.line != "CONNECT must-stay-remote.invalid:443 HTTP/1.1" {
		t.Fatalf("the proxy saw %q", got.line)
	}
	tunnel.Close()
	if c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", tunnel.port), 500*time.Millisecond); err == nil {
		c.Close()
		t.Fatal("the relay still listens after the tunnel closed")
	}
}

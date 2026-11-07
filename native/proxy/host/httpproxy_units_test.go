package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"testing"
	"time"
)

func TestConnectAuthorityFromSocksDestinations(t *testing.T) {
	ipv6 := append(append([]byte{0x20, 0x01, 0x0d, 0xb8}, make([]byte, 11)...), 1, 0x01, 0xbb)
	for _, tc := range []struct {
		name    string
		atyp    byte
		address []byte
		want    string
		code    string // empty: no error
	}{
		{"IPv4", 1, []byte{192, 0, 2, 1, 0x01, 0xbb}, "192.0.2.1:443", ""},
		{"IPv6", 4, ipv6, "[2001:db8::1]:443", ""},
		{"domain keeps its case", 3, domainAddress("Example.COM", 8080), "Example.COM:8080", ""},
		{"highest port", 1, []byte{192, 0, 2, 1, 0xff, 0xff}, "192.0.2.1:65535", ""},
		{"port 0", 1, []byte{192, 0, 2, 1, 0, 0}, "", "connection-refused"},
		{"invalid characters in a domain", 3, domainAddress("a b", 443), "", "host-unreachable"},
		{"empty domain (readSocksAddress refuses it first)", 3, []byte{0, 1, 0xbb}, "", "proxy-error"},
		{"declared length does not match", 3, []byte{5, 'a', 'b', 0, 80}, "", "proxy-error"},
		{"IPv4 with the wrong size", 1, []byte{192, 0, 2, 0, 80}, "", "proxy-error"},
		{"unknown address type", 7, []byte{1, 2, 3, 4, 0, 80}, "", "proxy-error"},
		{"too short to hold a port", 1, []byte{1, 2}, "", "proxy-error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := connectAuthority(tc.atyp, tc.address)
			if tc.code == "" {
				if err != nil || got != tc.want {
					t.Fatalf("got %q, %v; want %q", got, err, tc.want)
				}
				return
			}
			if got != "" || safeDiagnostic(err).Code != tc.code {
				t.Fatalf("got %q, %v; want the code %s", got, err, tc.code)
			}
		})
	}
}

func TestHostAuthorityForProbeDestinations(t *testing.T) {
	for _, tc := range []struct {
		host string
		port int
		want string
	}{
		{"example.com", 443, "example.com:443"},
		{"192.0.2.1", 80, "192.0.2.1:80"},
		{"2001:db8::1", 443, "[2001:db8::1]:443"},
		{"[2001:db8::1]", 443, "[2001:db8::1]:443"},
		{"::ffff:192.0.2.1", 443, "[::ffff:192.0.2.1]:443"},
		{"bad host", 80, ""},
		{"a/b", 80, ""},
		{"a:b", 80, ""},
		{"", 80, ""},
		{"example.com", 0, ""},
		{"example.com", 65536, ""},
	} {
		got, err := hostAuthority(tc.host, tc.port)
		if tc.want == "" {
			if err == nil || got != "" {
				t.Errorf("%q:%d accepted as %q", tc.host, tc.port, got)
			} else {
				wantDiagnostic(t, err, "invalid-input", "endpoint", false)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Errorf("%q:%d: got %q, %v; want %q", tc.host, tc.port, got, err, tc.want)
		}
	}
}

func TestValidConnectNameAdmitsOnlyRegNameCharacters(t *testing.T) {
	for _, name := range []string{"a", "example.com", "My_Host.Example.", "xn--bcher-kva.example", "a-b.c-d", "under_score", "a~b", "a!$&'()*+,;=b"} {
		if !validConnectName([]byte(name)) {
			t.Errorf("%q rejected", name)
		}
	}
	for _, name := range []string{"", "a b", "a\tb", "a\rb", "a\nb", "a:b", "a/b", "a?b", "a#b", "a@b", "a[b", "a]b", "a\\b", "a%41", "a<b", "a>b", "a\"b", "a|b", "a^b", "a`b", "a{b", "\x00", "b\xc3\xbccher", string(bytes.Repeat([]byte("a"), 254))} {
		if validConnectName([]byte(name)) {
			t.Errorf("%q accepted", name)
		}
	}
	if !validConnectName(bytes.Repeat([]byte("a"), 253)) {
		t.Error("a 253-byte name is the longest allowed")
	}
}

func TestBufferedConnHalfClosesOnlyWhatCanBeHalfClosed(t *testing.T) {
	client, server := net.Pipe() // a connection without CloseWrite
	defer client.Close()
	defer server.Close()
	if err := (&bufferedConn{Conn: client}).CloseWrite(); err != nil {
		t.Fatalf("a connection that cannot half-close must not fail: %v", err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	got := make(chan error, 1)
	go func() {
		c, err := listener.Accept()
		if err != nil {
			got <- err
			return
		}
		defer c.Close()
		_, err = io.ReadAll(c) // ends only when the peer half-closes
		got <- err
	}()
	tcp, err := net.Dial("tcp4", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer tcp.Close()
	if err = (&bufferedConn{Conn: tcp}).CloseWrite(); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-got:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("CloseWrite did not reach the TCP peer")
	}
}

func TestConnectedTunnelsCarryNoDeadlineOfTheExchange(t *testing.T) {
	// A tunnel may stay idle for far longer than the CONNECT exchange is allowed to take.
	shortTimeouts(t, 2*time.Second, 300*time.Millisecond)
	httpAddr, _ := httpProxy(t, echoTunnel)
	socksAddr, _ := fakeSocksUpstream(t, []byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}, func(c net.Conn) { io.Copy(c, c) })
	for name, open := range map[string]func() (net.Conn, error){
		"http": func() (net.Conn, error) {
			return httpConnect(context.Background(), httpClientProfile(httpAddr, "", ""), "destination.invalid:443")
		},
		"socks5": func() (net.Conn, error) {
			return socksConnect(profile{Type: "socks5", Host: "127.0.0.1", Port: socksAddr.Port}, "destination.invalid", 443)
		},
	} {
		t.Run(name, func(t *testing.T) {
			c, err := open()
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			time.Sleep(600 * time.Millisecond)
			c.Write([]byte("late"))
			back := make([]byte, 4)
			if _, err = io.ReadFull(c, back); err != nil || string(back) != "late" {
				t.Fatalf("the tunnel died with the exchange deadline: %q, %v", back, err)
			}
		})
	}
}

func TestClassifyTLSKeepsTimeoutsAndCancellationApart(t *testing.T) {
	wantDiagnostic(t, classifyTLS(&net.OpError{Op: "read", Net: "tcp", Err: timeoutError{}}), "timeout", "tls", true)
	wantDiagnostic(t, classifyTLS(context.DeadlineExceeded), "timeout", "tls", true)
	wantDiagnostic(t, classifyTLS(context.Canceled), "connection-failed", "tls", true)
	wantDiagnostic(t, classifyTLS(io.EOF), "tls-failed", "tls", false)
}

func TestRelayAnswersAMisbehavingUpstreamAfterTheNegotiation(t *testing.T) {
	// The negotiation succeeds; the CONNECT stage then goes wrong in each way a SOCKS5 server can manage.
	scripted := func(t *testing.T, afterRequest func(c net.Conn)) profile {
		addr := listenLoopback(t, func(c net.Conn) {
			io.ReadFull(c, make([]byte, 3))
			c.Write([]byte{5, 0})
			head := make([]byte, 4)
			io.ReadFull(c, head)
			if _, err := readSocksAddress(c, head[3]); err != nil {
				return
			}
			afterRequest(c)
		})
		return profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port}
	}
	for _, tc := range []struct {
		name  string
		after func(c net.Conn)
		want  byte
	}{
		{"hangs up after the request", func(c net.Conn) {}, 1},
		{"answers with version 4", func(c net.Conn) { c.Write([]byte{4, 0, 0, 1, 0, 0, 0, 0, 0, 0}) }, 1},
		{"success head with an unknown address type", func(c net.Conn) { c.Write([]byte{5, 0, 0, 9, 1, 2, 3}) }, 1},
		{"success head with a truncated address", func(c net.Conn) { c.Write([]byte{5, 0, 0, 1, 0, 0}) }, 1},
		{"success head with a zero-length domain", func(c net.Conn) { c.Write([]byte{5, 0, 0, 3, 0, 0, 0}) }, 1},
		{"never answers the request", func(c net.Conn) { io.Copy(io.Discard, c) }, 6},
	} {
		t.Run(tc.name, func(t *testing.T) {
			shortTimeouts(t, 2*time.Second, 300*time.Millisecond)
			relay, err := startRelay(scripted(t, tc.after))
			if err != nil {
				t.Fatal(err)
			}
			defer relay.Close()
			c, reply := browserConnect(t, relay, 3, domainAddress("destination.invalid", 443))
			if want := []byte{5, tc.want, 0, 1, 0, 0, 0, 0, 0, 0}; !bytes.Equal(reply, want) {
				t.Fatalf("reply %x, want %x", reply, want)
			}
			if rest, _ := io.ReadAll(c); len(rest) != 0 {
				t.Fatalf("the relay kept talking: %x", rest)
			}
		})
	}
}

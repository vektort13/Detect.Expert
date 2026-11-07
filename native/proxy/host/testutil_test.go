package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

// listenLoopback starts an in-process peer; handle runs once per accepted connection, under a 10 s safety deadline.
func listenLoopback(t *testing.T, handle func(net.Conn)) *net.TCPAddr {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		for {
			c, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				c.SetDeadline(time.Now().Add(10 * time.Second))
				handle(c)
			}()
		}
	}()
	return listener.Addr().(*net.TCPAddr)
}

// closedPort returns a loopback port that nothing listens on.
func closedPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	return port
}

// shortTimeouts shortens the dial and exchange budgets for one test.
func shortTimeouts(t *testing.T, dial, exchange time.Duration) {
	t.Helper()
	oldDial, oldExchange := upstreamDialTimeout.get(), upstreamExchangeTimeout.get()
	upstreamDialTimeout.set(dial)
	upstreamExchangeTimeout.set(exchange)
	t.Cleanup(func() {
		upstreamDialTimeout.set(oldDial)
		upstreamExchangeTimeout.set(oldExchange)
	})
}

// replaceDialer swaps the upstream TCP dialer for one test.
func replaceDialer(t *testing.T, dial func(ctx context.Context, address string, deadline time.Time) (net.Conn, error)) {
	t.Helper()
	old := dialer.Load()
	replacement := dialFunc(dial)
	dialer.Store(&replacement)
	t.Cleanup(func() { dialer.Store(old) })
}

func wantDiagnostic(t *testing.T, err error, code, phase string, retryable bool) {
	t.Helper()
	var d *diagnostic
	if !errors.As(err, &d) {
		t.Fatalf("expected the fixed diagnostic %s/%s, got %v", code, phase, err)
	}
	if d.Code != code || d.Phase != phase || d.Retryable != retryable {
		t.Fatalf("got %s/%s/retryable=%v, want %s/%s/retryable=%v", d.Code, d.Phase, d.Retryable, code, phase, retryable)
	}
}

// connectSeen is what a fake HTTP proxy received: the request line and header block exactly as sent.
type connectSeen struct {
	raw   string
	line  string
	names []string
}

// readRequest reads one header block byte by byte, so that no tunnel data behind it is consumed.
func readRequest(c net.Conn) (connectSeen, bool) {
	var raw []byte
	one := make([]byte, 1)
	for len(raw) < 8192 {
		if _, err := io.ReadFull(c, one); err != nil {
			return connectSeen{}, false
		}
		raw = append(raw, one[0])
		if bytes.HasSuffix(raw, []byte("\r\n\r\n")) {
			lines := strings.Split(strings.TrimSuffix(string(raw), "\r\n\r\n"), "\r\n")
			seen := connectSeen{raw: string(raw), line: lines[0]}
			for _, line := range lines[1:] {
				seen.names = append(seen.names, line[:strings.Index(line, ":")])
			}
			return seen, true
		}
	}
	return connectSeen{}, false
}

// serveProxy answers every connection of listener (plain or TLS) with reply, after reading its CONNECT request. Each request is
// also sent to the returned channel.
func serveProxy(t *testing.T, listener net.Listener, reply func(c net.Conn, seen connectSeen)) <-chan connectSeen {
	t.Helper()
	t.Cleanup(func() { listener.Close() })
	seen := make(chan connectSeen, 64)
	go func() {
		for {
			c, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				c.SetDeadline(time.Now().Add(10 * time.Second))
				request, ok := readRequest(c)
				if !ok {
					return
				}
				seen <- request
				reply(c, request)
			}()
		}
	}()
	return seen
}

// httpProxy is serveProxy on a plain loopback listener.
func httpProxy(t *testing.T, reply func(c net.Conn, seen connectSeen)) (*net.TCPAddr, <-chan connectSeen) {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	return listener.Addr().(*net.TCPAddr), serveProxy(t, listener, reply)
}

// respond writes a fixed response.
func respond(text string) func(net.Conn, connectSeen) {
	return func(c net.Conn, _ connectSeen) { io.WriteString(c, text) }
}

// echoTunnel answers 200 and then echoes every byte it receives, until the client half-closes.
func echoTunnel(c net.Conn, _ connectSeen) {
	io.WriteString(c, "HTTP/1.1 200 Connection established\r\n\r\n")
	io.Copy(c, c)
}

// tunnelTo answers 200 and joins the client with a fresh connection to origin, like a forward proxy does.
func tunnelTo(origin string) func(net.Conn, connectSeen) {
	return func(c net.Conn, _ connectSeen) {
		remote, err := net.DialTimeout("tcp", origin, time.Second)
		if err != nil {
			io.WriteString(c, "HTTP/1.1 502 Bad Gateway\r\n\r\n")
			return
		}
		defer remote.Close()
		io.WriteString(c, "HTTP/1.1 200 Connection established\r\n\r\n")
		go io.Copy(remote, c)
		io.Copy(c, remote)
	}
}

// requireBasic answers 407 unless the request carries exactly "Proxy-Authorization: Basic <encoded>"; otherwise it runs next.
func requireBasic(encoded string, next func(net.Conn, connectSeen)) func(net.Conn, connectSeen) {
	return func(c net.Conn, seen connectSeen) {
		if !strings.Contains(seen.raw, "\r\nProxy-Authorization: Basic "+encoded+"\r\n") {
			io.WriteString(c, canaryResponse(407))
			return
		}
		next(c, seen)
	}
}

func nextSeen(t *testing.T, seen <-chan connectSeen) connectSeen {
	t.Helper()
	select {
	case request := <-seen:
		return request
	case <-time.After(3 * time.Second):
		t.Fatal("the proxy received no request")
	}
	return connectSeen{}
}

func noRequest(t *testing.T, seen <-chan connectSeen) {
	t.Helper()
	select {
	case request := <-seen:
		t.Fatalf("the proxy must not be contacted, but received %q", request.line)
	case <-time.After(40 * time.Millisecond):
	}
}

// browserReply reads one SOCKS5 reply the way a browser does: the 4-byte head, then BND.ADDR and BND.PORT.
func browserReply(t *testing.T, c net.Conn) []byte {
	t.Helper()
	reply := make([]byte, 4)
	if _, err := io.ReadFull(c, reply); err != nil {
		t.Fatalf("no SOCKS5 reply: %v", err)
	}
	size := 0
	switch reply[3] {
	case 1:
		size = 6
	case 4:
		size = 18
	case 3:
		length := make([]byte, 1)
		if _, err := io.ReadFull(c, length); err != nil {
			t.Fatal(err)
		}
		reply = append(reply, length...)
		size = int(length[0]) + 2
	default:
		t.Fatalf("reply with ATYP %d", reply[3])
	}
	rest := make([]byte, size)
	if _, err := io.ReadFull(c, rest); err != nil {
		t.Fatal(err)
	}
	return append(reply, rest...)
}

// browserConnect speaks SOCKS5 to the relay like a browser: a no-authentication greeting, then CONNECT. It returns the open
// connection and the reply.
func browserConnect(t *testing.T, relay *socksRelay, atyp byte, address []byte) (net.Conn, []byte) {
	t.Helper()
	c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	c.SetDeadline(time.Now().Add(8 * time.Second))
	if _, err = c.Write([]byte{5, 1, 0}); err != nil {
		t.Fatal(err)
	}
	var method [2]byte
	if _, err = io.ReadFull(c, method[:]); err != nil || method != [2]byte{5, 0} {
		t.Fatalf("greeting not accepted: %v %v", method, err)
	}
	if _, err = c.Write(append([]byte{5, 1, 0, atyp}, address...)); err != nil {
		t.Fatal(err)
	}
	return c, browserReply(t, c)
}

// domainAddress is DST.ADDR and DST.PORT for ATYP 3.
func domainAddress(name string, port uint16) []byte {
	return append(append([]byte{byte(len(name))}, name...), byte(port>>8), byte(port))
}

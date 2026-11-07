package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

const (
	canaryReason = "CANARY-REASON"
	canaryRealm  = "CANARY-REALM"
)

// canaryResponse is a response whose every variable part (reason phrase, challenge, server banner, redirect target) is a canary
// that must never come back out of the companion.
func canaryResponse(status int) string {
	return fmt.Sprintf("HTTP/1.1 %d %s\r\nProxy-Authenticate: Basic realm=\"%s\"\r\nServer: CANARY-SERVER\r\nLocation: http://canary-redirect.invalid/\r\nContent-Length: 0\r\n\r\n", status, canaryReason, canaryRealm)
}

func httpClientProfile(addr *net.TCPAddr, username, password string) profile {
	return profile{Type: "http", Host: "127.0.0.1", Port: addr.Port, Username: username, Password: password}
}

func TestHTTPConnectRequestIsExactlyTheSpecifiedOne(t *testing.T) {
	for _, tc := range []struct {
		name               string
		username, password string
		authority          string
		want               string
	}{
		{"domain, no credentials", "", "", "must-stay-remote.invalid:443",
			"CONNECT must-stay-remote.invalid:443 HTTP/1.1\r\nHost: must-stay-remote.invalid:443\r\n\r\n"},
		{"IPv4 literal", "", "", "192.0.2.1:80",
			"CONNECT 192.0.2.1:80 HTTP/1.1\r\nHost: 192.0.2.1:80\r\n\r\n"},
		{"IPv6 literal in brackets", "", "", "[2001:db8::1]:8443",
			"CONNECT [2001:db8::1]:8443 HTTP/1.1\r\nHost: [2001:db8::1]:8443\r\n\r\n"},
		{"credentials go into Proxy-Authorization only", "alice", "s3cr:et", "must-stay-remote.invalid:443",
			"CONNECT must-stay-remote.invalid:443 HTTP/1.1\r\nHost: must-stay-remote.invalid:443\r\nProxy-Authorization: Basic YWxpY2U6czNjcjpldA==\r\n\r\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			addr, seen := httpProxy(t, echoTunnel)
			c, err := httpConnect(context.Background(), httpClientProfile(addr, tc.username, tc.password), tc.authority)
			if err != nil {
				t.Fatal(err)
			}
			c.Close()
			if got := nextSeen(t, seen); got.raw != tc.want {
				t.Fatalf("request %q, want %q", got.raw, tc.want)
			}
		})
	}
}

func TestHTTPConnectCredentialsAppearOnlyInTheAuthorizationHeader(t *testing.T) {
	addr, seen := httpProxy(t, echoTunnel)
	c, err := httpConnect(context.Background(), httpClientProfile(addr, "user", "pass"), "destination.invalid:443")
	if err != nil {
		t.Fatal(err)
	}
	c.Close()
	got := nextSeen(t, seen)
	if strings.Join(got.names, ",") != "Host,Proxy-Authorization" {
		t.Fatalf("header names %v", got.names)
	}
	lines := strings.Split(got.raw, "\r\n")
	if !strings.Contains(lines[2], "dXNlcjpwYXNz") || strings.Contains(lines[0]+lines[1], "dXNlcjpwYXNz") || strings.Contains(got.raw, "user") || strings.Contains(got.raw, "pass") {
		t.Fatalf("credentials leaked outside the Basic value: %q", got.raw)
	}
}

func TestHTTPConnectStatusMapping(t *testing.T) {
	type outcome struct {
		code, phase string
		retryable   bool
	}
	cases := []struct {
		status      int
		credentials bool
		want        *outcome // nil: success
	}{
		{200, false, nil}, {204, false, nil}, {299, false, nil},
		{407, true, &outcome{"auth-failed", "auth", false}},
		{407, false, &outcome{"auth-required", "auth", false}},
		{403, true, &outcome{"proxy-denied", "proxy", false}},
		{502, true, &outcome{"host-unreachable", "proxy", true}},
		{504, true, &outcome{"timeout", "proxy", true}},
		{503, true, &outcome{"proxy-error", "proxy", true}},
		{500, true, &outcome{"proxy-error", "proxy", true}},
		{501, true, &outcome{"proxy-error", "proxy", true}},
		{599, true, &outcome{"proxy-error", "proxy", true}},
		{301, true, &outcome{"proxy-error", "proxy", false}},
		{302, true, &outcome{"proxy-error", "proxy", false}},
		{307, true, &outcome{"proxy-error", "proxy", false}},
		{308, true, &outcome{"proxy-error", "proxy", false}},
		{400, true, &outcome{"proxy-error", "proxy", false}},
		{401, true, &outcome{"proxy-error", "proxy", false}},
		{404, true, &outcome{"proxy-error", "proxy", false}},
		{405, true, &outcome{"proxy-error", "proxy", false}},
		{429, true, &outcome{"proxy-error", "proxy", false}},
		{101, true, &outcome{"proxy-error", "proxy", false}},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%d credentials=%v", tc.status, tc.credentials), func(t *testing.T) {
			addr, seen := httpProxy(t, respond(canaryResponse(tc.status)))
			username, password := "", ""
			if tc.credentials {
				username, password = "alice", "s3cr:et"
			}
			c, err := httpConnect(context.Background(), httpClientProfile(addr, username, password), "canary-destination.invalid:443")
			if tc.want == nil {
				if err != nil {
					t.Fatalf("a %d answer must open the tunnel: %v", tc.status, err)
				}
				c.Close()
				return
			}
			if c != nil {
				t.Fatal("a refused CONNECT returned a connection")
			}
			wantDiagnostic(t, err, tc.want.code, tc.want.phase, tc.want.retryable)
			nextSeen(t, seen)
			noRequest(t, seen) // no redirect, no retry, no second request of any kind
			encoded, _ := json.Marshal(safeDiagnostic(err))
			for _, secret := range []string{canaryReason, canaryRealm, "CANARY-SERVER", "canary-redirect", "canary-destination", "alice", "s3cr", "YWxpY2U"} {
				if strings.Contains(string(encoded), secret) || strings.Contains(err.Error(), secret) {
					t.Fatalf("diagnostic leaked %q: %s / %v", secret, encoded, err)
				}
			}
		})
	}
}

func TestHTTPConnectResponseForms(t *testing.T) {
	interim := "HTTP/1.1 100 Continue\r\n\r\n"
	for _, tc := range []struct {
		name     string
		response string
		code     string // empty: the tunnel opens
		retry    bool
	}{
		{"HTTP/1.1 with reason", "HTTP/1.1 200 Connection established\r\n\r\n", "", false},
		{"HTTP/1.0 with a proxy header", "HTTP/1.0 200 Connection established\r\nProxy-Agent: x\r\n\r\n", "", false},
		{"no reason phrase", "HTTP/1.1 200\r\n\r\n", "", false},
		{"bare LF line endings", "HTTP/1.1 200 OK\n\n", "", false},
		{"one interim response", interim + "HTTP/1.1 200 OK\r\n\r\n", "", false},
		{"three interim responses", interim + interim + interim + "HTTP/1.1 200 OK\r\n\r\n", "", false},
		{"four interim responses", interim + interim + interim + interim + "HTTP/1.1 200 OK\r\n\r\n", "proxy-error", false},
		{"lower-case name", "http/1.1 200 OK\r\n\r\n", "proxy-error", false},
		{"HTTP/2", "HTTP/2 200\r\n\r\n", "proxy-error", false},
		{"HTTP/1.2", "HTTP/1.2 200 OK\r\n\r\n", "proxy-error", false},
		{"another protocol", "ICY 200 OK\r\n\r\n", "proxy-error", false},
		{"two-digit status", "HTTP/1.1 20 OK\r\n\r\n", "proxy-error", false},
		{"four-digit status", "HTTP/1.1 2000 OK\r\n\r\n", "proxy-error", false},
		{"no space before the reason", "HTTP/1.1 200OK\r\n\r\n", "proxy-error", false},
		{"two spaces after the version", "HTTP/1.1  200 OK\r\n\r\n", "proxy-error", false},
		{"non-numeric status", "HTTP/1.1 abc OK\r\n\r\n", "proxy-error", false},
		{"a SOCKS5 reply", "\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00", "connection-failed", true}, // not a line: the stream ends first
		{"a TLS alert", "\x15\x03\x01\x00\x02\x02\x46", "connection-failed", true},
		{"nothing at all", "", "connection-failed", true},
		{"header block without its end", "HTTP/1.1 200 OK\r\nA: b\r\n", "connection-failed", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			addr, _ := httpProxy(t, respond(tc.response))
			c, err := httpConnect(context.Background(), httpClientProfile(addr, "", ""), "destination.invalid:443")
			if tc.code == "" {
				if err != nil {
					t.Fatalf("rejected a valid response: %v", err)
				}
				c.Close()
				return
			}
			wantDiagnostic(t, err, tc.code, "proxy", tc.retry)
		})
	}
}

func TestHTTPConnectHeaderBlockIsCappedAt8KiB(t *testing.T) {
	build := func(total int) string {
		// status line + one padding header + blank line, exactly total bytes
		const status = "HTTP/1.1 200 OK\r\n"
		pad := total - len(status) - 2 - len("X-Pad: ") - 2
		return status + "X-Pad: " + strings.Repeat("a", pad) + "\r\n\r\n"
	}
	many := "HTTP/1.1 200 OK\r\n" + strings.Repeat("X: 0123456789\r\n", 700) + "\r\n" // > 8 KiB in small lines
	for _, tc := range []struct {
		name     string
		response string
		ok       bool
	}{
		{"exactly 8192 bytes", build(8192), true},
		{"8193 bytes", build(8193), false},
		{"many small lines beyond the cap", many, false},
		{"one line without a line end", "HTTP/1.1 200 OK\r\nX: " + strings.Repeat("a", 9000), false},
		{"a long status line", "HTTP/1.1 200 " + strings.Repeat("r", 9000) + "\r\n\r\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			addr, _ := httpProxy(t, respond(tc.response))
			c, err := httpConnect(context.Background(), httpClientProfile(addr, "", ""), "destination.invalid:443")
			if tc.ok {
				if err != nil {
					t.Fatal(err)
				}
				c.Close()
				return
			}
			wantDiagnostic(t, err, "proxy-error", "proxy", false)
		})
	}
	// The cap is on the header block, not on what follows it.
	addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) {
		io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n")
		c.Write(bytes.Repeat([]byte("t"), 100000))
	})
	c, err := httpConnect(context.Background(), httpClientProfile(addr, "", ""), "destination.invalid:443")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if got, err := io.ReadAll(c); err != nil || len(got) != 100000 {
		t.Fatalf("tunnel data after the header was cut: %d bytes, %v", len(got), err)
	}
}

func TestHTTPConnectDeliversBytesTheProxySentBehindItsHeader(t *testing.T) {
	banner := "SSH-2.0-OpenSSH_9.9 server speaks first\r\n"
	pattern := make([]byte, 20000) // more than the response buffer
	for i := range pattern {
		pattern[i] = byte(i % 251)
	}
	for _, tc := range []struct {
		name string
		send func(c net.Conn)
		want []byte
	}{
		{"banner in the same write as the header", func(c net.Conn) { io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n"+banner) }, []byte(banner)},
		{"banner in the same segment, written in two calls", func(c net.Conn) {
			io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n")
			io.WriteString(c, banner)
		}, []byte(banner)},
		{"banner after a pause", func(c net.Conn) {
			io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n")
			time.Sleep(100 * time.Millisecond)
			io.WriteString(c, banner)
		}, []byte(banner)},
		{"more than the buffer holds", func(c net.Conn) { c.Write(append([]byte("HTTP/1.1 200 OK\r\n\r\n"), pattern...)) }, pattern},
	} {
		t.Run(tc.name, func(t *testing.T) {
			addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) {
				tc.send(c)
				io.Copy(io.Discard, c) // the client half-closes when done
				io.WriteString(c, "bye")
			})
			c, err := httpConnect(context.Background(), httpClientProfile(addr, "", ""), "destination.invalid:22")
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			c.SetDeadline(time.Now().Add(5 * time.Second))
			got := make([]byte, len(tc.want))
			if _, err = io.ReadFull(c, got); err != nil || !bytes.Equal(got, tc.want) {
				t.Fatalf("tunnel did not start with the proxy's own bytes: %v", err)
			}
			closeWrite(c)
			if rest, err := io.ReadAll(c); err != nil || string(rest) != "bye" {
				t.Fatalf("half-close did not reach the proxy through the returned connection: %q, %v", rest, err)
			}
		})
	}
}

func TestHTTPConnectToleratesAResponseWrittenByteByByte(t *testing.T) {
	addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) {
		for _, b := range []byte("HTTP/1.1 200 OK\r\nProxy-Agent: slow\r\n\r\nafter") {
			c.Write([]byte{b})
			time.Sleep(2 * time.Millisecond)
		}
		io.Copy(io.Discard, c)
	})
	c, err := httpConnect(context.Background(), httpClientProfile(addr, "", ""), "destination.invalid:443")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	got := make([]byte, 5)
	if _, err = io.ReadFull(c, got); err != nil || string(got) != "after" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestHTTPConnectFailuresBeforeAnyAnswer(t *testing.T) {
	t.Run("connection refused", func(t *testing.T) {
		_, err := httpConnect(context.Background(), profile{Type: "http", Host: "127.0.0.1", Port: closedPort(t)}, "destination.invalid:443")
		wantDiagnostic(t, err, "connection-refused", "endpoint", true)
	})
	t.Run("the proxy never answers", func(t *testing.T) {
		shortTimeouts(t, 2*time.Second, 300*time.Millisecond)
		addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) { io.Copy(io.Discard, c) })
		started := time.Now()
		_, err := httpConnect(context.Background(), httpClientProfile(addr, "", ""), "destination.invalid:443")
		wantDiagnostic(t, err, "timeout", "proxy", true)
		if time.Since(started) > 2*time.Second {
			t.Fatal("the stalled proxy held the caller past its deadline")
		}
	})
	t.Run("the proxy drips its header for ever", func(t *testing.T) {
		shortTimeouts(t, 2*time.Second, 400*time.Millisecond)
		addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) {
			io.WriteString(c, "HTTP/1.1 200 OK\r\n")
			for i := 0; i < 100; i++ { // one more header line every 50 ms; the block never ends
				if _, err := io.WriteString(c, "X: y\r\n"); err != nil {
					return
				}
				time.Sleep(50 * time.Millisecond)
			}
		})
		started := time.Now()
		_, err := httpConnect(context.Background(), httpClientProfile(addr, "", ""), "destination.invalid:443")
		wantDiagnostic(t, err, "timeout", "proxy", true)
		if time.Since(started) > 2*time.Second {
			t.Fatal("slow header drip was allowed to renew the deadline")
		}
	})
	t.Run("the proxy hangs up", func(t *testing.T) {
		addr := listenLoopback(t, func(c net.Conn) {})
		_, err := httpConnect(context.Background(), httpClientProfile(addr, "", ""), "destination.invalid:443")
		wantDiagnostic(t, err, "connection-failed", "proxy", true)
	})
	t.Run("a context deadline that runs out is a timeout", func(t *testing.T) {
		shortTimeouts(t, 5*time.Second, 5*time.Second) // only the context can end this in time
		addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) { io.Copy(io.Discard, c) })
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		started := time.Now()
		_, err := httpConnect(ctx, httpClientProfile(addr, "", ""), "destination.invalid:443")
		wantDiagnostic(t, err, "timeout", "proxy", true)
		if time.Since(started) > 2*time.Second {
			t.Fatal("the context did not end the exchange")
		}
	})
	t.Run("a cancelled context stops the exchange", func(t *testing.T) {
		addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) { io.Copy(io.Discard, c) })
		ctx, cancel := context.WithCancel(context.Background())
		go func() { time.Sleep(150 * time.Millisecond); cancel() }()
		started := time.Now()
		_, err := httpConnect(ctx, httpClientProfile(addr, "", ""), "destination.invalid:443")
		if err == nil || time.Since(started) > 2*time.Second {
			t.Fatalf("cancellation did not stop the exchange: %v after %v", err, time.Since(started))
		}
	})
}

func TestHTTPConnectNeverFollowsARedirect(t *testing.T) {
	var connections int
	addr, seen := httpProxy(t, func(c net.Conn, _ connectSeen) {
		connections++
		io.WriteString(c, "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/\r\n\r\n")
	})
	_, err := httpConnect(context.Background(), httpClientProfile(addr, "", ""), "destination.invalid:443")
	wantDiagnostic(t, err, "proxy-error", "proxy", false)
	nextSeen(t, seen)
	noRequest(t, seen)
	if connections != 1 {
		t.Fatalf("%d connections to the proxy", connections)
	}
}

func TestRelayTunnelsThroughAnHTTPProxy(t *testing.T) {
	ipv6 := append(append([]byte{0x20, 0x01, 0x0d, 0xb8}, make([]byte, 11)...), 1, 0x20, 0xfb)
	for _, tc := range []struct {
		name               string
		username, password string
		atyp               byte
		address            []byte
		line               string
		host               string
	}{
		{"domain", "", "", 3, domainAddress("must-stay-remote.invalid", 443), "CONNECT must-stay-remote.invalid:443 HTTP/1.1", "must-stay-remote.invalid:443"},
		{"domain with credentials", "alice", "s3cr:et", 3, domainAddress("must-stay-remote.invalid", 8080), "CONNECT must-stay-remote.invalid:8080 HTTP/1.1", "must-stay-remote.invalid:8080"},
		{"IPv4", "", "", 1, []byte{192, 0, 2, 7, 0, 80}, "CONNECT 192.0.2.7:80 HTTP/1.1", "192.0.2.7:80"},
		{"IPv6", "", "", 4, ipv6, "CONNECT [2001:db8::1]:8443 HTTP/1.1", "[2001:db8::1]:8443"},
		{"IPv4-mapped IPv6 keeps its form", "", "", 4, append(append(make([]byte, 10), 0xff, 0xff, 192, 0, 2, 9), 0x01, 0xbb), "CONNECT [::ffff:192.0.2.9]:443 HTTP/1.1", "[::ffff:192.0.2.9]:443"},
		{"underscore, dot and upper case", "", "", 3, domainAddress("My_Host.Example.", 443), "CONNECT My_Host.Example.:443 HTTP/1.1", "My_Host.Example.:443"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			addr, seen := httpProxy(t, echoTunnel)
			relay, err := startRelay(httpClientProfile(addr, tc.username, tc.password))
			if err != nil {
				t.Fatal(err)
			}
			defer relay.Close()
			c, reply := browserConnect(t, relay, tc.atyp, tc.address)
			if !bytes.Equal(reply, []byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}) {
				t.Fatalf("reply %x", reply)
			}
			c.Write([]byte("ping"))
			c.(*net.TCPConn).CloseWrite()
			if echoed, err := io.ReadAll(c); err != nil || string(echoed) != "ping" {
				t.Fatalf("tunnel data %q, %v", echoed, err)
			}
			got := nextSeen(t, seen)
			if got.line != tc.line || !strings.HasPrefix(got.raw[len(got.line)+2:], "Host: "+tc.host+"\r\n") {
				t.Fatalf("the proxy saw %q", got.raw)
			}
			if tc.username != "" != strings.Contains(got.raw, "Proxy-Authorization: Basic ") {
				t.Fatalf("authorization header presence does not match the profile: %q", got.raw)
			}
		})
	}
}

func TestRelayDeliversTheProxysFirstTunnelBytesBeforeAnyClientData(t *testing.T) {
	addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) {
		io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n220 mail.example ESMTP ready\r\n")
		io.Copy(io.Discard, c)
	})
	relay, err := startRelay(httpClientProfile(addr, "", ""))
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()
	c, reply := browserConnect(t, relay, 3, domainAddress("mail.example", 25))
	if reply[1] != 0 {
		t.Fatalf("reply %x", reply)
	}
	line := make([]byte, len("220 mail.example ESMTP ready\r\n"))
	if _, err = io.ReadFull(c, line); err != nil || string(line) != "220 mail.example ESMTP ready\r\n" {
		t.Fatalf("server-first bytes were lost: %q, %v", line, err)
	}
}

func TestRelayMapsHTTPStatusesToSocksReplies(t *testing.T) {
	for _, tc := range []struct {
		status int
		want   byte
	}{
		{407, 2}, {403, 2}, {502, 4}, {504, 6}, {503, 1}, {500, 1}, {301, 1}, {400, 1}, {404, 1}, {429, 1},
	} {
		for _, credentials := range []bool{true, false} {
			t.Run(fmt.Sprintf("%d credentials=%v", tc.status, credentials), func(t *testing.T) {
				addr, _ := httpProxy(t, respond(canaryResponse(tc.status)))
				username, password := "", ""
				if credentials {
					username, password = "alice", "s3cr:et"
				}
				relay, err := startRelay(httpClientProfile(addr, username, password))
				if err != nil {
					t.Fatal(err)
				}
				defer relay.Close()
				c, reply := browserConnect(t, relay, 3, domainAddress("canary-destination.invalid", 443))
				if want := []byte{5, tc.want, 0, 1, 0, 0, 0, 0, 0, 0}; !bytes.Equal(reply, want) {
					t.Fatalf("reply %x, want %x", reply, want)
				}
				if rest, _ := io.ReadAll(c); len(rest) != 0 {
					t.Fatalf("the relay kept talking: %q", rest)
				}
			})
		}
	}
}

func TestRelayMapsHTTPUpstreamTransportFailures(t *testing.T) {
	t.Run("refused", func(t *testing.T) {
		relay, err := startRelay(profile{Type: "http", Host: "127.0.0.1", Port: closedPort(t)})
		if err != nil {
			t.Fatal(err)
		}
		defer relay.Close()
		_, reply := browserConnect(t, relay, 3, domainAddress("destination.invalid", 443))
		if reply[1] != 5 {
			t.Fatalf("reply %x", reply)
		}
	})
	t.Run("stalled", func(t *testing.T) {
		shortTimeouts(t, 2*time.Second, 300*time.Millisecond)
		addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) { io.Copy(io.Discard, c) })
		relay, err := startRelay(httpClientProfile(addr, "", ""))
		if err != nil {
			t.Fatal(err)
		}
		defer relay.Close()
		_, reply := browserConnect(t, relay, 3, domainAddress("destination.invalid", 443))
		if reply[1] != 6 {
			t.Fatalf("reply %x", reply)
		}
	})
	t.Run("hang up without an answer", func(t *testing.T) {
		addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) {})
		relay, err := startRelay(httpClientProfile(addr, "", ""))
		if err != nil {
			t.Fatal(err)
		}
		defer relay.Close()
		_, reply := browserConnect(t, relay, 3, domainAddress("destination.invalid", 443))
		if reply[1] != 1 {
			t.Fatalf("reply %x", reply)
		}
	})
	t.Run("Close aborts a request in flight", func(t *testing.T) {
		got := make(chan struct{})
		gone := make(chan struct{})
		addr, _ := httpProxy(t, func(c net.Conn, _ connectSeen) {
			close(got)
			io.Copy(io.Discard, c)
			close(gone)
		})
		relay, err := startRelay(httpClientProfile(addr, "", ""))
		if err != nil {
			t.Fatal(err)
		}
		c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), time.Second)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		c.Write(append([]byte{5, 1, 0, 5, 1, 0, 3}, domainAddress("destination.invalid", 443)...))
		select {
		case <-got:
		case <-time.After(3 * time.Second):
			t.Fatal("the relay never contacted the proxy")
		}
		relay.Close()
		select {
		case <-gone:
		case <-time.After(2 * time.Second):
			t.Fatal("Close left the CONNECT exchange running")
		}
	})
}

func TestRelayRefusesUnsafeDomainsWithoutContactingTheProxy(t *testing.T) {
	addr, seen := httpProxy(t, echoTunnel)
	relay, err := startRelay(httpClientProfile(addr, "alice", "s3cr:et"))
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()
	for name, domain := range map[string]string{
		"header injection":   "evil.example\r\nX-Injected: 1",
		"request smuggling":  "evil.example HTTP/1.1\r\n\r\nCONNECT other.example:443",
		"space":              "a b.example",
		"slash":              "a/b.example",
		"colon":              "a:443",
		"userinfo":           "user@host.example",
		"bracketed literal":  "[::1]",
		"query":              "host.example?x=1",
		"fragment":           "host.example#x",
		"non-ASCII":          "b\xc3\xbccher.example",
		"NUL":                "host\x00.example",
		"backslash":          "host\\.example",
		"longer than a name": strings.Repeat("a", 254),
	} {
		t.Run(name, func(t *testing.T) {
			c, reply := browserConnect(t, relay, 3, domainAddress(domain, 443))
			if want := []byte{5, 4, 0, 1, 0, 0, 0, 0, 0, 0}; !bytes.Equal(reply, want) {
				t.Fatalf("reply %x, want host unreachable", reply)
			}
			c.Close()
			noRequest(t, seen)
		})
	}
	t.Run("port 0", func(t *testing.T) {
		c, reply := browserConnect(t, relay, 1, []byte{192, 0, 2, 1, 0, 0})
		if want := []byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0}; !bytes.Equal(reply, want) {
			t.Fatalf("reply %x, want connection refused", reply)
		}
		c.Close()
		noRequest(t, seen)
	})
}

func TestHTTPUpstreamResolvesNothingLocally(t *testing.T) {
	// The destination is a name that cannot resolve anywhere. The proxy still receives it verbatim and the tunnel opens, so no
	// local lookup stands between the browser's name and the proxy.
	addr, seen := httpProxy(t, echoTunnel)
	relay, err := startRelay(httpClientProfile(addr, "", ""))
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()
	c, reply := browserConnect(t, relay, 3, domainAddress("no-such-name.must-stay-remote.invalid", 443))
	defer c.Close()
	if reply[1] != 0 {
		t.Fatalf("reply %x", reply)
	}
	if got := nextSeen(t, seen); got.line != "CONNECT no-such-name.must-stay-remote.invalid:443 HTTP/1.1" {
		t.Fatalf("the proxy saw %q", got.line)
	}
}

func TestParseStatusLine(t *testing.T) {
	for line, want := range map[string]int{"HTTP/1.1 200 OK": 200, "HTTP/1.0 407 Proxy Authentication Required": 407, "HTTP/1.1 502": 502, "HTTP/1.1 599 ": 599} {
		if got, ok := parseStatusLine([]byte(line)); !ok || got != want {
			t.Errorf("%q: got %d/%v", line, got, ok)
		}
	}
	for _, line := range []string{"", "HTTP/1.1", "HTTP/1.1 200OK", "HTTP/1.1  200", "HTTP/1.3 200 OK", "HTTP/1. 200 OK", "HTTP/1.1 2x0 OK", "XTTP/1.1 200 OK", "HTTP/1.1 -20 OK"} {
		if got, ok := parseStatusLine([]byte(line)); ok {
			t.Errorf("%q accepted as %d", line, got)
		}
	}
}

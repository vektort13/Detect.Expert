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

type negotiationCase struct {
	name               string
	username, password string
	greeting           []byte // exactly what the client must offer
	choice             []byte // the server's answer to the greeting
	cut                bool   // the server hangs up after its last scripted bytes
	auth               []byte // the exact RFC 1929 message that must arrive; nil when none may
	authReply          []byte // the server's answer to it
	code, phase        string // empty code: the negotiation succeeds
	retryable          bool
}

func TestSocksClientMethodNegotiation(t *testing.T) {
	login := func(user, pass string) []byte {
		return append(append(append([]byte{1, byte(len(user))}, user...), byte(len(pass))), pass...)
	}
	noLogin := []byte{5, 1, 0}
	bothMethods := []byte{5, 2, 0, 2}
	longUser, longPass := strings.Repeat("u", 255), strings.Repeat("p", 255)
	for _, tc := range []negotiationCase{
		{name: "none: server picks no authentication", greeting: noLogin, choice: []byte{5, 0}},
		{name: "none: server insists on a login", greeting: noLogin, choice: []byte{5, 2}, code: "auth-required", phase: "auth"},
		{name: "none: server accepts no method", greeting: noLogin, choice: []byte{5, 255}, code: "auth-required", phase: "auth"},
		{name: "none: server picks GSSAPI", greeting: noLogin, choice: []byte{5, 1}, code: "proxy-error", phase: "socks"},
		{name: "none: server picks an unknown method", greeting: noLogin, choice: []byte{5, 0x80}, code: "proxy-error", phase: "socks"},
		{name: "none: server answers with version 4", greeting: noLogin, choice: []byte{4, 0}, code: "proxy-error", phase: "socks"},
		{name: "none: server answers with half a choice", greeting: noLogin, choice: []byte{5}, cut: true, code: "connection-failed", phase: "socks", retryable: true},
		{name: "login: server picks no authentication and is sent no login", username: "user", password: "p:ss", greeting: bothMethods, choice: []byte{5, 0}},
		{name: "login: server picks username/password", username: "user", password: "p:ss", greeting: bothMethods, choice: []byte{5, 2},
			auth: login("user", "p:ss"), authReply: []byte{1, 0}},
		{name: "login: the longest allowed user and password", username: longUser, password: longPass, greeting: bothMethods, choice: []byte{5, 2},
			auth: login(longUser, longPass), authReply: []byte{1, 0}},
		{name: "login: status 1 is a refused login", username: "user", password: "wrong", greeting: bothMethods, choice: []byte{5, 2},
			auth: login("user", "wrong"), authReply: []byte{1, 1}, code: "auth-failed", phase: "auth"},
		{name: "login: status 255 is a refused login", username: "user", password: "wrong", greeting: bothMethods, choice: []byte{5, 2},
			auth: login("user", "wrong"), authReply: []byte{1, 255}, code: "auth-failed", phase: "auth"},
		// Only the status byte counts, as in curl: servers exist that answer the sub-negotiation with another version byte.
		{name: "login: success status with version 5 is accepted", username: "user", password: "p", greeting: bothMethods, choice: []byte{5, 2},
			auth: login("user", "p"), authReply: []byte{5, 0}},
		{name: "login: success status with version 0 is accepted", username: "user", password: "p", greeting: bothMethods, choice: []byte{5, 2},
			auth: login("user", "p"), authReply: []byte{0, 0}},
		{name: "login: success status with version 255 is accepted", username: "user", password: "p", greeting: bothMethods, choice: []byte{5, 2},
			auth: login("user", "p"), authReply: []byte{255, 0}},
		{name: "login: refused status with version 5 is still a refused login", username: "user", password: "wrong", greeting: bothMethods, choice: []byte{5, 2},
			auth: login("user", "wrong"), authReply: []byte{5, 1}, code: "auth-failed", phase: "auth"},
		{name: "login: refused status with version 0 is still a refused login", username: "user", password: "wrong", greeting: bothMethods, choice: []byte{5, 2},
			auth: login("user", "wrong"), authReply: []byte{0, 255}, code: "auth-failed", phase: "auth"},
		{name: "login: sub-negotiation cut short", username: "user", password: "p", greeting: bothMethods, choice: []byte{5, 2},
			auth: login("user", "p"), authReply: []byte{1}, cut: true, code: "connection-failed", phase: "auth", retryable: true},
		{name: "login: server accepts no method", username: "user", password: "p", greeting: bothMethods, choice: []byte{5, 255}, code: "auth-failed", phase: "auth"},
		{name: "login: server picks GSSAPI", username: "user", password: "p", greeting: bothMethods, choice: []byte{5, 1}, code: "proxy-error", phase: "socks"},
		{name: "login: server picks a method nobody offered", username: "user", password: "p", greeting: bothMethods, choice: []byte{5, 3}, code: "proxy-error", phase: "socks"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			received := make(chan []byte, 1)
			addr := listenLoopback(t, func(c net.Conn) {
				got := make([]byte, len(tc.greeting))
				if _, err := io.ReadFull(c, got); err != nil {
					received <- got
					return
				}
				c.Write(tc.choice)
				if tc.cut && tc.authReply == nil { // hang up right after the choice
					received <- got
					return
				}
				if tc.authReply != nil {
					message := make([]byte, len(tc.auth))
					io.ReadFull(c, message)
					got = append(got, message...)
					c.Write(tc.authReply)
					if tc.cut { // hang up after a partial answer
						received <- got
						return
					}
				}
				rest, _ := io.ReadAll(c) // anything the client sends beyond the expected frames, until it hangs up
				received <- append(got, rest...)
			})
			c, err := dialSocks(profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port, Username: tc.username, Password: tc.password})
			if tc.code != "" {
				wantDiagnostic(t, err, tc.code, tc.phase, tc.retryable)
				if c != nil {
					t.Fatal("a failed negotiation returned a connection")
				}
			} else {
				if err != nil {
					t.Fatalf("negotiation failed: %v", err)
				}
				c.Close()
			}
			select {
			case got := <-received:
				if want := append(append([]byte{}, tc.greeting...), tc.auth...); !bytes.Equal(got, want) {
					t.Fatalf("the server received %x, want exactly %x", got, want)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("the fake server never finished")
			}
		})
	}
}

func TestSocksClientRejectsUnusableCredentialsBeforeDialing(t *testing.T) {
	dialed := false
	replaceDialer(t, func(ctx context.Context, address string, deadline time.Time) (net.Conn, error) {
		dialed = true
		return nil, errors.New("must not be dialed")
	})
	for name, p := range map[string]profile{
		"username of 256 bytes":       {Type: "socks5", Host: "127.0.0.1", Port: 1080, Username: strings.Repeat("u", 256), Password: "p"},
		"password of 256 bytes":       {Type: "socks5", Host: "127.0.0.1", Port: 1080, Username: "u", Password: strings.Repeat("p", 256)},
		"username without a password": {Type: "socks5", Host: "127.0.0.1", Port: 1080, Username: "u"},
	} {
		t.Run(name, func(t *testing.T) {
			c, err := dialSocks(p)
			if c != nil {
				c.Close()
			}
			wantDiagnostic(t, err, "invalid-config", "auth", false)
		})
	}
	if dialed {
		t.Fatal("unusable credentials still caused a connection attempt")
	}
}

func TestSocksConnectCodeTable(t *testing.T) {
	for _, tc := range []struct {
		rep       byte
		code      string
		retryable bool
	}{
		{0x00, "", false},
		{0x01, "proxy-error", true},
		{0x02, "proxy-denied", false},
		{0x03, "network-unreachable", true},
		{0x04, "host-unreachable", true},
		{0x05, "connection-refused", true},
		{0x06, "timeout", true},
		{0x07, "unsupported", false},
		{0x08, "unsupported", false},
		{0x09, "proxy-error", true},
		{0x0a, "proxy-error", true},
		{0x7f, "proxy-error", true},
		{0xff, "proxy-error", true},
	} {
		if code, retryable := socksConnectCode(tc.rep); code != tc.code || retryable != tc.retryable {
			t.Errorf("REP %#x: got %q/%v, want %q/%v", tc.rep, code, retryable, tc.code, tc.retryable)
		}
	}
	// The closed set of codes this function can ever produce.
	allowed := map[string]bool{"": true, "proxy-error": true, "proxy-denied": true, "network-unreachable": true, "host-unreachable": true, "connection-refused": true, "timeout": true, "unsupported": true}
	for rep := 0; rep < 256; rep++ {
		if code, _ := socksConnectCode(byte(rep)); !allowed[code] {
			t.Errorf("REP %#x produced %q", rep, code)
		}
	}
}

// replyingSocks is a no-authentication SOCKS5 server that answers every CONNECT with reply and records the request.
func replyingSocks(t *testing.T, reply []byte) (profile, <-chan []byte) {
	t.Helper()
	addr, requests := fakeSocksUpstream(t, reply, func(c net.Conn) { io.Copy(c, c) })
	return profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port}, requests
}

func TestSocksConnectMapsEveryReplyByte(t *testing.T) {
	for rep := 0; rep <= 9; rep++ {
		t.Run(string(rune('0'+rep)), func(t *testing.T) {
			p, _ := replyingSocks(t, []byte{5, byte(rep), 0, 1, 0, 0, 0, 0, 0, 0})
			c, err := socksConnect(p, "destination.invalid", 443)
			if rep == 0 {
				if err != nil {
					t.Fatalf("success reply refused: %v", err)
				}
				c.Write([]byte("x"))
				back := make([]byte, 1)
				if _, err = io.ReadFull(c, back); err != nil || back[0] != 'x' {
					t.Fatalf("the returned connection does not carry the tunnel: %v", err)
				}
				c.Close()
				return
			}
			code, retryable := socksConnectCode(byte(rep))
			wantDiagnostic(t, err, code, "socks", retryable)
		})
	}
	// REP 4 used to read as a DNS failure; it is now what the server said.
	p, _ := replyingSocks(t, []byte{5, 4, 0, 1, 0, 0, 0, 0, 0, 0})
	_, err := socksConnect(p, "destination.invalid", 443)
	wantDiagnostic(t, err, "host-unreachable", "socks", true)
}

func TestSocksConnectKeepsTheCodeOfAMalformedRefusal(t *testing.T) {
	for name, reply := range map[string][]byte{
		"unknown ATYP":     {5, 5, 0, 9, 1, 2},
		"cut after head":   {5, 5, 0, 1},
		"cut after REP":    {5, 5},
		"domain tail only": {5, 5, 0, 3, 200},
	} {
		t.Run(name, func(t *testing.T) {
			addr := listenLoopback(t, func(c net.Conn) {
				io.ReadFull(c, make([]byte, 3))
				c.Write([]byte{5, 0})
				io.ReadFull(c, make([]byte, 4+1+len("destination.invalid")+2))
				c.Write(reply)
			})
			_, err := socksConnect(profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port}, "destination.invalid", 443)
			if name == "cut after REP" {
				wantDiagnostic(t, err, "connection-failed", "socks", true) // the four-byte head never completed
				return
			}
			wantDiagnostic(t, err, "connection-refused", "socks", true)
		})
	}
	p, _ := replyingSocks(t, []byte{4, 0, 0, 1, 0, 0, 0, 0, 0, 0})
	_, err := socksConnect(p, "destination.invalid", 443)
	wantDiagnostic(t, err, "proxy-error", "socks", false)
}

func TestSocksConnectSendsTheDestinationUnresolved(t *testing.T) {
	for _, tc := range []struct {
		host string
		port int
		want []byte
	}{
		{"never-resolved.invalid", 443, append([]byte{5, 1, 0, 3}, domainAddress("never-resolved.invalid", 443)...)},
		{"192.0.2.9", 80, []byte{5, 1, 0, 1, 192, 0, 2, 9, 0, 80}},
		{"2001:db8::7", 8443, append(append([]byte{5, 1, 0, 4, 0x20, 0x01, 0x0d, 0xb8}, make([]byte, 11)...), 7, 0x20, 0xfb)},
	} {
		t.Run(tc.host, func(t *testing.T) {
			p, requests := replyingSocks(t, []byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0})
			c, err := socksConnect(p, tc.host, tc.port)
			if err != nil {
				t.Fatal(err)
			}
			c.Close()
			if got := <-requests; !bytes.Equal(got, tc.want) {
				t.Fatalf("request %x, want %x", got, tc.want)
			}
		})
	}
	for _, bad := range []struct {
		host string
		port int
	}{{"", 80}, {"has space.invalid", 80}, {"ok.invalid", 0}, {"ok.invalid", 65536}} {
		if c, err := socksConnect(profile{Type: "socks5", Host: "127.0.0.1", Port: closedPort(t)}, bad.host, bad.port); err == nil {
			c.Close()
			t.Fatalf("accepted destination %q:%d", bad.host, bad.port)
		} else {
			wantDiagnostic(t, err, "invalid-config", "endpoint", false) // rejected before any connection
		}
	}
}

func TestSocksConnectStallsEndAtTheExchangeDeadline(t *testing.T) {
	shortTimeouts(t, 2*time.Second, 300*time.Millisecond)
	addr := listenLoopback(t, func(c net.Conn) {
		io.ReadFull(c, make([]byte, 3))
		c.Write([]byte{5, 0})
		io.Copy(io.Discard, c) // accepts the request and never answers it
	})
	started := time.Now()
	_, err := socksConnect(profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port}, "destination.invalid", 443)
	wantDiagnostic(t, err, "timeout", "socks", true)
	if time.Since(started) > 2*time.Second {
		t.Fatal("the stalled CONNECT held the caller past its deadline")
	}
}

func TestRelaySendsNoLoginToAnUpstreamThatWantsNone(t *testing.T) {
	// Credentials make the client offer both methods; a server that picks "none" must next receive the CONNECT, not a login.
	next := make(chan []byte, 1)
	greeting := make(chan []byte, 1)
	addr := listenLoopback(t, func(c net.Conn) {
		offer := make([]byte, 4)
		io.ReadFull(c, offer)
		greeting <- offer
		c.Write([]byte{5, 0})
		head := make([]byte, 5)
		io.ReadFull(c, head)
		next <- head
		c.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0})
		io.Copy(c, c)
	})
	relay, err := startRelay(profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port, Username: "alice", Password: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()
	c, reply := browserConnect(t, relay, 3, domainAddress("destination.invalid", 443))
	if reply[1] != 0 {
		t.Fatalf("connect failed with %x", reply)
	}
	c.Close()
	if offer := <-greeting; !bytes.Equal(offer, []byte{5, 2, 0, 2}) {
		t.Fatalf("greeting %x", offer)
	}
	if head := <-next; !bytes.Equal(head, []byte{5, 1, 0, 3, byte(len("destination.invalid"))}) {
		t.Fatalf("after \"no authentication\" the server received %x instead of the CONNECT request", head)
	}
}

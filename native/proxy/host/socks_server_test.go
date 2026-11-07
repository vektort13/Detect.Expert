package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"os"
	"sync"
	"syscall"
	"testing"
	"time"
)

// idleRelay is a relay whose upstream refuses connections: a request that reaches the upstream phase is answered with code 5.
func idleRelay(t *testing.T) *socksRelay {
	t.Helper()
	relay, err := startRelay(profile{Type: "socks5", Host: "127.0.0.1", Port: closedPort(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(relay.Close)
	return relay
}

// converse sends raw bytes to the relay, half-closes, and returns everything the relay says before it closes the connection.
func converse(t *testing.T, relay *socksRelay, send []byte) []byte {
	t.Helper()
	c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err = c.Write(send); err != nil {
		t.Fatal(err)
	}
	c.(*net.TCPConn).CloseWrite()
	data, err := io.ReadAll(c)
	var network net.Error
	if errors.As(err, &network) && network.Timeout() {
		t.Fatalf("the relay left the connection open after %x", send)
	}
	return data // a reset after the relay closed with unread input is not a failure here
}

func TestRelayGreetingFollowsRFC1928(t *testing.T) {
	relay := idleRelay(t)
	for _, tc := range []struct {
		name string
		send []byte
		want []byte
	}{
		{"NMETHODS 0 has no acceptable method", []byte{5, 0}, []byte{5, 255}},
		{"username/password only", []byte{5, 1, 2}, []byte{5, 255}},
		{"GSSAPI and username/password", []byte{5, 2, 1, 2}, []byte{5, 255}},
		{"no authentication among others", []byte{5, 3, 2, 0, 1}, []byte{5, 0}},
		{"no authentication only", []byte{5, 1, 0}, []byte{5, 0}},
		{"SOCKS4 client is closed silently", []byte{4, 1, 0, 80, 1, 2, 3, 4, 0}, nil},
		{"version 0 is closed silently", []byte{0, 1, 0}, nil},
		{"an HTTP request is closed silently", []byte("GET / HTTP/1.1\r\n\r\n"), nil},
		{"truncated method list is closed silently", []byte{5, 3, 0}, nil},
		{"truncated header is closed silently", []byte{5}, nil},
		{"nothing at all", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := converse(t, relay, tc.send); string(got) != string(tc.want) {
				t.Fatalf("got %x, want %x", got, tc.want)
			}
		})
	}
}

func TestRelayRequestRefusalsUseTheRFC1928Replies(t *testing.T) {
	relay := idleRelay(t)
	ipv4 := []byte{192, 0, 2, 1, 0, 80}
	request := func(version, command, reserved, atyp byte, address []byte) []byte {
		return append([]byte{5, 1, 0, version, command, reserved, atyp}, address...)
	}
	// Spelled out on purpose: BND.ADDR 0.0.0.0, BND.PORT 0, never an echo of anything the client sent.
	refusal := func(code byte) []byte { return []byte{5, 0, 5, code, 0, 1, 0, 0, 0, 0, 0, 0} }
	greeted := []byte{5, 0}
	for _, tc := range []struct {
		name string
		send []byte
		want []byte
	}{
		{"BIND", request(5, 2, 0, 1, ipv4), refusal(7)},
		{"UDP ASSOCIATE", request(5, 3, 0, 1, []byte{0, 0, 0, 0, 0, 0}), refusal(7)},
		{"unknown command 9", request(5, 9, 0, 1, ipv4), refusal(7)},
		{"command 0", request(5, 0, 0, 1, ipv4), refusal(7)},
		{"RSV not zero", request(5, 1, 1, 1, ipv4), refusal(1)},
		{"ATYP 0", request(5, 1, 0, 0, ipv4), refusal(8)},
		{"ATYP 2", request(5, 1, 0, 2, ipv4), refusal(8)},
		{"ATYP 5", request(5, 1, 0, 5, ipv4), refusal(8)},
		{"ATYP 9", request(5, 1, 0, 9, ipv4), refusal(8)},
		{"empty domain", request(5, 1, 0, 3, []byte{0, 0, 80}), refusal(8)},
		{"the command is judged before RSV and ATYP", request(5, 9, 1, 9, nil), refusal(7)},
		{"RSV is judged before ATYP", request(5, 1, 1, 9, nil), refusal(1)},
		{"request VER 4 is closed silently", request(4, 1, 0, 1, ipv4), greeted},
		{"truncated head", []byte{5, 1, 0, 5, 1, 0}, greeted},
		{"truncated IPv4", request(5, 1, 0, 1, []byte{192, 0, 2}), greeted},
		{"domain length byte missing", request(5, 1, 0, 3, nil), greeted},
		{"truncated domain", request(5, 1, 0, 3, []byte{9, 'a', 'b'}), greeted},
		{"truncated port", request(5, 1, 0, 3, []byte{1, 'a', 0}), greeted},
		{"a valid request reaches the upstream phase", request(5, 1, 0, 1, ipv4), refusal(5)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := converse(t, relay, tc.send); string(got) != string(tc.want) {
				t.Fatalf("got %x, want %x", got, tc.want)
			}
		})
	}
}

func TestRelayRefusalSurvivesInputItNeverRead(t *testing.T) {
	// A pipelining client sends more than the refused request and reads late. Closing a socket that still holds unread input
	// resets the connection, and a reset can discard a reply the client has not read yet; the relay must drain before it closes.
	relay := idleRelay(t)
	send := append([]byte{5, 1, 0, 5, 3, 0, 1, 0, 0, 0, 0, 0, 0}, bytes.Repeat([]byte("optimistic-data"), 40)...)
	want := []byte{5, 0, 5, 7, 0, 1, 0, 0, 0, 0, 0, 0}
	for i := 0; i < 10; i++ {
		c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), time.Second)
		if err != nil {
			t.Fatal(err)
		}
		c.SetDeadline(time.Now().Add(5 * time.Second))
		if _, err = c.Write(send); err != nil {
			t.Fatal(err)
		}
		c.(*net.TCPConn).CloseWrite()
		time.Sleep(150 * time.Millisecond) // the relay has answered and closed by now
		got, err := io.ReadAll(c)
		c.Close()
		if err != nil || string(got) != string(want) {
			t.Fatalf("attempt %d: got %x (%v), want %x", i, got, err, want)
		}
	}
}

type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

func TestClassifyNetworkCodes(t *testing.T) {
	op := func(err error) error {
		return &net.OpError{Op: "dial", Net: "tcp", Err: os.NewSyscallError("connect", err)}
	}
	for _, tc := range []struct {
		name string
		err  error
		code string
	}{
		{"refused", op(syscall.ECONNREFUSED), "connection-refused"},
		{"WSAECONNREFUSED", op(syscall.Errno(10061)), "connection-refused"},
		{"network unreachable", op(syscall.ENETUNREACH), "network-unreachable"},
		{"network down", op(syscall.ENETDOWN), "network-unreachable"},
		{"WSAENETUNREACH", op(syscall.Errno(10051)), "network-unreachable"},
		{"WSAENETDOWN", op(syscall.Errno(10050)), "network-unreachable"},
		{"no route to host", op(syscall.EHOSTUNREACH), "host-unreachable"},
		{"host down", op(syscall.EHOSTDOWN), "host-unreachable"},
		{"WSAEHOSTUNREACH", op(syscall.Errno(10065)), "host-unreachable"},
		{"WSAEHOSTDOWN", op(syscall.Errno(10064)), "host-unreachable"},
		{"timeout", &net.OpError{Op: "dial", Net: "tcp", Err: timeoutError{}}, "timeout"},
		{"reset", op(syscall.ECONNRESET), "connection-failed"},
		{"EOF", io.EOF, "connection-failed"},
	} {
		t.Run(tc.name, func(t *testing.T) { wantDiagnostic(t, classifyNetwork(tc.err, "endpoint"), tc.code, "endpoint", true) })
	}
	wantDiagnostic(t, classifyNetwork(&net.DNSError{Err: "no such host", Name: "proxy.invalid", IsNotFound: true}, "endpoint"), "dns-failed", "dns", true)
}

func TestSocksReplyCodeIsWhatASocksServerWouldSend(t *testing.T) {
	for code, want := range map[string]byte{
		"auth-failed": 2, "auth-required": 2, "proxy-denied": 2,
		"network-unreachable": 3, "host-unreachable": 4, "connection-refused": 5, "timeout": 6,
		"dns-failed": 1, "tls-failed": 1, "proxy-error": 1, "connection-failed": 1, "unsupported": 1, "invalid-config": 1,
	} {
		if got := socksReplyCode(fail(code, "x", false)); got != want {
			t.Errorf("%s: got %d, want %d", code, got, want)
		}
	}
	if socksReplyCode(errors.New("not a fixed diagnostic")) != 1 {
		t.Error("an unclassified error must be a general failure")
	}
}

// fakeSocksUpstream accepts a no-authentication negotiation, records the CONNECT request, and answers with reply. A tunnel
// function, if given, then owns the connection.
func fakeSocksUpstream(t *testing.T, reply []byte, tunnel func(net.Conn)) (*net.TCPAddr, <-chan []byte) {
	t.Helper()
	requests := make(chan []byte, 8)
	addr := listenLoopback(t, func(c net.Conn) {
		var greeting [3]byte
		if _, err := io.ReadFull(c, greeting[:]); err != nil || greeting != [3]byte{5, 1, 0} {
			return
		}
		c.Write([]byte{5, 0})
		var head [4]byte
		if _, err := io.ReadFull(c, head[:]); err != nil {
			return
		}
		address, err := readSocksAddress(c, head[3])
		if err != nil {
			return
		}
		requests <- append(head[:], address...)
		c.Write(reply)
		if tunnel != nil {
			tunnel(c)
		}
	})
	return addr, requests
}

func TestRelayAnswersUpstreamFailuresLikeASocksServer(t *testing.T) {
	stalled := func(t *testing.T) profile {
		shortTimeouts(t, 2*time.Second, 300*time.Millisecond)
		addr := listenLoopback(t, func(c net.Conn) { io.Copy(io.Discard, c) })
		return profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port}
	}
	scripted := func(username, password string, script func(c net.Conn)) func(t *testing.T) profile {
		return func(t *testing.T) profile {
			addr := listenLoopback(t, script)
			return profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port, Username: username, Password: password}
		}
	}
	greetThen := func(choice []byte, then func(c net.Conn)) func(c net.Conn) {
		return func(c net.Conn) {
			io.ReadFull(c, make([]byte, 3))
			c.Write(choice)
			if then != nil {
				then(c)
			}
		}
	}
	dialFails := func(err error) func(t *testing.T) profile {
		return func(t *testing.T) profile {
			replaceDialer(t, func(ctx context.Context, address string, deadline time.Time) (net.Conn, error) { return nil, err })
			return profile{Type: "socks5", Host: "upstream.example", Port: 1080}
		}
	}
	op := func(err error) error {
		return &net.OpError{Op: "dial", Net: "tcp", Err: os.NewSyscallError("connect", err)}
	}
	for _, tc := range []struct {
		name  string
		setup func(t *testing.T) profile
		want  byte
	}{
		{"upstream refuses the connection", func(t *testing.T) profile {
			return profile{Type: "socks5", Host: "127.0.0.1", Port: closedPort(t)}
		}, 5},
		{"upstream never answers", stalled, 6},
		{"upstream wants authentication and none is configured", scripted("", "", greetThen([]byte{5, 255}, nil)), 2},
		{"upstream insists on a login although none is configured", scripted("", "", greetThen([]byte{5, 2}, nil)), 2},
		{"upstream accepts none of our methods", scripted("user", "secret", greetThen([]byte{5, 255}, nil)), 2},
		{"upstream refuses our credentials", scripted("user", "wrong", greetThen([]byte{5, 2}, func(c net.Conn) {
			io.ReadFull(c, make([]byte, 3+4+5))
			c.Write([]byte{1, 1})
		})), 2},
		{"upstream closes after the greeting", scripted("", "", func(c net.Conn) { io.ReadFull(c, make([]byte, 3)) }), 1},
		{"upstream is not a SOCKS5 server", scripted("", "", greetThen([]byte{4, 0}, nil)), 1},
		{"upstream picks a method nobody offered", scripted("", "", greetThen([]byte{5, 3}, nil)), 1},
		{"network unreachable", dialFails(op(syscall.ENETUNREACH)), 3},
		{"Winsock network unreachable", dialFails(op(syscall.Errno(10051))), 3},
		{"no route to host", dialFails(op(syscall.EHOSTUNREACH)), 4},
		{"Winsock no route to host", dialFails(op(syscall.Errno(10065))), 4},
		{"connect timeout", dialFails(&net.OpError{Op: "dial", Net: "tcp", Err: timeoutError{}}), 6},
		{"upstream name does not resolve", dialFails(&net.DNSError{Err: "no such host", Name: "upstream.example", IsNotFound: true}), 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			relay, err := startRelay(tc.setup(t))
			if err != nil {
				t.Fatal(err)
			}
			defer relay.Close()
			c, reply := browserConnect(t, relay, 3, domainAddress("destination.invalid", 443))
			if want := []byte{5, tc.want, 0, 1, 0, 0, 0, 0, 0, 0}; !bytes.Equal(reply, want) {
				t.Fatalf("got %x, want %x", reply, want)
			}
			if rest, _ := io.ReadAll(c); len(rest) != 0 {
				t.Fatalf("the relay kept talking after a refusal: %x", rest)
			}
		})
	}
}

func TestRelayForwardsUpstreamRepliesUnchanged(t *testing.T) {
	ipv6 := append(append([]byte{5, 2, 0, 4}, bytes.Repeat([]byte{0}, 15)...), 1, 1, 187)
	for _, tc := range []struct {
		name  string
		reply []byte
		want  []byte
	}{
		{"host unreachable with an IPv4 bound address", []byte{5, 4, 0, 1, 0, 0, 0, 0, 0, 0}, nil},
		{"refused with a domain bound address", []byte{5, 5, 0, 3, 3, 'a', 'b', 'c', 0, 80}, nil},
		{"ruleset with an IPv6 bound address", ipv6, nil},
		{"TTL expired with a real-looking bound address", []byte{5, 6, 0, 1, 10, 1, 2, 3, 4, 210}, nil},
		{"a refusal with a malformed tail keeps its code", []byte{5, 6, 0, 9, 1, 2, 3}, []byte{5, 6, 0, 1, 0, 0, 0, 0, 0, 0}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream, requests := fakeSocksUpstream(t, tc.reply, nil)
			relay, err := startRelay(profile{Type: "socks5", Host: "127.0.0.1", Port: upstream.Port})
			if err != nil {
				t.Fatal(err)
			}
			defer relay.Close()
			want := tc.want
			if want == nil {
				want = tc.reply
			}
			c, reply := func() (net.Conn, []byte) {
				if tc.want != nil { // the malformed tail cannot be read by the browser helper
					c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), time.Second)
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { c.Close() })
					c.SetDeadline(time.Now().Add(5 * time.Second))
					c.Write([]byte{5, 1, 0})
					io.ReadFull(c, make([]byte, 2))
					c.Write(append([]byte{5, 1, 0, 3}, domainAddress("destination.invalid", 443)...))
					data := make([]byte, len(want))
					io.ReadFull(c, data)
					return c, data
				}
				return browserConnect(t, relay, 3, domainAddress("destination.invalid", 443))
			}()
			if !bytes.Equal(reply, want) {
				t.Fatalf("got %x, want %x", reply, want)
			}
			if rest, _ := io.ReadAll(c); len(rest) != 0 {
				t.Fatalf("the relay kept talking after a refusal: %x", rest)
			}
			if request := <-requests; !bytes.Equal(request, append([]byte{5, 1, 0, 3}, domainAddress("destination.invalid", 443)...)) {
				t.Fatalf("the destination did not reach the upstream untouched: %x", request)
			}
		})
	}
}

func TestRelayForwardsASuccessfulUpstreamReplyAndTheTunnel(t *testing.T) {
	reply := append(append([]byte{5, 0, 0, 4}, bytes.Repeat([]byte{0}, 15)...), 1, 0x1f, 0x90)
	upstream, _ := fakeSocksUpstream(t, reply, func(c net.Conn) { io.Copy(c, c) })
	relay, err := startRelay(profile{Type: "socks5", Host: "127.0.0.1", Port: upstream.Port})
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()
	c, got := browserConnect(t, relay, 1, []byte{192, 0, 2, 5, 0, 80})
	if !bytes.Equal(got, reply) {
		t.Fatalf("success reply changed: %x", got)
	}
	c.Write([]byte("through the tunnel"))
	c.(*net.TCPConn).CloseWrite()
	echoed, err := io.ReadAll(c)
	if err != nil || string(echoed) != "through the tunnel" {
		t.Fatalf("tunnel data: %q, %v", echoed, err)
	}
}

func TestRelayCloseAbortsAnUpstreamNegotiationInProgress(t *testing.T) {
	var arrived sync.Once
	here, gone := make(chan struct{}), make(chan struct{})
	upstream := listenLoopback(t, func(c net.Conn) {
		arrived.Do(func() { close(here) })
		io.Copy(io.Discard, c) // never answers; ends when the relay drops the connection
		close(gone)
	})
	relay, err := startRelay(profile{Type: "socks5", Host: "127.0.0.1", Port: upstream.Port})
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
	case <-here:
	case <-time.After(3 * time.Second):
		t.Fatal("the relay never contacted the upstream")
	}
	relay.Close() // the exchange budget is 10 s; Disconnect must not wait for it
	select {
	case <-gone:
	case <-time.After(2 * time.Second):
		t.Fatal("Close left the upstream negotiation running")
	}
}

func TestRelayEnforcesTheRequestDeadline(t *testing.T) {
	old := clientRequestTimeout.get()
	clientRequestTimeout.set(200 * time.Millisecond)
	t.Cleanup(func() { clientRequestTimeout.set(old) })
	relay := idleRelay(t)
	c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(3 * time.Second))
	c.Write([]byte{5, 1}) // a greeting that never completes
	if _, err = io.ReadAll(c); err != nil {
		var network net.Error
		if errors.As(err, &network) && network.Timeout() {
			t.Fatal("a stalled client held the relay past its request deadline")
		}
	}
}

func TestRelayWaitsForASlowUpstreamLongerThanTheRequestDeadline(t *testing.T) {
	// The request deadline bounds what the browser sends; once the request is in, the upstream phase has its own deadlines.
	old := clientRequestTimeout.get()
	clientRequestTimeout.set(200 * time.Millisecond)
	t.Cleanup(func() { clientRequestTimeout.set(old) })
	for name, start := range map[string]func(t *testing.T) profile{
		"socks5": func(t *testing.T) profile {
			upstream, _ := fakeSocksUpstream(t, []byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}, func(c net.Conn) { io.Copy(c, c) })
			slow := listenLoopback(t, func(c net.Conn) {
				time.Sleep(500 * time.Millisecond) // the whole upstream is slow to speak
				back, err := net.Dial("tcp4", upstream.String())
				if err != nil {
					return
				}
				defer back.Close()
				go func() {
					io.Copy(back, c)
					back.(*net.TCPConn).CloseWrite() // pass the browser's half-close on to the real upstream
				}()
				io.Copy(c, back)
			})
			return profile{Type: "socks5", Host: "127.0.0.1", Port: slow.Port}
		},
		"http": func(t *testing.T) profile {
			addr, _ := httpProxy(t, func(c net.Conn, seen connectSeen) {
				time.Sleep(500 * time.Millisecond)
				echoTunnel(c, seen)
			})
			return profile{Type: "http", Host: "127.0.0.1", Port: addr.Port}
		},
	} {
		t.Run(name, func(t *testing.T) {
			relay, err := startRelay(start(t))
			if err != nil {
				t.Fatal(err)
			}
			defer relay.Close()
			c, reply := browserConnect(t, relay, 3, domainAddress("destination.invalid", 443))
			if reply[1] != 0 {
				t.Fatalf("a slow upstream was cut off by the browser-side deadline: %x", reply)
			}
			c.Write([]byte("ping"))
			c.(*net.TCPConn).CloseWrite()
			if echoed, err := io.ReadAll(c); err != nil || string(echoed) != "ping" {
				t.Fatalf("tunnel data %q, %v", echoed, err)
			}
		})
	}
}

func TestRelayServesAtMost128ConnectionsAtOnce(t *testing.T) {
	relay := idleRelay(t)
	var held []net.Conn
	t.Cleanup(func() {
		for _, c := range held {
			c.Close()
		}
	})
	for i := 0; i < 128; i++ {
		c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), time.Second)
		if err != nil {
			t.Fatal(err)
		}
		held = append(held, c)
	}
	// Wait until the relay has accepted all of them: the 129th must then be dropped at once.
	deadline := time.Now().Add(3 * time.Second)
	for len(relay.sem) < 128 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	extra, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer extra.Close()
	extra.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err = extra.Read(make([]byte, 1)); err == nil {
		t.Fatal("the 129th connection was served")
	} else if errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatal("the 129th connection was left open instead of dropped")
	}
	held[0].Close() // a slot frees up
	deadline = time.Now().Add(3 * time.Second)
	for {
		c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), time.Second)
		if err != nil {
			t.Fatal(err)
		}
		c.SetDeadline(time.Now().Add(time.Second))
		c.Write([]byte{5, 1, 0})
		var method [2]byte
		_, err = io.ReadFull(c, method[:])
		c.Close()
		if err == nil && method == [2]byte{5, 0} {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("a freed slot was never reused")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestRelayIsLoopbackOnlyAndDropsSecretsOnClose(t *testing.T) {
	relay, err := startRelay(profile{Type: "socks5", Host: "127.0.0.1", Port: 1080, Username: "owned-user", Password: "owned-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if address := relay.listener.Addr().(*net.TCPAddr); !address.IP.IsLoopback() || address.IP.To4() == nil {
		t.Fatalf("relay listens on %v", address)
	}
	relay.Close()
	if relay.profile.Username != "" || relay.profile.Password != "" {
		t.Fatal("relay kept credentials after Close")
	}
	if c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), 500*time.Millisecond); err == nil {
		c.Close()
		t.Fatal("relay still listens after Close")
	}
}

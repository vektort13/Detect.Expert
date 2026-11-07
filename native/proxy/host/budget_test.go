package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// pause waits up to d for the peer to hang up and reports whether it did: a slow server that also notices a peer that gave up.
func pause(c net.Conn, d time.Duration) (hungUp bool) {
	c.SetReadDeadline(time.Now().Add(d))
	_, err := c.Read(make([]byte, 1))
	c.SetReadDeadline(time.Now().Add(10 * time.Second))
	var network net.Error
	return err != nil && !(errors.As(err, &network) && network.Timeout())
}

// slowSocks is a no-authentication SOCKS5 server that waits before each of its two answers. A value arrives on gone whenever a
// connection ends because the peer hung up while the server was still waiting.
func slowSocks(t *testing.T, beforeMethod, beforeReply time.Duration, tunnel func(net.Conn)) (*net.TCPAddr, <-chan struct{}) {
	t.Helper()
	gone := make(chan struct{}, 16)
	addr := listenLoopback(t, func(c net.Conn) {
		if _, err := io.ReadFull(c, make([]byte, 3)); err != nil {
			return
		}
		if pause(c, beforeMethod) {
			gone <- struct{}{}
			return
		}
		if _, err := c.Write([]byte{5, 0}); err != nil {
			return
		}
		head := make([]byte, 4)
		if _, err := io.ReadFull(c, head); err != nil {
			return
		}
		if _, err := readSocksAddress(c, head[3]); err != nil {
			return
		}
		if pause(c, beforeReply) {
			gone <- struct{}{}
			return
		}
		c.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0})
		if tunnel != nil {
			tunnel(c)
		}
	})
	return addr, gone
}

// pipeTo joins the client with a fresh connection to origin, like a SOCKS5 server does after its success reply.
func pipeTo(origin string) func(net.Conn) {
	return func(c net.Conn) {
		remote, err := net.DialTimeout("tcp", origin, time.Second)
		if err != nil {
			return
		}
		defer remote.Close()
		go io.Copy(remote, c)
		io.Copy(c, remote)
	}
}

// slowOrigin answers the probe request after delay.
func slowOrigin(t *testing.T, delay time.Duration) string {
	t.Helper()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(delay)
		fmt.Fprint(w, `{"ip":"203.0.113.9"}`)
	}))
	t.Cleanup(origin.Close)
	return origin.Listener.Addr().String()
}

func setSetupCap(t *testing.T, d time.Duration) {
	t.Helper()
	old := connectionSetupTimeout.get()
	connectionSetupTimeout.set(d)
	t.Cleanup(func() { connectionSetupTimeout.set(old) })
}

func setCheckBudget(t *testing.T, d time.Duration) {
	t.Helper()
	old := checkBudget.get()
	checkBudget.set(d)
	t.Cleanup(func() { checkBudget.set(old) })
}

// relayConnect makes a browser-style CONNECT through a fresh relay for p and times it.
func relayConnect(t *testing.T, p profile) (net.Conn, []byte, time.Duration) {
	t.Helper()
	relay, err := startRelay(p)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(relay.Close)
	started := time.Now()
	c, reply := browserConnect(t, relay, 3, domainAddress("destination.invalid", 443))
	return c, reply, time.Since(started)
}

func TestRelayCapsTheWholeSetupNotJustEachPhase(t *testing.T) {
	shortTimeouts(t, 2*time.Second, 2*time.Second) // every phase alone has time to spare
	for _, tc := range []struct {
		name  string
		start func(t *testing.T) (profile, <-chan struct{})
		slow  time.Duration // how long this peer takes in all
		cap   time.Duration
	}{
		{"socks5: two answers of 300 ms each", func(t *testing.T) (profile, <-chan struct{}) {
			addr, gone := slowSocks(t, 300*time.Millisecond, 300*time.Millisecond, func(c net.Conn) { io.Copy(c, c) })
			return profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port}, gone
		}, 600 * time.Millisecond, 500 * time.Millisecond},
		{"http: one answer of 800 ms", func(t *testing.T) (profile, <-chan struct{}) {
			gone := make(chan struct{}, 4)
			addr, _ := httpProxy(t, func(c net.Conn, seen connectSeen) {
				if pause(c, 800*time.Millisecond) {
					gone <- struct{}{}
					return
				}
				echoTunnel(c, seen)
			})
			return httpClientProfile(addr, "", ""), gone
		}, 800 * time.Millisecond, 400 * time.Millisecond},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setSetupCap(t, tc.cap)
			p, gone := tc.start(t)
			_, reply, elapsed := relayConnect(t, p)
			if reply[1] != 6 {
				t.Fatalf("reply %x: a setup beyond its cap must be answered with TTL expired", reply)
			}
			if elapsed < tc.cap-100*time.Millisecond || elapsed > tc.cap+900*time.Millisecond {
				t.Fatalf("the browser waited %v for a cap of %v", elapsed, tc.cap)
			}
			select {
			case <-gone:
			case <-time.After(2 * time.Second):
				t.Fatal("the upstream connection was left open after the cap")
			}
		})
		t.Run(tc.name+" (control: a cap that is not reached)", func(t *testing.T) {
			setSetupCap(t, 5*time.Second)
			p, _ := tc.start(t)
			c, reply, elapsed := relayConnect(t, p)
			if reply[1] != 0 || elapsed < tc.slow-100*time.Millisecond {
				t.Fatalf("the slow peer is meant to succeed slowly: reply %x after %v", reply, elapsed)
			}
			c.Close()
		})
	}
}

func TestRelayCapCountsFromAcceptSoASlowBrowserSpendsIt(t *testing.T) {
	shortTimeouts(t, 2*time.Second, 2*time.Second)
	addr, _ := slowSocks(t, 0, 300*time.Millisecond, func(c net.Conn) { io.Copy(c, c) })
	for _, tc := range []struct {
		name         string
		browserDelay time.Duration
		cap          time.Duration
		want         byte
	}{
		{"a browser that takes 300 ms before its greeting, 300 ms upstream, cap 500 ms", 300 * time.Millisecond, 500 * time.Millisecond, 6},
		{"a prompt browser with the same peer and cap", 0, 500 * time.Millisecond, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setSetupCap(t, tc.cap)
			relay, err := startRelay(profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port})
			if err != nil {
				t.Fatal(err)
			}
			defer relay.Close()
			c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", relay.port()), time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			c.SetDeadline(time.Now().Add(8 * time.Second))
			time.Sleep(tc.browserDelay)
			c.Write([]byte{5, 1, 0})
			io.ReadFull(c, make([]byte, 2))
			c.Write(append([]byte{5, 1, 0, 3}, domainAddress("destination.invalid", 443)...))
			if reply := browserReply(t, c); reply[1] != tc.want {
				t.Fatalf("reply %x, want code %d", reply, tc.want)
			}
		})
	}
}

func TestRelayCapEndsWithTheSetupAndNeverLimitsAStandingTunnel(t *testing.T) {
	setSetupCap(t, 300*time.Millisecond)
	socksAddr, _ := fakeSocksUpstream(t, []byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}, func(c net.Conn) { io.Copy(c, c) })
	httpAddr, _ := httpProxy(t, echoTunnel)
	for name, p := range map[string]profile{
		"socks5": {Type: "socks5", Host: "127.0.0.1", Port: socksAddr.Port},
		"http":   httpClientProfile(httpAddr, "", ""),
	} {
		t.Run(name, func(t *testing.T) {
			c, reply, _ := relayConnect(t, p)
			if reply[1] != 0 {
				t.Fatalf("reply %x", reply)
			}
			time.Sleep(800 * time.Millisecond) // well beyond the cap
			c.Write([]byte("late"))
			back := make([]byte, 4)
			if _, err := io.ReadFull(c, back); err != nil || string(back) != "late" {
				t.Fatalf("the cap reached into the standing tunnel: %q, %v", back, err)
			}
		})
	}
}

func TestSocksChecksHonourTheCallerContext(t *testing.T) {
	shortTimeouts(t, 5*time.Second, 5*time.Second) // only the context can end these in time
	negotiation := listenLoopback(t, func(c net.Conn) { io.Copy(io.Discard, c) })
	reply := listenLoopback(t, func(c net.Conn) {
		io.ReadFull(c, make([]byte, 3))
		c.Write([]byte{5, 0})
		io.Copy(io.Discard, c)
	})
	for name, port := range map[string]int{"the method negotiation": negotiation.Port, "the CONNECT reply": reply.Port} {
		p := profile{Type: "socks5", Host: "127.0.0.1", Port: port}
		t.Run(name+" ends at the deadline of the context as a timeout", func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
			defer cancel()
			started := time.Now()
			c, err := socksConnectContext(ctx, p, "destination.invalid", 443)
			if c != nil {
				c.Close()
			}
			wantDiagnostic(t, err, "timeout", "socks", true)
			if time.Since(started) > 2*time.Second {
				t.Fatal("the context did not end the exchange")
			}
		})
		t.Run(name+" ends when the context is cancelled", func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			go func() { time.Sleep(200 * time.Millisecond); cancel() }()
			started := time.Now()
			c, err := socksConnectContext(ctx, p, "destination.invalid", 443)
			if c != nil {
				c.Close()
			}
			if err == nil || time.Since(started) > 2*time.Second {
				t.Fatalf("cancellation did not end the exchange: %v after %v", err, time.Since(started))
			}
			if safeDiagnostic(err).Code == "timeout" {
				t.Fatal("a cancelled context is not a timeout")
			}
		})
	}
	t.Run("the probe of a SOCKS5 profile and the start of its tunnel", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		started := time.Now()
		tunnel, err := startTunnelContext(ctx, t.TempDir(), profile{Type: "socks5", Host: "127.0.0.1", Port: negotiation.Port})
		if tunnel != nil {
			tunnel.Close()
		}
		wantDiagnostic(t, err, "timeout", "socks", true)
		if time.Since(started) > 2*time.Second {
			t.Fatal("the context did not end the probe")
		}
	})
	t.Run("a diagnose through a SOCKS5 endpoint", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		go func() { time.Sleep(200 * time.Millisecond); cancel() }()
		started := time.Now()
		_, err := diagnoseProxyContext(ctx, "http://remote.invalid/", probeEndpoint{Host: "127.0.0.1", Port: reply.Port})
		if err == nil || time.Since(started) > 2*time.Second {
			t.Fatalf("cancellation did not end the diagnose: %v after %v", err, time.Since(started))
		}
	})
}

func TestChecksHaveOneOverallBudget(t *testing.T) {
	shortTimeouts(t, 5*time.Second, 5*time.Second) // no single phase comes near its own limit
	t.Run("diagnose through a SOCKS5 endpoint", func(t *testing.T) {
		origin := slowOrigin(t, 250*time.Millisecond)
		addr, _ := slowSocks(t, 250*time.Millisecond, 250*time.Millisecond, pipeTo(origin)) // 750 ms in all
		endpoint := probeEndpoint{Host: "127.0.0.1", Port: addr.Port}
		setCheckBudget(t, 600*time.Millisecond)
		started := time.Now()
		_, err := diagnoseProxy("http://remote.invalid/", endpoint)
		wantDiagnostic(t, err, "timeout", "tunnel", true)
		if elapsed := time.Since(started); elapsed < 500*time.Millisecond || elapsed > 1500*time.Millisecond {
			t.Fatalf("the check ended after %v, budget 600 ms", elapsed)
		}
		setCheckBudget(t, 5*time.Second) // control: the same peer within a budget it does not exhaust
		if result, err := diagnoseProxy("http://remote.invalid/", endpoint); err != nil || !result.Reachable || result.IP == nil {
			t.Fatalf("the slow peer is meant to work: %v %+v", err, result)
		}
	})
	t.Run("check of an HTTP profile", func(t *testing.T) {
		origin := slowOrigin(t, 300*time.Millisecond)
		addr, _ := httpProxy(t, func(c net.Conn, seen connectSeen) {
			time.Sleep(300 * time.Millisecond)
			tunnelTo(origin)(c, seen)
		})
		p := httpClientProfile(addr, "", "")
		setCheckBudget(t, 500*time.Millisecond)
		started := time.Now()
		_, err := diagnoseUpstream("http://remote.invalid/", p)
		wantDiagnostic(t, err, "timeout", "tunnel", true)
		if elapsed := time.Since(started); elapsed < 400*time.Millisecond || elapsed > 1500*time.Millisecond {
			t.Fatalf("the check ended after %v, budget 500 ms", elapsed)
		}
		setCheckBudget(t, 5*time.Second)
		if result, err := diagnoseUpstream("http://remote.invalid/", p); err != nil || !result.Reachable {
			t.Fatalf("the slow peer is meant to work: %v %+v", err, result)
		}
	})
	t.Run("check of a saved SOCKS5 profile covers its probe and its temporary relay too", func(t *testing.T) {
		origin := slowOrigin(t, 200*time.Millisecond)
		addr, _ := slowSocks(t, 200*time.Millisecond, 200*time.Millisecond, pipeTo(origin))
		h := &host{base: t.TempDir(), profiles: map[string]profile{"saved": {Type: "socks5", Host: "127.0.0.1", Port: addr.Port}}}
		// 200 ms for the probe, then 600 ms for the request through the relay. The request alone fits 700 ms; the sum does not.
		setCheckBudget(t, 700*time.Millisecond)
		started := time.Now()
		_, err := h.dispatch(request{Op: "check", ProfileID: "saved", URL: "http://remote.invalid/"})
		if code := safeDiagnostic(err).Code; code != "timeout" {
			t.Fatalf("got %v, want a timeout", err)
		}
		if elapsed := time.Since(started); elapsed < 600*time.Millisecond || elapsed > 1600*time.Millisecond {
			t.Fatalf("the check ended after %v, budget 700 ms", elapsed)
		}
		if h.active != nil || h.activeID != "" {
			t.Fatal("a check left a tunnel behind")
		}
		setCheckBudget(t, 5*time.Second)
		if result, err := h.dispatch(request{Op: "check", ProfileID: "saved", URL: "http://remote.invalid/"}); err != nil || !result.(probeResult).Reachable {
			t.Fatalf("the slow peer is meant to work: %v", err)
		}
	})
}

func TestTheBudgetEndsEveryStageAsATimeout(t *testing.T) {
	shortTimeouts(t, 5*time.Second, 5*time.Second)
	setCheckBudget(t, 400*time.Millisecond)
	silentAfterSuccess := []byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}
	method := listenLoopback(t, func(c net.Conn) { io.Copy(io.Discard, c) })
	connect := listenLoopback(t, func(c net.Conn) {
		io.ReadFull(c, make([]byte, 3))
		c.Write([]byte{5, 0})
		io.Copy(io.Discard, c)
	})
	answer, _ := fakeSocksUpstream(t, silentAfterSuccess, func(c net.Conn) { io.Copy(io.Discard, c) })
	httpConnectStall, _ := httpProxy(t, func(c net.Conn, _ connectSeen) { io.Copy(io.Discard, c) })
	httpAnswerStall, _ := httpProxy(t, func(c net.Conn, _ connectSeen) {
		io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n")
		io.Copy(io.Discard, c)
	})
	handshakeStall := listenLoopback(t, func(c net.Conn) { io.Copy(io.Discard, c) })
	for _, tc := range []struct {
		name string
		run  func() error
	}{
		{"socks5: the method negotiation stalls", func() error {
			_, err := diagnoseProxy("http://remote.invalid/", probeEndpoint{Host: "127.0.0.1", Port: method.Port})
			return err
		}},
		{"socks5: the CONNECT reply stalls", func() error {
			_, err := diagnoseProxy("http://remote.invalid/", probeEndpoint{Host: "127.0.0.1", Port: connect.Port})
			return err
		}},
		{"socks5: the destination never answers", func() error {
			_, err := diagnoseProxy("http://remote.invalid/", probeEndpoint{Host: "127.0.0.1", Port: answer.Port})
			return err
		}},
		{"http: the CONNECT answer stalls", func() error {
			_, err := diagnoseUpstream("http://remote.invalid/", httpClientProfile(httpConnectStall, "", ""))
			return err
		}},
		{"http: the destination never answers", func() error {
			_, err := diagnoseUpstream("http://remote.invalid/", httpClientProfile(httpAnswerStall, "", ""))
			return err
		}},
		{"https: the TLS handshake with the proxy stalls", func() error {
			_, err := diagnoseUpstream("http://remote.invalid/", httpsClientProfile("127.0.0.1", handshakeStall, "", ""))
			return err
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			started := time.Now()
			err := tc.run()
			wantDiagnostic(t, err, "timeout", "tunnel", true)
			if elapsed := time.Since(started); elapsed < 300*time.Millisecond || elapsed > 1500*time.Millisecond {
				t.Fatalf("ended after %v, budget 400 ms", elapsed)
			}
		})
	}
}

func TestRelayToleratesTheLoginReplyVersionOfSloppyServers(t *testing.T) {
	addr := listenLoopback(t, func(c net.Conn) {
		io.ReadFull(c, make([]byte, 4)) // 05 02 00 02
		c.Write([]byte{5, 2})
		io.ReadFull(c, make([]byte, 2+len("alice")+1+len("secret")))
		c.Write([]byte{5, 0}) // a login reply with version 5 instead of 1
		head := make([]byte, 4)
		io.ReadFull(c, head)
		if _, err := readSocksAddress(c, head[3]); err != nil {
			return
		}
		c.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0})
		io.Copy(c, c)
	})
	c, reply, _ := relayConnect(t, profile{Type: "socks5", Host: "127.0.0.1", Port: addr.Port, Username: "alice", Password: "secret"})
	if reply[1] != 0 {
		t.Fatalf("reply %x", reply)
	}
	c.Write([]byte("ok"))
	back := make([]byte, 2)
	if _, err := io.ReadFull(c, back); err != nil || string(back) != "ok" {
		t.Fatalf("tunnel data %q, %v", back, err)
	}
}

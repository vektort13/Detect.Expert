package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// tunable is a duration that production code only reads. Tests shorten it, and a goroutine left behind by an earlier test may still
// be reading it, hence the atomic.
type tunable struct{ nanoseconds atomic.Int64 }

func newTunable(d time.Duration) *tunable {
	t := &tunable{}
	t.nanoseconds.Store(int64(d))
	return t
}
func (t *tunable) get() time.Duration  { return time.Duration(t.nanoseconds.Load()) }
func (t *tunable) set(d time.Duration) { t.nanoseconds.Store(int64(d)) }

// Deadlines of the loopback relay and of the upstream dialers.
var (
	clientRequestTimeout    = newTunable(15 * time.Second) // the browser delivers its SOCKS5 greeting and request
	upstreamDialTimeout     = newTunable(8 * time.Second)  // TCP connect to the configured server, plus the TLS handshake of an https server
	upstreamExchangeTimeout = newTunable(10 * time.Second) // SOCKS5 negotiation, SOCKS5 CONNECT reply or HTTP CONNECT response
	connectionSetupTimeout  = newTunable(25 * time.Second) // one cap over all of the above for a relay connection: accept to the CONNECT reply
	checkBudget             = newTunable(12 * time.Second) // one cap for a connection check: the route to the proxy, the probe request, its answer
)

const (
	finalReplyTimeout = 5 * time.Second        // writing the last reply of a refused request
	refuseDrain       = 250 * time.Millisecond // how long a refused client may keep sending before the connection closes
)

type dialFunc func(ctx context.Context, address string, deadline time.Time) (net.Conn, error)

// dialer opens the TCP connection to a configured upstream server; dialUpstream is the only place that uses it. Tests replace it.
var dialer atomic.Pointer[dialFunc]

func init() {
	dial := dialFunc(func(ctx context.Context, address string, deadline time.Time) (net.Conn, error) {
		d := net.Dialer{Deadline: deadline}
		return d.DialContext(ctx, "tcp", address)
	})
	dialer.Store(&dial)
}

func dialUpstream(ctx context.Context, address string, deadline time.Time) (net.Conn, error) {
	return (*dialer.Load())(ctx, address, deadline)
}

type socksRelay struct {
	listener    net.Listener
	profile     profile
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.Mutex
	connections map[net.Conn]bool
	closed      bool
	sem         chan struct{}
}

func startRelay(p profile) (*socksRelay, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, fail("proxy-error", "listen", true)
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := &socksRelay{listener: listener, profile: p, ctx: ctx, cancel: cancel, connections: map[net.Conn]bool{}, sem: make(chan struct{}, 128)}
	go r.accept()
	return r, nil
}
func (r *socksRelay) port() int { return r.listener.Addr().(*net.TCPAddr).Port }
func (r *socksRelay) track(c net.Conn) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		c.Close()
		return false
	}
	r.connections[c] = true
	return true
}
func (r *socksRelay) forget(c net.Conn) {
	r.mu.Lock()
	delete(r.connections, c)
	r.mu.Unlock()
	c.Close()
}
func (r *socksRelay) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	r.cancel() // aborts upstream dials and negotiations that are still running
	r.listener.Close()
	for c := range r.connections {
		c.Close()
	}
	r.profile.Password = ""
	r.profile.Username = ""
}
func (r *socksRelay) accept() {
	for {
		c, err := r.listener.Accept()
		if err != nil {
			return
		}
		select {
		case r.sem <- struct{}{}:
			if !r.track(c) {
				<-r.sem
				return
			}
			go func() { defer func() { <-r.sem }(); defer r.forget(c); r.handle(c) }()
		default:
			c.Close()
		}
	}
}

// handle serves one browser connection: RFC 1928 greeting and CONNECT request, no authentication (the listener is loopback-only).
func (r *socksRelay) handle(client net.Conn) {
	// The setup, from accept to the reply to CONNECT, has one cap however its phases add up. The cap ends with the setup: a
	// tunnel that stands is never limited by it.
	setup, endSetup := context.WithTimeout(r.ctx, connectionSetupTimeout.get())
	defer endSetup()
	requestBy := time.Now().Add(clientRequestTimeout.get())
	if capped, _ := setup.Deadline(); capped.Before(requestBy) {
		requestBy = capped
	}
	client.SetDeadline(requestBy)
	// Greeting: VER NMETHODS METHODS (section 3). A peer that is not speaking SOCKS5 gets no answer.
	var header [2]byte
	if _, err := io.ReadFull(client, header[:]); err != nil || header[0] != 5 {
		return
	}
	methods := make([]byte, int(header[1]))
	if _, err := io.ReadFull(client, methods); err != nil {
		return
	}
	if bytes.IndexByte(methods, 0) < 0 {
		finish(client, []byte{5, 255}) // NO ACCEPTABLE METHODS, also for NMETHODS 0
		return
	}
	if _, err := client.Write([]byte{5, 0}); err != nil {
		return
	}
	// Request: VER CMD RSV ATYP DST.ADDR DST.PORT (section 4). Refusals use the replies of section 6.
	var request [4]byte
	if _, err := io.ReadFull(client, request[:]); err != nil || request[0] != 5 {
		return
	}
	switch {
	case request[1] != 1: // BIND, UDP ASSOCIATE or an unknown command
		finish(client, socksReply(7))
		return
	case request[2] != 0:
		finish(client, socksReply(1))
		return
	}
	address, err := readSocksAddress(client, request[3])
	if err != nil {
		var malformed *diagnostic
		if errors.As(err, &malformed) { // unknown ATYP or empty domain; a truncated frame gets no answer
			finish(client, socksReply(8))
		}
		return
	}
	r.mu.Lock()
	current := r.profile
	r.mu.Unlock()
	// The browser waits for the reply. The upstream phase is bounded by its own deadlines and by the setup cap, which ends it as a
	// timeout; the reply gets a fresh write deadline, so the clock that limited the browser's request does not apply to it.
	upstream, reply, err := r.openUpstream(setup, current, request, address)
	switch {
	case err != nil:
		finish(client, socksReply(socksReplyCode(budgetError(setup, err))))
		return
	case upstream == nil: // the upstream SOCKS5 server refused; its reply goes to the browser unchanged
		finish(client, reply)
		return
	}
	if !r.track(upstream) {
		return
	}
	defer r.forget(upstream)
	client.SetWriteDeadline(time.Now().Add(finalReplyTimeout))
	if _, err = client.Write(reply); err != nil {
		return
	}
	endSetup()
	client.SetDeadline(time.Time{})
	upstream.SetDeadline(time.Time{})
	done := make(chan struct{}, 2)
	go func() {
		io.Copy(upstream, client)
		closeWrite(upstream)
		done <- struct{}{}
	}()
	go func() {
		io.Copy(client, upstream)
		closeWrite(client)
		done <- struct{}{}
	}()
	<-done
	<-done
}

// openUpstream connects to the destination through the configured upstream proxy. With a connection it also returns the complete
// SOCKS5 reply for the browser. A nil connection with a reply is a refusal by an upstream SOCKS5 server; an error is a failure
// of the relay itself, which socksReplyCode turns into the code a SOCKS5 server would send.
func (r *socksRelay) openUpstream(ctx context.Context, p profile, request [4]byte, address []byte) (net.Conn, []byte, error) {
	switch p.Type {
	case "socks5":
		return connectSocksUpstream(ctx, p, request, address)
	case "http", "https":
		authority, err := connectAuthority(request[3], address)
		if err != nil {
			return nil, nil, err
		}
		c, err := httpConnect(ctx, p, authority)
		if err != nil {
			return nil, nil, err
		}
		return c, socksReply(0), nil
	}
	return nil, nil, fail("unsupported-profile", "parse", false)
}

// connectSocksUpstream forwards the browser's CONNECT request to an upstream SOCKS5 server and returns that server's reply unchanged.
func connectSocksUpstream(ctx context.Context, p profile, request [4]byte, address []byte) (net.Conn, []byte, error) {
	c, err := dialSocksContext(ctx, p)
	if err != nil {
		return nil, nil, err
	}
	stop := context.AfterFunc(ctx, func() { c.Close() })
	defer stop()
	keep := false
	defer func() {
		if !keep {
			c.Close()
		}
	}()
	c.SetDeadline(time.Now().Add(upstreamExchangeTimeout.get()))
	// The ATYP=domain bytes pass through unchanged. The destination is never
	// resolved by net.LookupIP or by a local DNS fallback.
	if _, err = c.Write(append(request[:], address...)); err != nil {
		return nil, nil, classifyNetwork(err, "socks")
	}
	var reply [4]byte
	if _, err = io.ReadFull(c, reply[:]); err != nil {
		return nil, nil, classifyNetwork(err, "socks")
	}
	if reply[0] != 5 {
		return nil, nil, fail("proxy-error", "socks", false)
	}
	bound, err := readSocksAddress(c, reply[3])
	if err != nil {
		if reply[1] != 0 {
			return nil, socksReply(reply[1]), nil // a refusal keeps its code even when the rest of the frame is malformed
		}
		var malformed *diagnostic
		if errors.As(err, &malformed) {
			return nil, nil, malformed
		}
		return nil, nil, classifyNetwork(err, "socks")
	}
	if reply[1] != 0 {
		return nil, append(reply[:], bound...), nil
	}
	keep = true
	return c, append(reply[:], bound...), nil
}

// socksReply builds a SOCKS5 reply with BND.ADDR 0.0.0.0 and BND.PORT 0.
func socksReply(code byte) []byte { return []byte{5, code, 0, 1, 0, 0, 0, 0, 0, 0} }

// socksReplyCode returns the REP value a SOCKS5 server sends for a failure the relay detected itself.
func socksReplyCode(err error) byte {
	switch safeDiagnostic(err).Code {
	case "auth-failed", "auth-required", "proxy-denied": // our credentials were refused, or a ruleset denies the connection
		return 2
	case "network-unreachable":
		return 3
	case "host-unreachable":
		return 4
	case "connection-refused":
		return 5
	case "timeout":
		return 6
	}
	return 1
}

// finish sends the last bytes of a refused request and then lets the browser read them: half-close, then drain what the browser
// still sends for a moment. Closing a socket with unread input would reset the connection and could discard the reply.
func finish(c net.Conn, last []byte) {
	c.SetWriteDeadline(time.Now().Add(finalReplyTimeout))
	if _, err := c.Write(last); err != nil {
		return
	}
	closeWrite(c)
	c.SetReadDeadline(time.Now().Add(refuseDrain))
	io.Copy(io.Discard, io.LimitReader(c, 1024))
}

type closeWriter interface{ CloseWrite() error }

// closeWrite half-closes a TCP connection, or ends the TLS stream of an https upstream, without closing the read side.
func closeWrite(c net.Conn) {
	if w, ok := c.(closeWriter); ok {
		w.CloseWrite()
	}
}

func readSocksAddress(reader io.Reader, kind byte) ([]byte, error) {
	n := 0
	result := []byte{}
	switch kind {
	case 1:
		n = 4
	case 4:
		n = 16
	case 3:
		var b [1]byte
		if _, err := io.ReadFull(reader, b[:]); err != nil {
			return nil, err
		}
		if b[0] == 0 {
			return nil, fail("proxy-error", "socks", false)
		}
		n = int(b[0])
		result = append(result, b[0])
	default:
		return nil, fail("proxy-error", "socks", false)
	}
	tail := make([]byte, n+2)
	if _, err := io.ReadFull(reader, tail); err != nil {
		return nil, err
	}
	return append(result, tail...), nil
}

func dialSocks(p profile) (net.Conn, error) { return dialSocksContext(context.Background(), p) }

// dialSocksContext connects to an upstream SOCKS5 server and completes the method negotiation. The context bounds it: when it
// ends the connection is closed, and a deadline that ran out is reported as a timeout.
func dialSocksContext(ctx context.Context, p profile) (net.Conn, error) {
	c, err := negotiateSocks(ctx, p)
	return c, budgetError(ctx, err)
}

// negotiateSocks is the method negotiation (RFC 1928 section 3). It offers "no authentication" and, when the profile has
// credentials, also "username/password"; the server's choice wins.
func negotiateSocks(ctx context.Context, p profile) (net.Conn, error) {
	credentials := p.Username != ""
	if credentials && (len(p.Username) > 255 || len(p.Password) == 0 || len(p.Password) > 255) {
		return nil, fail("invalid-config", "auth", false)
	}
	c, err := dialUpstream(ctx, endpoint(p.Host, p.Port), time.Now().Add(upstreamDialTimeout.get()))
	if err != nil {
		return nil, classifyNetwork(err, "endpoint")
	}
	stop := context.AfterFunc(ctx, func() { c.Close() })
	defer stop()
	failed := true
	defer func() {
		if failed {
			c.Close()
		}
	}()
	c.SetDeadline(time.Now().Add(upstreamExchangeTimeout.get()))
	offer := []byte{5, 1, 0}
	if credentials {
		offer = []byte{5, 2, 0, 2}
	}
	if _, err = c.Write(offer); err != nil {
		return nil, classifyNetwork(err, "socks")
	}
	var choice [2]byte
	if _, err = io.ReadFull(c, choice[:]); err != nil {
		return nil, classifyNetwork(err, "socks")
	}
	if choice[0] != 5 {
		return nil, fail("proxy-error", "socks", false)
	}
	switch {
	case choice[1] == 0: // no authentication, even when credentials exist
	case choice[1] == 2 && credentials:
		if err = socksPasswordAuth(c, p); err != nil {
			return nil, err
		}
	case choice[1] == 2: // a server that insists on username/password although only "none" was offered: the profile has no login
		return nil, fail("auth-required", "auth", false)
	case choice[1] == 255 && credentials:
		return nil, fail("auth-failed", "auth", false)
	case choice[1] == 255:
		return nil, fail("auth-required", "auth", false)
	default: // GSSAPI, or a method that was not offered
		return nil, fail("proxy-error", "socks", false)
	}
	failed = false
	return c, nil
}

// socksPasswordAuth is the RFC 1929 sub-negotiation: version 1, one-byte lengths. Only the status byte of the reply counts, as in
// curl: servers exist that answer with another version byte, and 0 means success whichever it is.
func socksPasswordAuth(c net.Conn, p profile) error {
	message := make([]byte, 0, 3+len(p.Username)+len(p.Password))
	message = append(message, 1, byte(len(p.Username)))
	message = append(message, p.Username...)
	message = append(message, byte(len(p.Password)))
	message = append(message, p.Password...)
	_, err := c.Write(message)
	for i := range message {
		message[i] = 0
	}
	if err != nil {
		return classifyNetwork(err, "auth")
	}
	var status [2]byte
	if _, err = io.ReadFull(c, status[:]); err != nil {
		return classifyNetwork(err, "auth")
	}
	if status[1] != 0 {
		return fail("auth-failed", "auth", false)
	}
	return nil
}

func probeSocks(p profile) error { return probeSocksContext(context.Background(), p) }

func probeSocksContext(ctx context.Context, p profile) error {
	c, err := dialSocksContext(ctx, p)
	if err != nil {
		return err
	}
	return c.Close()
}

// budgetError reports a failure as a timeout when the deadline of ctx has run out: the closed connection or the cancelled dial
// that the caller sees is then the budget at work, not a fault of its own. Any other error, and a cancelled ctx, pass through.
func budgetError(ctx context.Context, err error) error {
	if err == nil || !errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return err
	}
	return fail("timeout", safeDiagnostic(err).Phase, true)
}

// socksConnectCode maps the REP field of a SOCKS5 CONNECT reply (RFC 1928 section 6) to a fixed diagnostic code. REP 0 is success.
func socksConnectCode(rep byte) (code string, retryable bool) {
	switch rep {
	case 0:
		return "", false
	case 2: // connection not allowed by ruleset
		return "proxy-denied", false
	case 3:
		return "network-unreachable", true
	case 4:
		return "host-unreachable", true
	case 5:
		return "connection-refused", true
	case 6: // TTL expired
		return "timeout", true
	case 7, 8: // command or address type not supported
		return "unsupported", false
	}
	return "proxy-error", true // 1 general failure, and values outside RFC 1928
}

// A destination-domain probe is opt-in and supplies a domain, never a locally
// resolved IP. It is used by the owned integration fixture and diagnostics.
func socksConnect(p profile, host string, port int) (net.Conn, error) {
	return socksConnectContext(context.Background(), p, host, port)
}

// socksConnectContext is socksConnect bounded by the caller's context: when it ends the connection is closed, and a deadline that
// ran out is reported as a timeout.
func socksConnectContext(ctx context.Context, p profile, host string, port int) (net.Conn, error) {
	if !validHost(host) || port < 1 || port > 65535 {
		return nil, fail("invalid-config", "endpoint", false)
	}
	c, err := dialSocksContext(ctx, p)
	if err != nil {
		return nil, err
	}
	stop := context.AfterFunc(ctx, func() { c.Close() })
	defer stop()
	keep := false
	defer func() {
		if !keep {
			c.Close()
		}
	}()
	var request []byte
	if ip := net.ParseIP(stringsTrimBrackets(host)); ip != nil {
		if v4 := ip.To4(); v4 != nil {
			request = append([]byte{5, 1, 0, 1}, v4...)
		} else {
			request = append([]byte{5, 1, 0, 4}, ip.To16()...)
		}
	} else {
		request = append([]byte{5, 1, 0, 3, byte(len(host))}, []byte(host)...)
	}
	request = binary.BigEndian.AppendUint16(request, uint16(port))
	c.SetDeadline(time.Now().Add(upstreamExchangeTimeout.get()))
	if _, err = c.Write(request); err != nil {
		return nil, budgetError(ctx, classifyNetwork(err, "socks"))
	}
	var reply [4]byte
	if _, err = io.ReadFull(c, reply[:]); err != nil {
		return nil, budgetError(ctx, classifyNetwork(err, "socks"))
	}
	if reply[0] != 5 {
		return nil, fail("proxy-error", "socks", false)
	}
	if reply[1] != 0 { // the refusal keeps its meaning even when the rest of the frame is malformed
		code, retryable := socksConnectCode(reply[1])
		return nil, fail(code, "socks", retryable)
	}
	if _, err = readSocksAddress(c, reply[3]); err != nil {
		return nil, budgetError(ctx, fail("proxy-error", "socks", true))
	}
	c.SetDeadline(time.Time{})
	keep = true
	return c, nil
}
func stringsTrimBrackets(s string) string {
	if len(s) > 2 && s[0] == '[' && s[len(s)-1] == ']' {
		return s[1 : len(s)-1]
	}
	return s
}

// HTTP and HTTPS upstream proxies (profile types "http" and "https"): the relay speaks SOCKS5 to the browser and an HTTP/1.1
// CONNECT to the configured server. Nothing here resolves a destination, follows a redirect, logs, or returns a header value.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"net"
	"net/netip"
	"strconv"
	"sync/atomic"
	"time"
)

// The status line and header block of a CONNECT response may not exceed this many bytes.
const maxConnectResponse = 8 * 1024

// upstreamRoots is the trust store for https upstream proxies. nil selects the system pool; only tests set it.
var upstreamRoots atomic.Pointer[x509.CertPool]

// bufferedConn delivers the bytes the proxy sent after its header block (a server-speaks-first protocol may start there) before
// it reads from the connection again.
type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (b *bufferedConn) Read(p []byte) (int, error) { return b.reader.Read(p) }
func (b *bufferedConn) CloseWrite() error {
	if w, ok := b.Conn.(closeWriter); ok {
		return w.CloseWrite()
	}
	return nil
}

// dialHTTPUpstream connects to the configured HTTP(S) proxy: TCP for "http", TCP and a verified TLS handshake for "https". Both
// share the dial budget. No request is sent.
func dialHTTPUpstream(ctx context.Context, p profile) (net.Conn, error) {
	deadline := time.Now().Add(upstreamDialTimeout.get())
	c, err := dialUpstream(ctx, endpoint(p.Host, p.Port), deadline)
	if err != nil {
		return nil, classifyNetwork(err, "endpoint")
	}
	if p.Type != "https" {
		return c, nil
	}
	c.SetDeadline(deadline)
	// ServerName is the host as configured: Go sends it as SNI for a name, sends no SNI for an IP literal, and verifies the
	// certificate against it in both cases. Verification is never disabled. ALPN names the one protocol that is spoken.
	secure := tls.Client(c, &tls.Config{ServerName: stringsTrimBrackets(p.Host), MinVersion: tls.VersionTLS12, RootCAs: upstreamRoots.Load(), NextProtos: []string{"http/1.1"}})
	if err = secure.HandshakeContext(ctx); err != nil {
		c.Close()
		return nil, classifyTLS(err)
	}
	return secure, nil
}

func classifyTLS(err error) error {
	var network net.Error
	if errors.As(err, &network) && network.Timeout() {
		return fail("timeout", "tls", true)
	}
	if errors.Is(err, context.Canceled) {
		return fail("connection-failed", "tls", true)
	}
	return fail("tls-failed", "tls", false)
}

// probeUpstream checks that the configured server answers, without sending any destination: the SOCKS5 negotiation, or for an
// HTTP(S) proxy the TCP connection and, for https, the certificate check.
func probeUpstream(p profile) error { return probeUpstreamContext(context.Background(), p) }

// probeUpstreamContext is probeUpstream bounded by the caller's context; a deadline that ran out is reported as a timeout.
func probeUpstreamContext(ctx context.Context, p profile) error {
	if p.Type == "socks5" {
		return probeSocksContext(ctx, p)
	}
	c, err := dialHTTPUpstream(ctx, p)
	if err != nil {
		return budgetError(ctx, err)
	}
	return c.Close()
}

// httpConnect opens a tunnel to authority ("host:port", IPv6 literals in brackets) through the HTTP(S) proxy of p. On success the
// returned connection carries the tunnel, starting with any bytes the proxy already sent behind its header block. The context
// bounds the whole exchange: when it ends the connection is closed, and a deadline that ran out is reported as a timeout.
func httpConnect(ctx context.Context, p profile, authority string) (net.Conn, error) {
	c, err := tunnelHTTP(ctx, p, authority)
	return c, budgetError(ctx, err)
}

func tunnelHTTP(ctx context.Context, p profile, authority string) (net.Conn, error) {
	c, err := dialHTTPUpstream(ctx, p)
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
	c.SetDeadline(time.Now().Add(upstreamExchangeTimeout.get()))
	request := connectRequest(authority, p)
	_, err = c.Write(request)
	for i := range request {
		request[i] = 0
	}
	if err != nil {
		return nil, classifyNetwork(err, "proxy")
	}
	reader := bufio.NewReaderSize(c, maxConnectResponse)
	status, err := readConnectResponse(reader)
	if err != nil {
		return nil, err
	}
	if err = connectStatusDiagnostic(status, p.Username != ""); err != nil {
		return nil, err
	}
	c.SetDeadline(time.Time{})
	keep = true
	if reader.Buffered() > 0 {
		return &bufferedConn{Conn: c, reader: reader}, nil
	}
	return c, nil
}

// connectRequest is the whole request: the request line, Host, and Proxy-Authorization (Basic) only when credentials exist.
func connectRequest(authority string, p profile) []byte {
	request := make([]byte, 0, 2048) // large enough for the longest authority and credentials, so no copy of them is left behind
	request = append(request, "CONNECT "...)
	request = append(request, authority...)
	request = append(request, " HTTP/1.1\r\nHost: "...)
	request = append(request, authority...)
	request = append(request, "\r\n"...)
	if p.Username != "" {
		secret := make([]byte, 0, len(p.Username)+1+len(p.Password))
		secret = append(secret, p.Username...)
		secret = append(secret, ':')
		secret = append(secret, p.Password...)
		request = append(request, "Proxy-Authorization: Basic "...)
		start := len(request)
		request = append(request, make([]byte, base64.StdEncoding.EncodedLen(len(secret)))...)
		base64.StdEncoding.Encode(request[start:], secret)
		for i := range secret {
			secret[i] = 0
		}
		request = append(request, "\r\n"...)
	}
	return append(request, "\r\n"...)
}

// readConnectResponse reads the status line and header block of the proxy's answer and returns the status code. Header names and
// values are discarded unread and there is no body handling. Interim 1xx responses (except 101) are skipped. Bytes behind the
// blank line stay in the reader: they belong to the tunnel.
func readConnectResponse(reader *bufio.Reader) (int, error) {
	remaining := maxConnectResponse
	for interim := 0; interim < 4; interim++ {
		line, err := readHeaderLine(reader, &remaining)
		if err != nil {
			return 0, err
		}
		status, ok := parseStatusLine(line)
		if !ok {
			return 0, fail("proxy-error", "proxy", false)
		}
		for {
			line, err = readHeaderLine(reader, &remaining)
			if err != nil {
				return 0, err
			}
			if len(line) == 0 {
				break
			}
		}
		if status >= 100 && status < 200 && status != 101 {
			continue
		}
		return status, nil
	}
	return 0, fail("proxy-error", "proxy", false)
}

func readHeaderLine(reader *bufio.Reader, remaining *int) ([]byte, error) {
	line, err := reader.ReadSlice('\n')
	if errors.Is(err, bufio.ErrBufferFull) {
		return nil, fail("proxy-error", "proxy", false)
	}
	if err != nil {
		return nil, classifyNetwork(err, "proxy")
	}
	*remaining -= len(line)
	if *remaining < 0 {
		return nil, fail("proxy-error", "proxy", false)
	}
	line = bytes.TrimSuffix(line, []byte("\n"))
	return bytes.TrimSuffix(line, []byte("\r")), nil
}

// parseStatusLine accepts "HTTP/1.0 200", "HTTP/1.1 200 reason": version, one space, a three-digit code, optionally a space and text.
func parseStatusLine(line []byte) (int, bool) {
	if len(line) < 12 || !bytes.HasPrefix(line, []byte("HTTP/1.")) || line[7] != '0' && line[7] != '1' || line[8] != ' ' {
		return 0, false
	}
	if len(line) > 12 && line[12] != ' ' {
		return 0, false
	}
	status := 0
	for _, digit := range line[9:12] {
		if digit < '0' || digit > '9' {
			return 0, false
		}
		status = status*10 + int(digit-'0')
	}
	return status, true
}

// connectStatusDiagnostic maps the status of a CONNECT response to a fixed diagnostic; 2xx is success. A 407 is "auth-failed" when
// credentials were sent and "auth-required" when the profile has none. Only Basic is ever offered.
func connectStatusDiagnostic(status int, credentials bool) error {
	switch {
	case status >= 200 && status < 300:
		return nil
	case status == 407 && credentials:
		return fail("auth-failed", "auth", false)
	case status == 407:
		return fail("auth-required", "auth", false)
	case status == 403:
		return fail("proxy-denied", "proxy", false)
	case status == 502:
		return fail("host-unreachable", "proxy", true)
	case status == 504:
		return fail("timeout", "proxy", true)
	case status >= 500:
		return fail("proxy-error", "proxy", true)
	}
	return fail("proxy-error", "proxy", false)
}

// connectAuthority turns the destination of a SOCKS5 request (ATYP and the bytes of DST.ADDR and DST.PORT) into the authority of
// a CONNECT request. A domain keeps its name; it is validated because it ends up in the request line and cannot be allowed to add
// anything to it. Failures are the codes a SOCKS5 server would answer with.
func connectAuthority(atyp byte, address []byte) (string, error) {
	if len(address) < 3 {
		return "", fail("proxy-error", "socks", false)
	}
	host, port := address[:len(address)-2], int(binary.BigEndian.Uint16(address[len(address)-2:]))
	if port == 0 { // connecting to port 0 is refused by every operating system
		return "", fail("connection-refused", "proxy", true)
	}
	var name string
	switch {
	case atyp == 1 && len(host) == 4:
		name = netip.AddrFrom4([4]byte(host)).String()
	case atyp == 4 && len(host) == 16:
		name = "[" + netip.AddrFrom16([16]byte(host)).String() + "]"
	case atyp == 3 && len(host) >= 2 && int(host[0]) == len(host)-1:
		if !validConnectName(host[1:]) {
			return "", fail("host-unreachable", "proxy", false)
		}
		name = string(host[1:])
	default:
		return "", fail("proxy-error", "socks", false)
	}
	return name + ":" + strconv.Itoa(port), nil
}

// hostAuthority is connectAuthority for a destination that arrives as text (the diagnostics probe).
func hostAuthority(host string, port int) (string, error) {
	if port < 1 || port > 65535 {
		return "", fail("invalid-input", "endpoint", false)
	}
	host = stringsTrimBrackets(host)
	if addr, err := netip.ParseAddr(host); err == nil {
		if addr.Is6() {
			return "[" + addr.String() + "]:" + strconv.Itoa(port), nil
		}
		return addr.String() + ":" + strconv.Itoa(port), nil
	}
	if !validConnectName([]byte(host)) {
		return "", fail("invalid-input", "endpoint", false)
	}
	return host + ":" + strconv.Itoa(port), nil
}

// validConnectName admits the characters of an RFC 3986 reg-name: nothing that is whitespace, a delimiter of the authority, or
// outside ASCII, so a name can never end the request line or start a header.
func validConnectName(name []byte) bool {
	if len(name) == 0 || len(name) > 253 {
		return false
	}
	for _, b := range name {
		switch {
		case b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z', b >= '0' && b <= '9':
		case bytes.IndexByte([]byte("-._~!$&'()*+,;="), b) >= 0:
		default:
			return false
		}
	}
	return true
}

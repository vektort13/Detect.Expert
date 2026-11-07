// ADR-070: explicit opt-in probe, solely through the selected route (the loopback SOCKS relay, or the saved profile's own upstream).
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// probeEndpoint names the server a diagnose request probes through. Type is optional: absent or "socks5" is a plain,
// unauthenticated SOCKS5 server (the original meaning); "http" and "https" are HTTP(S) proxies reached directly, without a
// profile and without credentials.
type probeEndpoint struct {
	Type string `json:"type,omitempty"`
	Host string `json:"host"`
	Port int    `json:"port"`
}

// valid applies the rules of the profile decoder: a known type, a host that validHost accepts, a port of 1 to 65535.
func (e probeEndpoint) valid() bool {
	switch e.Type {
	case "", "socks5", "http", "https":
		return validHost(e.Host) && e.Port >= 1 && e.Port <= 65535
	}
	return false
}

// upstream is the transient profile of an http or https endpoint: in memory only, never saved, and with no credentials.
func (e probeEndpoint) upstream() (profile, bool) {
	if e.Type != "http" && e.Type != "https" {
		return profile{}, false
	}
	return profile{Type: e.Type, Host: e.Host, Port: e.Port}, true
}

// exactEndpointFields reports whether the raw endpoint object has only the keys host, port and type, spelled exactly, with host and
// type as JSON strings and a type that is not empty. The standard decoder would also take "Type" or "HOST" and read "type":null as
// absent; the schema of an older companion, which rejects every key it does not know, must not be widened by such aliases.
func exactEndpointFields(raw json.RawMessage) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return false
	}
	for key, value := range fields {
		switch key {
		case "port":
		case "host", "type":
			var text string
			if len(value) == 0 || value[0] != '"' || json.Unmarshal(value, &text) != nil || key == "type" && text == "" {
				return false // a type that is present must name one; only its absence means socks5
			}
		default:
			return false
		}
	}
	return true
}

type probeResult struct {
	Reachable   bool    `json:"reachable"`
	RemoteDNS   bool    `json:"remoteDns"`
	TLSVerified bool    `json:"tlsVerified"`
	HTTPStatus  int     `json:"httpStatus"`
	IP          *string `json:"ip"`
	ElapsedMS   int64   `json:"elapsedMs"`
}

func probeURL(text string) (*url.URL, error) {
	if len(text) == 0 || len(text) > 2048 || strings.TrimSpace(text) != text || strings.ContainsAny(text, "\x00\r\n\\") {
		return nil, fail("invalid-input", "parse", false)
	}
	u, err := url.Parse(text)
	if err != nil || u.Scheme != "http" && u.Scheme != "https" || u.User != nil || u.Fragment != "" || !validHost(u.Hostname()) {
		return nil, fail("invalid-input", "parse", false)
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return nil, fail("invalid-input", "endpoint", false)
		}
	}
	return u, nil
}

// diagnoseProxy probes through a plain (unauthenticated) SOCKS5 endpoint: the loopback relay of the active tunnel, or an
// extension-supplied server.
func diagnoseProxy(text string, target probeEndpoint) (probeResult, error) {
	return diagnoseProxyContext(context.Background(), text, target)
}

func diagnoseProxyContext(ctx context.Context, text string, target probeEndpoint) (probeResult, error) {
	if _, err := probeURL(text); err != nil {
		return probeResult{}, err
	}
	if !validHost(target.Host) || target.Port < 1 || target.Port > 65535 {
		return probeResult{}, fail("invalid-input", "endpoint", false)
	}
	return diagnoseThrough(ctx, text, func(ctx context.Context, host string, port int) (net.Conn, error) {
		return socksConnectContext(ctx, profile{Type: "socks5", Host: target.Host, Port: target.Port}, host, port)
	})
}

// diagnoseUpstream probes straight through the HTTP(S) proxy of a saved profile, with the same dialer the relay uses. The answer
// is the proxy's own (auth-failed, proxy-denied, tls-failed ...), not a SOCKS5 reply that has collapsed several of them.
func diagnoseUpstream(text string, p profile) (probeResult, error) {
	return diagnoseUpstreamContext(context.Background(), text, p)
}

func diagnoseUpstreamContext(ctx context.Context, text string, p profile) (probeResult, error) {
	if _, err := probeURL(text); err != nil {
		return probeResult{}, err
	}
	return diagnoseThrough(ctx, text, func(ctx context.Context, host string, port int) (net.Conn, error) {
		authority, err := hostAuthority(host, port)
		if err != nil {
			return nil, err
		}
		return httpConnect(ctx, p, authority)
	})
}

// diagnoseThrough performs the probe request over connections that connect(host, port) opens; the destination domain is handed
// to connect unresolved. The caller's context and checkBudget bound the whole probe: the route, the request and its answer. When
// either ends the probe's connections are closed, and a budget that ran out is reported as a timeout.
func diagnoseThrough(ctx context.Context, text string, connect func(ctx context.Context, host string, port int) (net.Conn, error)) (probeResult, error) {
	result := probeResult{}
	u, err := probeURL(text)
	if err != nil {
		return result, err
	}
	ctx, cancel := context.WithTimeout(ctx, checkBudget.get())
	defer cancel()
	start := time.Now()
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, ForceAttemptHTTP2: false, MaxResponseHeaderBytes: 8192, ResponseHeaderTimeout: 12 * time.Second, TLSHandshakeTimeout: 10 * time.Second, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, portText, err := net.SplitHostPort(address)
		if err != nil {
			return nil, fail("invalid-input", "endpoint", false)
		}
		port, err := strconv.Atoi(portText)
		if err != nil {
			return nil, fail("invalid-input", "endpoint", false)
		}
		connection, err := connect(ctx, host, port)
		if err != nil {
			return nil, err
		}
		if err = ctx.Err(); err != nil {
			connection.Close()
			return nil, err
		}
		return connection, nil
	}}
	defer transport.CloseIdleConnections()
	// No client timeout: the context is the budget, and it covers reading the answer as well.
	client := &http.Client{Transport: transport, CheckRedirect: func(request *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return result, fail("invalid-input", "parse", false)
	}
	request.Header.Set("User-Agent", "")
	request.Header.Set("Accept", "application/json,text/plain,*/*")
	request.Close = true
	response, err := client.Do(request)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) { // the budget ran out, whatever stage was running
			return result, fail("timeout", "tunnel", true)
		}
		var certificate *tls.CertificateVerificationError
		var authority x509.UnknownAuthorityError
		var hostname x509.HostnameError
		var record tls.RecordHeaderError
		var alert tls.AlertError
		if errors.As(err, &certificate) || errors.As(err, &authority) || errors.As(err, &hostname) || errors.As(err, &record) || errors.As(err, &alert) || errors.Is(err, http.ErrSchemeMismatch) {
			return result, fail("tls-failed", "tls", false)
		}
		var classified *diagnostic
		if errors.As(err, &classified) {
			return result, classified
		}
		return result, classifyNetwork(err, "connect")
	}
	defer response.Body.Close()
	result.Reachable = true
	result.RemoteDNS = net.ParseIP(u.Hostname()) == nil
	result.TLSVerified = response.TLS != nil && len(response.TLS.VerifiedChains) > 0
	result.HTTPStatus = response.StatusCode
	// The response stays local. Only a syntactically valid IP field may leave
	// this function; HTML, headers, cookies and arbitrary JSON never do.
	body, _ := io.ReadAll(io.LimitReader(response.Body, 16385))
	if len(body) <= 16384 {
		candidate := strings.TrimSpace(string(body))
		var object map[string]json.RawMessage
		if json.Unmarshal(body, &object) == nil {
			var text string
			if raw, ok := object["ip"]; ok && json.Unmarshal(raw, &text) == nil {
				candidate = text
			}
		}
		if ip := net.ParseIP(candidate); ip != nil {
			value := ip.String()
			result.IP = &value
		}
	}
	for index := range body {
		body[index] = 0
	}
	result.ElapsedMS = time.Since(start).Milliseconds()
	return result, nil
}

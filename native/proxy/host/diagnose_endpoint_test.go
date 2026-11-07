package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func diagnoseFrame(endpoint string) []byte {
	return []byte(`{"v":1,"id":"d","op":"diagnose","url":"http://remote-dns.invalid/","endpoint":` + endpoint + `}`)
}

// diagnoseTyped sends a diagnose request through the real decoder and dispatcher.
func diagnoseTyped(t *testing.T, h *host, endpoint string) (probeResult, error) {
	t.Helper()
	r, err := decodeRequest(diagnoseFrame(endpoint))
	if err != nil {
		return probeResult{}, err
	}
	result, err := h.dispatch(r)
	if err != nil {
		return probeResult{}, err
	}
	return result.(probeResult), nil
}

func typedEndpoint(kind string, addr *net.TCPAddr) string {
	return fmt.Sprintf(`{"type":%q,"host":"127.0.0.1","port":%d}`, kind, addr.Port)
}

func TestDiagnoseEndpointAcceptsTheThreeTypesAndTheOriginalShape(t *testing.T) {
	for _, tc := range []struct {
		endpoint string
		kind     string
		host     string
	}{
		{`{"host":"127.0.0.1","port":1080}`, "", "127.0.0.1"},
		{`{"type":"socks5","host":"127.0.0.1","port":1080}`, "socks5", "127.0.0.1"},
		{`{"type":"http","host":"proxy.example","port":3128}`, "http", "proxy.example"},
		{`{"type":"https","host":"proxy.example","port":443}`, "https", "proxy.example"},
		{`{"type":"http","host":"2001:db8::1","port":3128}`, "http", "2001:db8::1"},
		{`{"type":"https","host":"[2001:db8::1]","port":443}`, "https", "[2001:db8::1]"},
		{`{"port":65535,"host":"192.0.2.1","type":"http"}`, "http", "192.0.2.1"},
	} {
		r, err := decodeRequest(diagnoseFrame(tc.endpoint))
		if err != nil || r.Endpoint == nil || r.Endpoint.Type != tc.kind || r.Endpoint.Host != tc.host {
			t.Errorf("%s: %v %+v", tc.endpoint, err, r.Endpoint)
		}
	}
	// "endpoint": null has always meant "no endpoint": the active tunnel is used.
	if r, err := decodeRequest(diagnoseFrame(`null`)); err != nil || r.Endpoint != nil {
		t.Errorf("null endpoint: %v %+v", err, r.Endpoint)
	}
}

func TestDiagnoseEndpointRefusesWhatItDoesNotKnow(t *testing.T) {
	for name, endpoint := range map[string]string{
		"unknown type socks4":              `{"type":"socks4","host":"proxy.example","port":1080}`,
		"upper-case type":                  `{"type":"HTTP","host":"proxy.example","port":3128}`,
		"mixed-case type":                  `{"type":"Https","host":"proxy.example","port":443}`,
		"unknown type ftp":                 `{"type":"ftp","host":"proxy.example","port":21}`,
		"empty type":                       `{"type":"","host":"proxy.example","port":3128}`,
		"type with a space":                `{"type":" http","host":"proxy.example","port":3128}`,
		"null type":                        `{"type":null,"host":"proxy.example","port":3128}`,
		"numeric type":                     `{"type":5,"host":"proxy.example","port":3128}`,
		"boolean type":                     `{"type":true,"host":"proxy.example","port":3128}`,
		"array type":                       `{"type":["http"],"host":"proxy.example","port":3128}`,
		"username and password":            `{"type":"http","host":"proxy.example","port":3128,"username":"alice","password":"secret"}`,
		"username only":                    `{"type":"https","host":"proxy.example","port":443,"username":"alice"}`,
		"password only":                    `{"type":"https","host":"proxy.example","port":443,"password":"secret"}`,
		"credentials on a socks5 endpoint": `{"type":"socks5","host":"proxy.example","port":1080,"username":"alice","password":"secret"}`,
		"credentials without a type":       `{"host":"proxy.example","port":1080,"username":"alice","password":"secret"}`,
		"uri":                              `{"type":"http","host":"proxy.example","port":3128,"uri":"http://proxy.example:3128"}`,
		"config":                           `{"type":"http","host":"proxy.example","port":3128,"config":"client"}`,
		"another unknown field":            `{"type":"http","host":"proxy.example","port":3128,"scheme":"http"}`,
		"capitalised Type":                 `{"Type":"http","host":"proxy.example","port":3128}`,
		"upper-case TYPE":                  `{"TYPE":"http","host":"proxy.example","port":3128}`,
		"capitalised Host":                 `{"type":"http","Host":"proxy.example","port":3128}`,
		"upper-case PORT":                  `{"type":"http","host":"proxy.example","PORT":3128}`,
		"duplicate type":                   `{"type":"http","type":"https","host":"proxy.example","port":3128}`,
		"duplicate host":                   `{"type":"http","host":"a.example","host":"b.example","port":3128}`,
		"no host":                          `{"type":"http","port":3128}`,
		"empty host":                       `{"type":"http","host":"","port":3128}`,
		"host with a space":                `{"type":"http","host":"bad host","port":3128}`,
		"host with a port":                 `{"type":"http","host":"proxy.example:3128","port":3128}`,
		"host with a path":                 `{"type":"https","host":"proxy.example/x","port":443}`,
		"host with userinfo":               `{"type":"https","host":"user@proxy.example","port":443}`,
		"host with a leading hyphen":       `{"type":"http","host":"-proxy.example","port":3128}`,
		"null host":                        `{"type":"http","host":null,"port":3128}`,
		"numeric host":                     `{"type":"http","host":5,"port":3128}`,
		"no port":                          `{"type":"http","host":"proxy.example"}`,
		"port 0":                           `{"type":"http","host":"proxy.example","port":0}`,
		"port 65536":                       `{"type":"http","host":"proxy.example","port":65536}`,
		"negative port":                    `{"type":"http","host":"proxy.example","port":-1}`,
		"string port":                      `{"type":"http","host":"proxy.example","port":"3128"}`,
		"fractional port":                  `{"type":"http","host":"proxy.example","port":1.5}`,
		"null port":                        `{"type":"http","host":"proxy.example","port":null}`,
		"empty endpoint":                   `{}`,
		"endpoint is an array":             `[]`,
		"endpoint is a string":             `"http://proxy.example:3128"`,
		"endpoint is a number":             `5`,
		"endpoint is a boolean":            `true`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := decodeRequest(diagnoseFrame(endpoint))
			if err == nil {
				t.Fatalf("accepted %s", endpoint)
			}
			if d := safeDiagnostic(err); d.Code != "invalid-input" || d.Retryable {
				t.Fatalf("got %+v", d)
			}
		})
	}
}

func TestDiagnoseEndpointValidationIsTheValidationOfTheProfileDecoder(t *testing.T) {
	hosts := []string{"proxy.example", "localhost", "192.0.2.1", "2001:db8::1", "[2001:db8::1]", "", "bad host", "a/b", "host:80", "-x.example", "x-.example", "a..b", "user@host", "x%41", strings.Repeat("a", 64) + ".example", strings.Repeat("a.", 127) + "a", strings.Repeat("a", 254)}
	for _, kind := range []string{"socks5", "http", "https"} {
		for _, host := range hosts {
			for _, port := range []int{-1, 0, 1, 80, 65535, 65536} {
				_, err := decodeProfile(profileJSON(t, map[string]any{"type": kind, "host": host, "port": port}))
				if got := (probeEndpoint{Type: kind, Host: host, Port: port}).valid(); got != (err == nil) {
					t.Errorf("%s %q:%d: the endpoint says %v, the profile decoder says %v", kind, host, port, got, err)
				}
			}
		}
	}
}

func TestDiagnoseOfATypedHTTPEndpointDialsTheUpstreamDirectlyAndTouchesNothing(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"ip":"203.0.113.21"}`) }))
	defer origin.Close()
	addr, seen := httpProxy(t, tunnelTo(origin.Listener.Addr().String()))
	h := &host{base: t.TempDir(), profiles: map[string]profile{}}
	result, err := diagnoseTyped(t, h, typedEndpoint("http", addr))
	if err != nil || !result.Reachable || !result.RemoteDNS || result.HTTPStatus != 200 || result.IP == nil || *result.IP != "203.0.113.21" {
		t.Fatalf("%v %+v", err, result)
	}
	if got := nextSeen(t, seen); got.raw != "CONNECT remote-dns.invalid:80 HTTP/1.1\r\nHost: remote-dns.invalid:80\r\n\r\n" {
		t.Fatalf("the proxy saw %q: no credentials, the destination name unresolved, nothing else", got.raw)
	}
	if len(h.profiles) != 0 || h.active != nil || h.activeID != "" || h.lastError != nil {
		t.Fatalf("a typed diagnose left state behind: %+v", h)
	}
	// It works while another route is active, and leaves that route alone.
	socksEndpoint, _ := ownedProbeProxy(t, origin.Listener.Addr().String())
	activeProfile := profile{Type: "socks5", Host: socksEndpoint.Host, Port: socksEndpoint.Port}
	active, err := startTunnel(t.TempDir(), activeProfile)
	if err != nil {
		t.Fatal(err)
	}
	defer active.Close()
	previous := &diagnostic{"dns-failed", "dns", true}
	busy := &host{base: t.TempDir(), profiles: map[string]profile{"active": activeProfile}, active: active, activeID: "active", lastError: previous}
	if result, err = diagnoseTyped(t, busy, typedEndpoint("http", addr)); err != nil || !result.Reachable {
		t.Fatalf("with an active tunnel: %v", err)
	}
	if busy.active != active || busy.activeID != "active" || busy.lastError != previous || !active.alive() || len(busy.profiles) != 1 {
		t.Fatal("a typed diagnose changed the active route")
	}
}

func TestDiagnoseOfATypedHTTPSEndpointVerifiesTheProxyCertificate(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"ip":"203.0.113.22"}`) }))
	defer origin.Close()
	pki := newTestPKI(t, "test CA")
	addr, seen := tlsProxy(t, &tls.Config{Certificates: []tls.Certificate{pki.validLeaf(t)}}, tunnelTo(origin.Listener.Addr().String()))
	h := &host{base: t.TempDir(), profiles: map[string]profile{}}

	trust(t, nil)
	_, err := diagnoseTyped(t, h, typedEndpoint("https", addr))
	wantDiagnostic(t, err, "tls-failed", "tls", false)
	noRequest(t, seen)

	trust(t, pki.pool)
	result, err := diagnoseTyped(t, h, typedEndpoint("https", addr))
	if err != nil || !result.Reachable || result.IP == nil || *result.IP != "203.0.113.22" {
		t.Fatalf("%v %+v", err, result)
	}
	if got := nextSeen(t, seen); got.raw != "CONNECT remote-dns.invalid:80 HTTP/1.1\r\nHost: remote-dns.invalid:80\r\n\r\n" {
		t.Fatalf("the proxy saw %q", got.raw)
	}
	if len(h.profiles) != 0 || h.active != nil {
		t.Fatal("a typed diagnose left state behind")
	}
}

func TestDiagnoseOfATypedEndpointKeepsTheProxysOwnAnswersApart(t *testing.T) {
	for _, tc := range []struct {
		status      int
		code, phase string
		retryable   bool
	}{
		{407, "auth-required", "auth", false}, // the endpoint carries no credentials, so a demand for them is "required"
		{403, "proxy-denied", "proxy", false},
		{502, "host-unreachable", "proxy", true},
		{504, "timeout", "proxy", true},
		{503, "proxy-error", "proxy", true},
		{301, "proxy-error", "proxy", false},
	} {
		t.Run(fmt.Sprint(tc.status), func(t *testing.T) {
			addr, seen := httpProxy(t, respond(canaryResponse(tc.status)))
			_, err := diagnoseTyped(t, &host{base: t.TempDir(), profiles: map[string]profile{}}, typedEndpoint("http", addr))
			wantDiagnostic(t, err, tc.code, tc.phase, tc.retryable)
			if got := nextSeen(t, seen); strings.Contains(got.raw, "Proxy-Authorization") {
				t.Fatalf("a credential-free endpoint sent credentials: %q", got.raw)
			}
			encoded, _ := json.Marshal(safeDiagnostic(err))
			for _, secret := range []string{canaryReason, canaryRealm, "CANARY-SERVER", "canary-redirect", "remote-dns"} {
				if strings.Contains(string(encoded), secret) {
					t.Fatalf("diagnostic leaked %q: %s", secret, encoded)
				}
			}
		})
	}
}

func TestDiagnoseOfATypedEndpointRespectsTheCheckBudget(t *testing.T) {
	shortTimeouts(t, 5*time.Second, 5*time.Second) // only the budget can end these in time
	setCheckBudget(t, 400*time.Millisecond)
	silent, _ := httpProxy(t, func(c net.Conn, _ connectSeen) { io.Copy(io.Discard, c) })
	handshake := listenLoopback(t, func(c net.Conn) { io.Copy(io.Discard, c) })
	for name, endpoint := range map[string]string{"http: the CONNECT answer stalls": typedEndpoint("http", silent), "https: the TLS handshake stalls": typedEndpoint("https", handshake)} {
		t.Run(name, func(t *testing.T) {
			started := time.Now()
			_, err := diagnoseTyped(t, &host{base: t.TempDir(), profiles: map[string]profile{}}, endpoint)
			wantDiagnostic(t, err, "timeout", "tunnel", true)
			if elapsed := time.Since(started); elapsed < 300*time.Millisecond || elapsed > 1500*time.Millisecond {
				t.Fatalf("ended after %v, budget 400 ms", elapsed)
			}
		})
	}
}

func TestDiagnoseWithoutATypeAndWithSocks5StaysPlainSocks5(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"ip":"203.0.113.23"}`) }))
	defer origin.Close()
	endpoint, seen := ownedProbeProxy(t, origin.Listener.Addr().String())
	h := &host{base: t.TempDir(), profiles: map[string]profile{}}
	for name, body := range map[string]string{
		"no type":         fmt.Sprintf(`{"host":%q,"port":%d}`, endpoint.Host, endpoint.Port),
		"explicit socks5": fmt.Sprintf(`{"type":"socks5","host":%q,"port":%d}`, endpoint.Host, endpoint.Port),
	} {
		t.Run(name, func(t *testing.T) {
			result, err := diagnoseTyped(t, h, body)
			if err != nil || !result.Reachable || !result.RemoteDNS || result.IP == nil || *result.IP != "203.0.113.23" {
				t.Fatalf("%v %+v", err, result)
			}
			select {
			case domain := <-seen:
				if domain != "remote-dns.invalid" {
					t.Fatalf("the SOCKS5 server saw %q: the destination domain must reach it unresolved", domain)
				}
			case <-time.After(time.Second):
				t.Fatal("the plain SOCKS5 path was not used")
			}
		})
	}
}

func TestDiagnoseRefusalsKeepTheNativeChannelAlive(t *testing.T) {
	var input, output bytes.Buffer
	send := func(id string, endpoint map[string]any) {
		if err := writeFrame(&input, map[string]any{"v": 1, "id": id, "op": "diagnose", "url": "http://remote-dns.invalid/", "endpoint": endpoint}); err != nil {
			t.Fatal(err)
		}
	}
	send("type", map[string]any{"type": "socks4", "host": "127.0.0.1", "port": 1080})
	send("credentials", map[string]any{"type": "http", "host": "127.0.0.1", "port": 3128, "username": "alice", "password": "secret"})
	send("field", map[string]any{"type": "https", "host": "127.0.0.1", "port": 443, "uri": "https://proxy.example"})
	if err := writeFrame(&input, request{V: 1, ID: "next", Op: "hello"}); err != nil {
		t.Fatal(err)
	}
	if err := runHost(&input, &output, &host{base: t.TempDir(), profiles: map[string]profile{}}); err != nil {
		t.Fatal("a refused diagnose killed the native channel")
	}
	for _, id := range []string{"type", "credentials", "field"} {
		frame, err := nativeFrame(&output)
		if err != nil {
			t.Fatal(err)
		}
		var answer response
		if json.Unmarshal(frame, &answer) != nil || answer.OK || answer.Error == nil || answer.Error.Code != "invalid-input" || bytes.Contains(frame, []byte("alice")) || bytes.Contains(frame, []byte("secret")) {
			t.Fatalf("%s: %s", id, frame)
		}
	}
	frame, err := nativeFrame(&output)
	var next response
	if err != nil || json.Unmarshal(frame, &next) != nil || !next.OK || next.ID != "next" {
		t.Fatalf("the channel did not serve the next operation: %s", frame)
	}
}

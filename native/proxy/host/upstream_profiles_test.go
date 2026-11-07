package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func profileJSON(t *testing.T, fields map[string]any) json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestDecodeProfileAcceptsHTTPAndHTTPSUpstreams(t *testing.T) {
	for _, tc := range []struct {
		name   string
		fields map[string]any
	}{
		{"http without credentials", map[string]any{"type": "http", "host": "proxy.example", "port": 3128}},
		{"https with credentials", map[string]any{"type": "https", "host": "proxy.example", "port": 443, "username": "alice", "password": "s3cr:et"}},
		{"colon in the password is fine", map[string]any{"type": "http", "host": "proxy.example", "port": 8080, "username": "alice", "password": ":::"}},
		{"IPv6 literal", map[string]any{"type": "http", "host": "2001:db8::1", "port": 3128}},
		{"bracketed IPv6 literal", map[string]any{"type": "https", "host": "[2001:db8::1]", "port": 443}},
		{"IPv4 literal", map[string]any{"type": "https", "host": "192.0.2.10", "port": 443}},
		{"longest credentials", map[string]any{"type": "http", "host": "proxy.example", "port": 80, "username": strings.Repeat("u", 255), "password": strings.Repeat("p", 255)}},
		{"highest port", map[string]any{"type": "http", "host": "proxy.example", "port": 65535}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, err := decodeProfile(profileJSON(t, tc.fields))
			if err != nil {
				t.Fatal(err)
			}
			if p.Type != tc.fields["type"] || p.Host != tc.fields["host"] {
				t.Fatalf("decoded %+v", p)
			}
		})
	}
}

func TestDecodeProfileRejectsMalformedHTTPAndHTTPSUpstreams(t *testing.T) {
	base := func(extra map[string]any) map[string]any {
		fields := map[string]any{"type": "http", "host": "proxy.example", "port": 3128}
		for key, value := range extra {
			fields[key] = value
		}
		return fields
	}
	for _, tc := range []struct {
		name   string
		fields map[string]any
		code   string
		phase  string
	}{
		{"no host", base(map[string]any{"host": ""}), "invalid-config", "parse"},
		{"host with a space", base(map[string]any{"host": "bad host"}), "invalid-config", "parse"},
		{"host with a port", base(map[string]any{"host": "proxy.example:3128"}), "invalid-config", "parse"},
		{"host with a path", base(map[string]any{"host": "proxy.example/x"}), "invalid-config", "parse"},
		{"host with userinfo", base(map[string]any{"host": "user@proxy.example"}), "invalid-config", "parse"},
		{"host with a leading hyphen", base(map[string]any{"host": "-proxy.example"}), "invalid-config", "parse"},
		{"no port", map[string]any{"type": "http", "host": "proxy.example"}, "invalid-config", "parse"},
		{"port 0", base(map[string]any{"port": 0}), "invalid-config", "parse"},
		{"port 65536", base(map[string]any{"port": 65536}), "invalid-config", "parse"},
		{"negative port", base(map[string]any{"port": -1}), "invalid-config", "parse"},
		{"username without password", base(map[string]any{"username": "alice"}), "invalid-config", "parse"},
		{"password without username", base(map[string]any{"password": "secret"}), "invalid-config", "parse"},
		{"colon in the username", base(map[string]any{"username": "al:ice", "password": "secret"}), "invalid-config", "auth"},
		{"NUL in the username", base(map[string]any{"username": "al" + string(rune(0)) + "ice", "password": "secret"}), "invalid-config", "auth"},
		{"CR in the password", base(map[string]any{"username": "alice", "password": "se" + string(rune(13)) + "cret"}), "invalid-config", "auth"},
		{"LF in the password", base(map[string]any{"username": "alice", "password": "se" + string(rune(10)) + "cret"}), "invalid-config", "auth"},
		{"username of 256 bytes", base(map[string]any{"username": strings.Repeat("u", 256), "password": "p"}), "invalid-config", "auth"},
		{"password of 256 bytes", base(map[string]any{"username": "u", "password": strings.Repeat("p", 256)}), "invalid-config", "auth"},
		{"a URI is not part of this type", base(map[string]any{"uri": "http://proxy.example:3128"}), "invalid-config", "parse"},
		{"a config is not part of this type", base(map[string]any{"config": "client"}), "invalid-config", "parse"},
		{"unknown field", base(map[string]any{"scheme": "http"}), "invalid-config", "parse"},
		{"upper-case type", base(map[string]any{"type": "HTTP"}), "unsupported-profile", "parse"},
		{"SOCKS4", base(map[string]any{"type": "socks4"}), "unsupported-profile", "parse"},
		{"FTP", base(map[string]any{"type": "ftp"}), "unsupported-profile", "parse"},
		{"empty type", base(map[string]any{"type": ""}), "unsupported-profile", "parse"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := decodeProfile(profileJSON(t, tc.fields))
			wantDiagnostic(t, err, tc.code, tc.phase, false)
		})
	}
	// The colon rule is specific to HTTP Basic: SOCKS5 sends the two fields length-prefixed.
	if _, err := decodeProfile(profileJSON(t, map[string]any{"type": "socks5", "host": "proxy.example", "port": 1080, "username": "al:ice", "password": "p"})); err != nil {
		t.Fatalf("SOCKS5 usernames with a colon must stay valid: %v", err)
	}
}

func TestProfileSummaryOfHTTPUpstreamsCarriesEndpointOnly(t *testing.T) {
	for _, kind := range []string{"http", "https"} {
		got := profileSummary(profile{Type: kind, Host: "proxy.example", Port: 3128, Username: "PRIVATE_USER", Password: "PRIVATE_SECRET"})
		if got.Host == nil || *got.Host != "proxy.example" || got.Port == nil || *got.Port != 3128 || got.Type != kind {
			t.Fatalf("%s summary %+v", kind, got)
		}
		if encoded, _ := json.Marshal(got); strings.Contains(string(encoded), "PRIVATE_") {
			t.Fatal("summary exposed credentials")
		}
	}
}

func TestCapabilitiesAdvertiseHTTPAndHTTPSAndKeepTheOldKeys(t *testing.T) {
	capabilities := (&host{base: t.TempDir()}).capabilities()
	for _, key := range []string{"socks5", "http", "https"} {
		if !capabilities[key] {
			t.Errorf("capability %q missing", key)
		}
	}
	for _, key := range []string{"socks5", "vless", "openvpn", "vault"} { // the four an older extension requires to be booleans
		if _, ok := capabilities[key]; !ok {
			t.Errorf("legacy capability %q disappeared", key)
		}
	}
	if capabilities["vless"] || capabilities["openvpn"] {
		t.Error("engines are reported although none is installed")
	}
	response, err := (&host{base: t.TempDir(), profiles: map[string]profile{}}).dispatch(request{Op: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if hello := response.(map[string]any); hello["version"] != 1 {
		t.Fatalf("hello %v", hello)
	}
}

func TestHostSavesAndExportsHTTPProfilesThroughTheWireProtocol(t *testing.T) {
	vault := filepath.Join(t.TempDir(), "owned.dpapi")
	h, err := newHost(t.TempDir(), vault)
	if err != nil {
		t.Fatal(err)
	}
	var input, output bytes.Buffer
	send := func(id, op string, fields map[string]any) {
		fields["v"], fields["id"], fields["op"] = 1, id, op
		if err := writeFrame(&input, fields); err != nil {
			t.Fatal(err)
		}
	}
	send("one", "save", map[string]any{"profileId": "web", "profile": map[string]any{"type": "http", "host": "proxy.example", "port": 3128, "username": "alice", "password": "s3cr:et"}})
	send("two", "save", map[string]any{"profileId": "secure", "profile": map[string]any{"type": "https", "host": "proxy.example", "port": 443}})
	send("three", "save", map[string]any{"profileId": "bad", "profile": map[string]any{"type": "http", "host": "proxy.example", "port": 3128, "username": "al:ice", "password": "p"}})
	send("four", "export", map[string]any{"profileIds": []string{"secure", "web"}})
	if err = runHost(&input, &output, h); err != nil {
		t.Fatal(err)
	}
	read := func() response {
		t.Helper()
		frame, err := nativeFrame(&output)
		if err != nil {
			t.Fatal(err)
		}
		var r response
		if err = json.Unmarshal(frame, &r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	if first := read(); !first.OK || first.ID != "one" {
		t.Fatalf("save of an http profile failed: %+v", first.Error)
	}
	if second := read(); !second.OK {
		t.Fatalf("save of an https profile failed: %+v", second.Error)
	}
	if third := read(); third.OK || third.Error == nil || third.Error.Code != "invalid-config" || third.Error.Phase != "auth" {
		t.Fatalf("a colon in the username must be refused with a fixed code: %+v", third)
	}
	exported := read()
	if !exported.OK {
		t.Fatalf("export failed: %+v", exported.Error)
	}
	encoded, _ := json.Marshal(exported.Result)
	for _, want := range []string{`"type":"https"`, `"type":"http"`, `"username":"alice"`, `"password":"s3cr:et"`, `"port":3128`} {
		if !strings.Contains(string(encoded), want) {
			t.Fatalf("export lacks %s: %s", want, encoded)
		}
	}
	if !vaultAvailable() {
		return
	}
	reloaded, err := newHost(t.TempDir(), vault)
	if err != nil {
		t.Fatalf("the persisted vault with http profiles cannot be loaded again: %v", err)
	}
	defer reloaded.close()
	if got := reloaded.profiles["web"]; got.Type != "http" || got.Username != "alice" || got.Password != "s3cr:et" || got.Port != 3128 {
		t.Fatalf("reloaded %+v", got)
	}
}

func TestStartTunnelForHTTPUpstreamsProbesWithoutSendingAnything(t *testing.T) {
	addr, seen := httpProxy(t, echoTunnel)
	tunnel, err := startTunnel(t.TempDir(), httpClientProfile(addr, "alice", "s3cr:et"))
	if err != nil {
		t.Fatal(err)
	}
	if tunnel.relay == nil || !tunnel.alive() {
		t.Fatal("no relay")
	}
	noRequest(t, seen) // the probe proves the server answers; it names no destination and sends no credentials
	tunnel.Close()
	if c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", tunnel.port), 500*time.Millisecond); err == nil {
		c.Close()
		t.Fatal("the relay still listens after Close")
	}
	_, err = startTunnel(t.TempDir(), profile{Type: "http", Host: "127.0.0.1", Port: closedPort(t)})
	wantDiagnostic(t, err, "connection-refused", "endpoint", true)
}

func TestConnectAndDisconnectOperationsServeHTTPProfiles(t *testing.T) {
	addr, _ := httpProxy(t, echoTunnel)
	h := &host{base: t.TempDir(), profiles: map[string]profile{"web": httpClientProfile(addr, "", "")}}
	defer h.close()
	result, err := h.dispatch(request{Op: "connect", ProfileID: "web"})
	if err != nil {
		t.Fatal(err)
	}
	port := result.(map[string]any)["port"].(int)
	if result.(map[string]any)["host"] != "127.0.0.1" || port < 1 {
		t.Fatalf("connect result %v", result)
	}
	status, _ := h.dispatch(request{Op: "status"})
	if state := status.(map[string]any)["state"]; state != "connected" || status.(map[string]any)["profileId"] != "web" {
		t.Fatalf("status %v", status)
	}
	if capabilities := status.(map[string]any)["capabilities"].(map[string]bool); !capabilities["http"] || !capabilities["https"] {
		t.Fatalf("status capabilities %v", capabilities)
	}
	c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", port), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	c.Close()
	if _, err = h.dispatch(request{Op: "disconnect"}); err != nil {
		t.Fatal(err)
	}
	if c, err = net.DialTimeout("tcp4", endpoint("127.0.0.1", port), 500*time.Millisecond); err == nil {
		c.Close()
		t.Fatal("the relay survived Disconnect")
	}
}

func TestDiagnoseUpstreamProbesThroughTheProxyWithTheDestinationDomain(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("probe forwarded credentials")
		}
		w.Header().Set("Set-Cookie", "PRIVATE_COOKIE_CANARY")
		fmt.Fprint(w, `{"ip":"203.0.113.77","token":"PRIVATE_BODY_CANARY"}`)
	}))
	defer origin.Close()
	addr, seen := httpProxy(t, requireBasic("YWxpY2U6czNjcjpldA==", tunnelTo(origin.Listener.Addr().String())))
	result, err := diagnoseUpstream("http://must-remain-remote.invalid/private?test=1", httpClientProfile(addr, "alice", "s3cr:et"))
	if err != nil {
		t.Fatal(err)
	}
	if !result.Reachable || !result.RemoteDNS || result.TLSVerified || result.HTTPStatus != 200 || result.IP == nil || *result.IP != "203.0.113.77" {
		t.Fatalf("inaccurate probe metadata: %+v", result)
	}
	if got := nextSeen(t, seen); got.line != "CONNECT must-remain-remote.invalid:80 HTTP/1.1" {
		t.Fatalf("the proxy saw %q: the destination domain must reach it unresolved", got.line)
	}
	encoded, _ := json.Marshal(result)
	for _, secret := range []string{"PRIVATE", "private", "test=1", "alice", "s3cr"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("probe result leaked %q: %s", secret, encoded)
		}
	}
}

func TestManagerChecksHTTPProfilesWithoutAnActiveTunnel(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"ip":"203.0.113.78"}`) }))
	defer origin.Close()
	addr, seen := httpProxy(t, requireBasic("YWxpY2U6czNjcjpldA==", tunnelTo(origin.Listener.Addr().String())))
	h := &host{base: t.TempDir(), profiles: map[string]profile{
		"good":      httpClientProfile(addr, "alice", "s3cr:et"),
		"wrong":     httpClientProfile(addr, "alice", "wrong"),
		"anonymous": httpClientProfile(addr, "", ""),
		"refused":   {Type: "http", Host: "127.0.0.1", Port: closedPort(t)},
	}}
	result, err := h.dispatch(request{Op: "check", ProfileID: "good", URL: "http://remote-dns.invalid/"})
	if err != nil || !result.(probeResult).Reachable || !result.(probeResult).RemoteDNS || result.(probeResult).IP == nil || *result.(probeResult).IP != "203.0.113.78" {
		t.Fatalf("saved http profile check failed: %v %+v", err, result)
	}
	if h.active != nil || h.activeID != "" || h.lastError != nil {
		t.Fatal("a check started a tunnel or changed the connection status")
	}
	nextSeen(t, seen)
	for _, tc := range []struct {
		id, code, phase string
		retryable       bool
	}{
		{"wrong", "auth-failed", "auth", false},
		{"anonymous", "auth-required", "auth", false},
		{"refused", "connection-refused", "endpoint", true},
	} {
		_, err = h.dispatch(request{Op: "check", ProfileID: tc.id, URL: "http://remote-dns.invalid/"})
		wantDiagnostic(t, err, tc.code, tc.phase, tc.retryable)
		encoded, _ := json.Marshal(safeDiagnostic(err))
		for _, secret := range []string{"alice", "wrong", "s3cr", "remote-dns", "CANARY"} {
			if strings.Contains(string(encoded), secret) {
				t.Fatalf("%s: diagnostic leaked %q", tc.id, secret)
			}
		}
	}
}

func TestManagerCheckOfAnHTTPProfileLeavesAnActiveRouteAlone(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"ip":"203.0.113.79"}`) }))
	defer origin.Close()
	httpAddr, _ := httpProxy(t, tunnelTo(origin.Listener.Addr().String()))
	socksEndpoint, _ := ownedProbeProxy(t, origin.Listener.Addr().String())
	activeProfile := profile{Type: "socks5", Host: socksEndpoint.Host, Port: socksEndpoint.Port}
	active, err := startTunnel(t.TempDir(), activeProfile)
	if err != nil {
		t.Fatal(err)
	}
	defer active.Close()
	previous := &diagnostic{"dns-failed", "dns", true}
	h := &host{base: t.TempDir(), profiles: map[string]profile{"active": activeProfile, "web": httpClientProfile(httpAddr, "", "")}, active: active, activeID: "active", lastError: previous}
	for _, id := range []string{"web", "active"} {
		result, err := h.dispatch(request{Op: "check", ProfileID: id, URL: "http://remote-dns.invalid/"})
		if err != nil || !result.(probeResult).Reachable {
			t.Fatalf("check of %s failed: %v", id, err)
		}
		if h.active != active || h.activeID != "active" || h.lastError != previous || !active.alive() {
			t.Fatalf("checking %s changed the active route", id)
		}
	}
	// A check of an http profile that is itself active does not need, or disturb, its relay.
	web, err := startTunnel(t.TempDir(), h.profiles["web"])
	if err != nil {
		t.Fatal(err)
	}
	defer web.Close()
	h.active, h.activeID = web, "web"
	if result, err := h.dispatch(request{Op: "check", ProfileID: "web", URL: "http://remote-dns.invalid/"}); err != nil || !result.(probeResult).Reachable {
		t.Fatalf("check of the active http profile failed: %v", err)
	}
	if h.active != web || !web.alive() {
		t.Fatal("the check disturbed the active http relay")
	}
	h.active = nil // the deferred Close calls above own both tunnels
}

func TestDiagnosticsOfTheRelayPathAreFixedAndSecretFree(t *testing.T) {
	// The "diagnose" operation runs through the loopback relay of the active tunnel: the proxy's refusal reaches it as a SOCKS5
	// reply, and the result must still be a fixed code, never the proxy's words.
	addr, _ := httpProxy(t, respond(canaryResponse(403)))
	relay, err := startRelay(httpClientProfile(addr, "alice", "s3cr:et"))
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()
	_, err = diagnoseProxy("http://canary-destination.invalid/", probeEndpoint{Host: "127.0.0.1", Port: relay.port()})
	wantDiagnostic(t, err, "proxy-denied", "socks", false)
	encoded, _ := json.Marshal(safeDiagnostic(err))
	for _, secret := range []string{"CANARY", "canary-destination", "alice", "s3cr"} {
		if strings.Contains(string(encoded), secret) || strings.Contains(err.Error(), secret) {
			t.Fatalf("leaked %q: %s", secret, encoded)
		}
	}
	// And a proxy that works is reachable through the same path.
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "203.0.113.5") }))
	defer origin.Close()
	good, _ := httpProxy(t, tunnelTo(origin.Listener.Addr().String()))
	relay2, err := startRelay(httpClientProfile(good, "", ""))
	if err != nil {
		t.Fatal(err)
	}
	defer relay2.Close()
	result, err := diagnoseProxy("http://remote-dns.invalid/", probeEndpoint{Host: "127.0.0.1", Port: relay2.port()})
	if err != nil || !result.Reachable || !result.RemoteDNS || result.IP == nil || *result.IP != "203.0.113.5" {
		t.Fatalf("diagnose through the relay of an http profile: %v %+v", err, result)
	}
}

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestManagerStrictOperationFieldsAndIDs(t *testing.T) {
	for _, raw := range []string{
		`{"v":1,"id":"m","op":"export","profileIds":[]}`,
		`{"v":1,"id":"m","op":"export","profileIds":null}`,
		`{"v":1,"id":"m","op":"export","profileIds":["a","a"]}`,
		`{"v":1,"id":"m","op":"export","profileIds":["a/b"]}`,
		`{"v":1,"id":"m","op":"export","profileIds":["a"],"profileId":""}`,
		`{"v":1,"id":"m","op":"export","profileIds":["a"],"profile":null}`,
		`{"v":1,"id":"m","op":"export","ProfileIds":["a"]}`,
		`{"v":1,"id":"m","op":"export","profileIds":["a"],"profileIds":["b"]}`,
		`{"v":1,"id":"m","op":"check","profileId":"a","url":"https://a.invalid","endpoint":null}`,
		`{"v":1,"id":"m","op":"check","profileId":"a","url":"https://a.invalid","profileIds":[]}`,
		`{"v":1,"id":"m","op":"check","url":"https://a.invalid"}`,
		`{"v":1,"id":"m","op":"check","profileId":"a","url":"https://user:secret@a.invalid"}`,
		`{"v":1,"id":"m","op":"hello","profileIds":[]}`,
		`{"v":1,"id":"m","op":"save","profileId":"a","profile":{},"url":""}`,
	} {
		if _, err := decodeRequest([]byte(raw)); err == nil {
			t.Fatal("ambiguous or cross-operation manager fields accepted")
		}
	}
	for _, raw := range []string{
		`{"v":1,"id":"m","op":"export","profileIds":["a","b"]}`,
		`{"v":1,"id":"m","op":"check","profileId":"a","url":"https://a.invalid/"}`,
	} {
		if _, err := decodeRequest([]byte(raw)); err != nil {
			t.Fatal("valid manager schema rejected")
		}
	}
	ids := make([]string, 100)
	for index := range ids {
		ids[index] = fmt.Sprintf("p%d", index)
	}
	if !validExportIDs(ids) || validExportIDs(append(ids, "p100")) {
		t.Fatal("export count bound changed")
	}
}

func TestManagerExplicitExportPreservesSecretsOrderAndReadOnlyVault(t *testing.T) {
	vault := filepath.Join(t.TempDir(), "unchanged.vault")
	if err := os.WriteFile(vault, []byte("unchanged-vault-sentinel"), 0600); err != nil {
		t.Fatal(err)
	}
	profiles := map[string]profile{
		"s": {Type: "socks5", Host: "127.0.0.1", Port: 1080, Username: "OWNED_USER", Password: "OWNED_SECRET"},
		"v": {Type: "vless", URI: "vless://00000000-0000-4000-8000-000000000001@127.0.0.1:443?security=tls&type=tcp"},
		"o": {Type: "openvpn", Config: "client\n<key>\nOWNED_PRIVATE_KEY\n</key>\n", Username: "OWNED_VPN_USER", Password: "OWNED_VPN_SECRET"},
	}
	h := &host{vaultFile: vault, profiles: profiles, lastError: &diagnostic{"dns-failed", "dns", true}}
	result, err := h.dispatch(request{ID: "export", Op: "export", ProfileIDs: []string{"o", "s", "v"}})
	if err != nil {
		t.Fatal("explicit export failed")
	}
	exported, ok := result.(exportResult)
	if !ok || len(exported.Profiles) != 3 {
		t.Fatal("export result schema changed")
	}
	for index, id := range []string{"o", "s", "v"} {
		if exported.Profiles[index].ProfileID != id || !reflect.DeepEqual(exported.Profiles[index].Profile, profiles[id]) {
			t.Fatal("export omitted or modified original typed secret profile")
		}
	}
	data, err := os.ReadFile(vault)
	if err != nil || string(data) != "unchanged-vault-sentinel" || h.lastError.Code != "dns-failed" {
		t.Fatal("read-only export changed vault or connection status")
	}
	ordinary, err := h.dispatch(request{Op: "status"})
	encoded, _ := json.Marshal(ordinary)
	if err != nil || bytes.Contains(encoded, []byte("OWNED_")) || bytes.Contains(encoded, []byte("vless://")) {
		t.Fatal("ordinary status leaked export secrets")
	}
	missing, err := h.dispatch(request{ID: "missing", Op: "export", ProfileIDs: []string{"s", "absent"}})
	if err == nil || safeDiagnostic(err).Code != "profile-not-found" || len(missing.(exportResult).Profiles) != 0 {
		t.Fatal("export returned partial secrets for a missing profile")
	}
}

func TestManagerExportOversizeDoesNotTerminateNativeChannel(t *testing.T) {
	h := &host{profiles: map[string]profile{
		"a": {Type: "openvpn", Config: strings.Repeat("OWNED_PRIVATE_CONFIG", 18000)},
		"b": {Type: "openvpn", Config: strings.Repeat("OWNED_PRIVATE_CONFIG", 18000)},
	}}
	var input, output bytes.Buffer
	if err := writeFrame(&input, request{V: 1, ID: "large", Op: "export", ProfileIDs: []string{"a", "b"}}); err != nil {
		t.Fatal(err)
	}
	if err := writeFrame(&input, request{V: 1, ID: "next", Op: "hello"}); err != nil {
		t.Fatal(err)
	}
	if err := runHost(&input, &output, h); err != nil {
		t.Fatal("oversize export killed native channel")
	}
	first, err := nativeFrame(&output)
	if err != nil {
		t.Fatal(err)
	}
	var failure response
	if json.Unmarshal(first, &failure) != nil || failure.OK || failure.Error == nil || failure.Error.Code != "capacity" || failure.Error.Phase != "frame" || failure.Result != nil || bytes.Contains(first, []byte("OWNED_PRIVATE")) {
		t.Fatal("oversize export failed to redact complete response")
	}
	second, err := nativeFrame(&output)
	var next response
	if err != nil || json.Unmarshal(second, &next) != nil || !next.OK || next.ID != "next" {
		t.Fatal("native channel did not accept operation after oversize export")
	}
}

func TestManagerCheckPreservesActiveRouteAndStatus(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"ip":"203.0.113.56"}`) }))
	defer origin.Close()
	endpoint, _ := ownedProbeProxy(t, origin.Listener.Addr().String())
	remote := profile{Type: "socks5", Host: endpoint.Host, Port: endpoint.Port}
	active, err := startTunnel(t.TempDir(), remote)
	if err != nil {
		t.Fatal(err)
	}
	defer active.Close()
	previousError := &diagnostic{"dns-failed", "dns", true}
	h := &host{base: t.TempDir(), profiles: map[string]profile{"active": remote, "other": remote, "missing-engine": {Type: "vless"}}, active: active, activeID: "active", lastError: previousError}
	assertUnchanged := func() {
		t.Helper()
		if h.active != active || h.activeID != "active" || h.lastError != previousError || !active.alive() {
			t.Fatal("profile check changed active browser route or status")
		}
	}
	for _, id := range []string{"other", "active"} {
		result, err := h.dispatch(request{Op: "check", ProfileID: id, URL: "http://remote-dns.invalid/"})
		if err != nil || !result.(probeResult).Reachable || !result.(probeResult).RemoteDNS || result.(probeResult).IP == nil {
			t.Fatal("owned saved-profile check failed")
		}
		assertUnchanged()
	}
	if _, err := h.dispatch(request{Op: "check", ProfileID: "missing-engine", URL: "http://remote-dns.invalid/"}); err == nil || safeDiagnostic(err).Code != "engine-missing" {
		t.Fatal("expected temporary engine failure missing")
	}
	assertUnchanged()
	if _, err := diagnoseProxy("http://still-active.invalid/", probeEndpoint{Host: "127.0.0.1", Port: active.port}); err != nil {
		t.Fatal("check retired or corrupted the original active relay")
	}
}

func TestManagerTemporaryCheckClosesRelayOnSuccessAndFailure(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "203.0.113.1") }))
	defer origin.Close()
	endpoint, _ := ownedProbeProxy(t, origin.Listener.Addr().String())
	for _, target := range []string{"http://remote.invalid/", "https://remote.invalid/"} {
		temporary, err := startTunnel(t.TempDir(), profile{Type: "socks5", Host: endpoint.Host, Port: endpoint.Port})
		if err != nil {
			t.Fatal(err)
		}
		_, err = diagnoseTemporaryTunnel(temporary, target)
		if strings.HasPrefix(target, "https:") && (err == nil || safeDiagnostic(err).Code != "tls-failed") || strings.HasPrefix(target, "http:") && err != nil {
			t.Fatal("unexpected owned temporary check outcome")
		}
		connection, err := net.DialTimeout("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(temporary.port)), time.Second)
		if err == nil {
			connection.Close()
			t.Fatal("temporary relay listener survived completed check")
		}
	}
}

func TestManagerOpenVPNCheckProtectsExistingSession(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "203.0.113.1") }))
	defer origin.Close()
	endpoint, _ := ownedProbeProxy(t, origin.Listener.Addr().String())
	// The owned relay stands in for an already-live native route. The important
	// assertion is that a second OpenVPN engine is never started from the guard.
	active, err := startTunnel(t.TempDir(), profile{Type: "socks5", Host: endpoint.Host, Port: endpoint.Port})
	if err != nil {
		t.Fatal(err)
	}
	defer active.Close()
	h := &host{base: t.TempDir(), profiles: map[string]profile{"vpn": {Type: "openvpn"}, "other": {Type: "openvpn"}}, activeID: "vpn", active: active}
	if _, err := h.dispatch(request{Op: "check", ProfileID: "other", URL: "http://remote.invalid/"}); err == nil || safeDiagnostic(err).Code != "active-vpn" || safeDiagnostic(err).Retryable {
		t.Fatal("second OpenVPN check was allowed to compete with the live session")
	}
	if _, err := h.dispatch(request{Op: "check", ProfileID: "vpn", URL: "http://remote.invalid/"}); err != nil {
		t.Fatal("same-profile check did not reuse existing route")
	}
	if h.active != active || h.activeID != "vpn" || !active.alive() {
		t.Fatal("guard or same-profile check changed active route")
	}
}

func TestManagerCheckAuthenticatesSavedSOCKSProfile(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "203.0.113.4") }))
	defer origin.Close()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	var auths atomic.Int32
	go func() {
		for {
			client, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer client.Close()
				client.SetDeadline(time.Now().Add(3 * time.Second))
				var hello [4]byte
				if _, err := io.ReadFull(client, hello[:]); err != nil || hello != [4]byte{5, 2, 0, 2} {
					return
				}
				client.Write([]byte{5, 2})
				var auth [2]byte
				if _, err := io.ReadFull(client, auth[:]); err != nil || auth[0] != 1 {
					return
				}
				username := make([]byte, int(auth[1]))
				if _, err := io.ReadFull(client, username); err != nil {
					return
				}
				var size [1]byte
				if _, err := io.ReadFull(client, size[:]); err != nil {
					return
				}
				password := make([]byte, int(size[0]))
				if _, err := io.ReadFull(client, password); err != nil || string(username) != "owned-user" || string(password) != "owned-pass" {
					return
				}
				client.Write([]byte{1, 0})
				auths.Add(1)
				var request [4]byte
				if _, err := io.ReadFull(client, request[:]); err != nil || request[3] != 3 {
					return
				}
				if _, err := readSocksAddress(client, request[3]); err != nil {
					return
				}
				remote, err := net.DialTimeout("tcp", origin.Listener.Addr().String(), time.Second)
				if err != nil {
					return
				}
				defer remote.Close()
				client.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 0})
				done := make(chan struct{})
				go func() { io.Copy(remote, client); close(done) }()
				io.Copy(client, remote)
				client.Close()
				<-done
			}()
		}
	}()
	h := &host{profiles: map[string]profile{"saved": {Type: "socks5", Host: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port, Username: "owned-user", Password: "owned-pass"}}}
	result, err := h.dispatch(request{Op: "check", ProfileID: "saved", URL: "http://must-remain-remote.invalid/"})
	if err != nil || !result.(probeResult).Reachable || !result.(probeResult).RemoteDNS || auths.Load() != 2 || h.active != nil || h.activeID != "" {
		t.Fatal("temporary check omitted saved SOCKS authentication or changed active state")
	}
}

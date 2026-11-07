package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func ownedProbeProxy(t *testing.T, origin string) (probeEndpoint, <-chan string) {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	seen := make(chan string, 16)
	go func() {
		for {
			client, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer client.Close()
				client.SetDeadline(time.Now().Add(5 * time.Second))
				var greeting [3]byte
				if _, err := io.ReadFull(client, greeting[:]); err != nil {
					return
				}
				if greeting != [3]byte{5, 1, 0} {
					return
				}
				client.Write([]byte{5, 0})
				var request [4]byte
				if _, err := io.ReadFull(client, request[:]); err != nil {
					return
				}
				address, err := readSocksAddress(client, request[3])
				if err != nil {
					return
				}
				if request[3] == 3 {
					seen <- string(address[1 : 1+int(address[0])])
				} else {
					seen <- "LITERAL"
				}
				remote, err := net.DialTimeout("tcp", origin, time.Second)
				if err != nil {
					return
				}
				defer remote.Close()
				client.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 0})
				done := make(chan struct{}, 1)
				go func() {
					io.Copy(remote, client)
					if tcp, ok := remote.(*net.TCPConn); ok {
						tcp.CloseWrite()
					}
					done <- struct{}{}
				}()
				io.Copy(client, remote)
				remote.Close()
				client.Close()
				<-done
			}()
		}
	}()
	return probeEndpoint{Host: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port}, seen
}
func TestDiagnoseStrictRequestAndURL(t *testing.T) {
	for _, url := range []string{"file:///private", "ftp://example.com/", "https://user:password@example.com/", "https://example.com/#secret", "https://example.com:65536/", "https://example.com/\r\nInjected:yes", "https://example.com\\@evil.invalid/"} {
		if _, err := probeURL(url); err == nil {
			t.Fatal("invalid probe URL accepted")
		}
	}
	for _, raw := range []string{`{"v":1,"id":"d","op":"diagnose","url":"https://example.com","profileId":"p"}`, `{"v":1,"id":"d","op":"diagnose","url":"https://example.com","endpoint":{"host":"127.0.0.1","port":0}}`, `{"v":1,"id":"d","op":"hello","url":"https://example.com"}`} {
		if _, err := decodeRequest([]byte(raw)); err == nil {
			t.Fatal("invalid probe RPC accepted")
		}
	}
	if _, err := decodeRequest([]byte(`{"v":1,"id":"d","op":"diagnose","url":"https://example.com"}`)); err != nil {
		t.Fatal(err)
	}
}
func TestDiagnoseRemoteDomainAndRedactedResult(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("probe forwarded credentials")
		}
		w.Header().Set("Set-Cookie", "PRIVATE_COOKIE_CANARY")
		fmt.Fprint(w, `{"ip":"203.0.113.88","token":"PRIVATE_BODY_CANARY"}`)
	}))
	defer origin.Close()
	endpoint, seen := ownedProbeProxy(t, origin.Listener.Addr().String())
	result, err := diagnoseProxy("http://must-remain-remote.invalid/private?test=1", endpoint)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Reachable || !result.RemoteDNS || result.TLSVerified || result.HTTPStatus != 200 || result.IP == nil || *result.IP != "203.0.113.88" {
		t.Fatal("inaccurate probe metadata")
	}
	select {
	case host := <-seen:
		if host != "must-remain-remote.invalid" {
			t.Fatal("probe domain was resolved locally")
		}
	case <-time.After(time.Second):
		t.Fatal("no remote-domain probe")
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "PRIVATE") || strings.Contains(string(encoded), "private") || strings.Contains(string(encoded), "test=1") {
		t.Fatal("probe leaked response or URL")
	}
}
func TestDiagnoseNeverFollowsRedirectOrReturnsArbitraryBody(t *testing.T) {
	var calls atomic.Int32
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path == "/redirect" {
			w.Header().Set("Location", "http://unexpected.invalid/private")
			w.WriteHeader(302)
			return
		}
		fmt.Fprint(w, strings.Repeat("PRIVATE_BODY_CANARY", 2048))
	}))
	defer origin.Close()
	endpoint, _ := ownedProbeProxy(t, origin.Listener.Addr().String())
	redirect, err := diagnoseProxy("http://probe.invalid/redirect", endpoint)
	if err != nil || redirect.HTTPStatus != 302 || !redirect.Reachable || calls.Load() != 1 {
		t.Fatal("probe redirect policy changed")
	}
	large, err := diagnoseProxy("http://probe.invalid/large", endpoint)
	if err != nil || large.IP != nil || large.HTTPStatus != 200 {
		t.Fatal("large probe response was not bounded")
	}
}
func TestDiagnoseTLSRejectsUntrustedCertificates(t *testing.T) {
	origin := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("untrusted TLS reached HTTP handler") }))
	origin.Config.ErrorLog = log.New(io.Discard, "", 0)
	origin.StartTLS()
	defer origin.Close()
	endpoint, _ := ownedProbeProxy(t, origin.Listener.Addr().String())
	_, err := diagnoseProxy("https://probe.invalid/", endpoint)
	if err == nil || safeDiagnostic(err).Code != "tls-failed" || safeDiagnostic(err).Phase != "tls" {
		t.Fatal("untrusted probe TLS was accepted or misclassified")
	}
}
func TestDiagnoseHTTPFailureStatusStillProvesRoute(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(403) }))
	defer origin.Close()
	endpoint, _ := ownedProbeProxy(t, origin.Listener.Addr().String())
	result, err := diagnoseProxy("http://probe.invalid/", endpoint)
	if err != nil || !result.Reachable || result.HTTPStatus != 403 {
		t.Fatal("destination HTTP status confused with proxy auth")
	}
	_, port, _ := net.SplitHostPort(origin.Listener.Addr().String())
	if _, err = strconv.Atoi(port); err != nil {
		t.Fatal(err)
	}
}
func TestDiagnoseHTTPSAgainstHTTPIsTLSFailure(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer origin.Close()
	endpoint, _ := ownedProbeProxy(t, origin.Listener.Addr().String())
	_, err := diagnoseProxy("https://probe.invalid/", endpoint)
	if err == nil || safeDiagnostic(err).Code != "tls-failed" || safeDiagnostic(err).Phase != "tls" {
		t.Fatal("HTTP endpoint answering HTTPS was not classified as TLS failure")
	}
}

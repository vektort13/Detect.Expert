package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReviewNativeRequestsRejectAmbiguity(t *testing.T) {
	for _, data := range []string{
		`{"v":1,"id":"r","op":"hello","op":"status"}`,
		`{"v":1,"id":"r","op":"save","profileId":"p","profile":{"type":"socks5","type":"vless"}}`,
		`{"v":1,"id":"r","op":"hello","arbitraryCommand":"must-not-run"}`,
		`{"v":1,"id":"r","op":"connect","profileId":"../escape"}`,
		`{"v":1,"id":"r","op":"hello"} {"v":1}`,
	} {
		if _, err := decodeRequest([]byte(data)); err == nil {
			t.Fatal("ambiguous or excessive native request accepted")
		}
	}
	for _, length := range []uint32{0, frameLimit + 1, ^uint32(0)} {
		var header [4]byte
		binary.LittleEndian.PutUint32(header[:], length)
		if _, err := nativeFrame(bytes.NewReader(header[:])); err == nil {
			t.Fatal("invalid frame bound accepted")
		}
	}
}

func TestReviewDiagnosticNeverProjectsRawEngineOutput(t *testing.T) {
	const marker = "PRIVATE-CREDENTIAL-CANARY"
	for _, text := range []string{"AUTH_FAILED " + marker, "x509 certificate " + marker, "DNS lookup failed " + marker, "arbitrary " + marker} {
		sink := &diagnosticSink{}
		sink.Write([]byte(text))
		data, err := json.Marshal(sink.diagnostic())
		if err != nil || bytes.Contains(data, []byte(marker)) {
			t.Fatal("raw child data reached diagnostic projection")
		}
	}
}

func TestReviewDiagnosticIgnoresBenignDNSMessages(t *testing.T) {
	for _, text := range []string{
		"INFO VPN up local=10.0.0.2 gateway=10.0.0.1 cipher=AES-256-GCM dns=[10.0.0.1]",
		"DEBUG DNS-over-tunnel fallback succeeded via public resolver",
		"DEBUG dns cache stats hits_total=10 misses_total=1",
	} {
		sink := &diagnosticSink{}
		sink.Write([]byte(text))
		if sink.code != "" {
			t.Fatal("successful DNS activity was classified as an error")
		}
	}
}

func TestReviewOpenVPNRejectsExternalExecutionAndFiles(t *testing.T) {
	base := "client\ndev tun\nproto udp\nremote vpn.example 1194\n<ca>\nfixture-only\n</ca>\n"
	for _, line := range []string{"ca C:/secret.pem", "auth-user-pass C:/password.txt", "up malicious.exe", "down malicious.exe", "plugin malicious.dll", "management 127.0.0.1 10000", "config other.ovpn", "script-security 2"} {
		if _, err := validateOpenVPN(base + line + "\n"); err == nil {
			t.Fatalf("unsafe directive accepted: %s", strings.Fields(line)[0])
		}
	}
}

func TestReviewOpenVPNRejectsUnimplementedTrustConstraints(t *testing.T) {
	base := "client\ndev tun\nproto udp\nremote vpn.example 1194\n<ca>\nfixture-only\n</ca>\n"
	for _, directive := range []string{
		"peer-fingerprint 00:01:02:03:04:05:06:07:08:09:0a:0b:0c:0d:0e:0f",
		"tls-cipher TLS-ECDHE-RSA-WITH-AES-128-GCM-SHA256",
		"tls-ciphersuites TLS_AES_128_GCM_SHA256",
	} {
		if _, err := validateOpenVPN(base + directive + "\n"); err == nil {
			t.Fatalf("unimplemented trust constraint silently accepted: %s", strings.Fields(directive)[0])
		}
	}
}

func TestReviewHostEOFClosesOwnedRelay(t *testing.T) {
	relay, err := startRelay(profile{Type: "socks5", Host: "127.0.0.1", Port: 9})
	if err != nil {
		t.Fatal(err)
	}
	port := relay.port()
	h := &host{profiles: map[string]profile{}, active: &tunnel{port: port, relay: relay}, activeID: "owned"}
	if err := runHost(bytes.NewReader(nil), io.Discard, h); err != nil {
		t.Fatal(err)
	}
	c, err := net.DialTimeout("tcp4", endpoint("127.0.0.1", port), time.Second)
	if err == nil {
		c.Close()
		t.Fatal("native stdin EOF left relay listening")
	}
}

func TestReviewVaultRoundtripContainsNoPlaintext(t *testing.T) {
	if !vaultAvailable() {
		t.Skip("OS vault unavailable on this test platform")
	}
	path := filepath.Join(t.TempDir(), "owned.dpapi")
	h, err := newHost(t.TempDir(), path)
	if err != nil {
		t.Fatal(err)
	}
	const marker = "SECRET-VAULT-CANARY"
	h.profiles["p"] = profile{Type: "socks5", Host: "127.0.0.1", Port: 1080, Username: "owned", Password: marker}
	if err := h.saveVault(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || bytes.Contains(data, []byte(marker)) {
		t.Fatal("vault was absent or contained plaintext")
	}
	copy, err := newHost(t.TempDir(), path)
	if err != nil || copy.profiles["p"].Password != marker {
		t.Fatal("OS-vault roundtrip failed")
	}
	h.close()
	copy.close()
}

func TestReviewRelayPreservesRemoteDomainAndHalfClose(t *testing.T) {
	upstream, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Close()
	seen := make(chan string, 1)
	go func() {
		c, err := upstream.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		c.SetDeadline(time.Now().Add(5 * time.Second))
		var greeting [4]byte
		if _, err := io.ReadFull(c, greeting[:]); err != nil || greeting != [4]byte{5, 2, 0, 2} {
			return
		}
		c.Write([]byte{5, 2})
		var auth [2]byte
		if _, err := io.ReadFull(c, auth[:]); err != nil || auth[0] != 1 {
			return
		}
		username := make([]byte, int(auth[1]))
		io.ReadFull(c, username)
		var size [1]byte
		io.ReadFull(c, size[:])
		password := make([]byte, int(size[0]))
		io.ReadFull(c, password)
		if string(username) != "owned-user" || string(password) != "owned-pass" {
			return
		}
		c.Write([]byte{1, 0})
		var request [4]byte
		if _, err := io.ReadFull(c, request[:]); err != nil || request[3] != 3 {
			return
		}
		address, err := readSocksAddress(c, request[3])
		if err != nil {
			return
		}
		seen <- string(address[1 : len(address)-2])
		c.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 1})
		payload, err := io.ReadAll(c)
		if err == nil && string(payload) == "request-before-half-close" {
			c.Write([]byte("response-after-half-close"))
		}
	}()
	remote := profile{Type: "socks5", Host: "127.0.0.1", Port: upstream.Addr().(*net.TCPAddr).Port, Username: "owned-user", Password: "owned-pass"}
	relay, err := startRelay(remote)
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()
	c, err := socksConnect(profile{Type: "socks5", Host: "127.0.0.1", Port: relay.port()}, "must-stay-remote.invalid", 443)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	c.Write([]byte("request-before-half-close"))
	c.(*net.TCPConn).CloseWrite()
	result, err := io.ReadAll(c)
	if err != nil || string(result) != "response-after-half-close" {
		t.Fatalf("relay truncated half-close response: bytes=%d, err=%v", len(result), err)
	}
	select {
	case domain := <-seen:
		if domain != "must-stay-remote.invalid" {
			t.Fatal("destination domain was resolved or changed locally")
		}
	case <-time.After(time.Second):
		t.Fatal("domain did not reach owned upstream")
	}
}

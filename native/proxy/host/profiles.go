// ADR-070: user-supplied connection profiles, never executable configuration.
package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const maxProfileBytes = 256 * 1024

type profile struct {
	Type     string `json:"type"`
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	URI      string `json:"uri,omitempty"`
	Config   string `json:"config,omitempty"`
}

type summary struct {
	Type string  `json:"type"`
	Host *string `json:"host"`
	Port *int    `json:"port"`
}

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var idPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)
var domainPattern = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$`)

func validHost(host string) bool {
	if host == "" || len(host) > 253 || strings.TrimSpace(host) != host {
		return false
	}
	if net.ParseIP(strings.Trim(host, "[]")) != nil {
		return !strings.Contains(host, "%")
	}
	if !domainPattern.MatchString(host) || strings.Contains(host, "..") {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) > 63 || label == "" || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
	}
	return true
}

func decodeProfile(raw json.RawMessage) (profile, error) {
	var p profile
	if len(raw) > maxProfileBytes {
		return p, fail("invalid-config", "parse", false)
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&p) != nil {
		return p, fail("invalid-config", "parse", false)
	}
	if p.Type != "socks5" && p.Type != "http" && p.Type != "https" && p.Type != "vless" && p.Type != "openvpn" {
		return p, fail("unsupported-profile", "parse", false)
	}
	if len(p.Username) > 255 || len(p.Password) > 255 || strings.ContainsAny(p.Username+p.Password, "\x00\r\n") {
		return p, fail("invalid-config", "auth", false)
	}
	switch p.Type {
	case "socks5", "http", "https":
		if !validHost(p.Host) || p.Port < 1 || p.Port > 65535 || p.URI != "" || p.Config != "" || (p.Username == "") != (p.Password == "") {
			return p, fail("invalid-config", "parse", false)
		}
		// HTTP Basic (RFC 7617) joins the two with a colon, so the user-id cannot contain one.
		if p.Type != "socks5" && strings.Contains(p.Username, ":") {
			return p, fail("invalid-config", "auth", false)
		}
	case "vless":
		if p.Config != "" || p.Host != "" || p.Port != 0 || p.Username != "" || p.Password != "" {
			return p, fail("invalid-config", "parse", false)
		}
		if _, err := vlessConfig(p.URI, 1080); err != nil {
			return p, err
		}
	case "openvpn":
		if p.Host != "" || p.Port != 0 || p.URI != "" {
			return p, fail("invalid-config", "parse", false)
		}
		if _, err := validateOpenVPN(p.Config); err != nil {
			return p, err
		}
	}
	return p, nil
}

func profileSummary(p profile) summary {
	s := summary{Type: p.Type}
	if p.Type == "socks5" || p.Type == "http" || p.Type == "https" {
		s.Host = &p.Host
		s.Port = &p.Port
	}
	if p.Type == "vless" {
		u, err := parseVless(p.URI)
		if err == nil {
			host := u.Hostname()
			port, _ := strconv.Atoi(u.Port())
			s.Host = &host
			s.Port = &port
		}
	}
	if p.Type == "openvpn" {
		if host, port, ok := singleOpenVPNRemote(p.Config); ok {
			s.Host = &host
			s.Port = &port
		}
	}
	return s
}

// ADR-071: expose only an unambiguous validated endpoint, never other inline
// profile contents. The pinned engine's pkg/ovpn.addRemote defaults to 1194.
func singleOpenVPNRemote(text string) (string, int, bool) {
	config, err := validateOpenVPN(text)
	if err != nil {
		return "", 0, false
	}
	block, host, port, count := "", "", 1194, 0
	for _, line := range strings.Split(config, "\n") {
		line = strings.TrimSpace(line)
		if block != "" {
			if line == "</"+block+">" {
				block = ""
			}
			continue
		}
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "<") {
			block = strings.TrimSuffix(strings.TrimPrefix(line, "<"), ">")
			continue
		}
		parts := strings.Fields(line)
		if parts[0] != "remote" {
			continue
		}
		count++
		if count > 1 {
			return "", 0, false
		}
		host = strings.Trim(parts[1], "[]")
		if len(parts) >= 3 {
			port, _ = strconv.Atoi(parts[2]) // Validated above.
		}
	}
	return host, port, count == 1
}

// Markdown escapes are accepted only for punctuation, not arbitrary backslashes.
func normalizeVless(text string) string {
	text = strings.TrimSpace(text)
	for _, pair := range [][2]string{{`\:`, ":"}, {`\_`, "_"}, {`\-`, "-"}, {`\#`, "#"}, {`\&`, "&"}, {`\?`, "?"}, {`\=`, "="}, {`\.`, "."}} {
		text = strings.ReplaceAll(text, pair[0], pair[1])
	}
	return text
}

func parseVless(text string) (*url.URL, error) {
	text = normalizeVless(text)
	if len(text) > 16384 || strings.ContainsAny(text, "\x00\r\n\\") {
		return nil, fail("invalid-config", "parse", false)
	}
	u, err := url.Parse(text)
	if err != nil || u.Scheme != "vless" || u.User == nil || !uuidPattern.MatchString(u.User.Username()) || !validHost(u.Hostname()) {
		return nil, fail("invalid-config", "parse", false)
	}
	if _, ok := u.User.Password(); ok {
		return nil, fail("invalid-config", "parse", false)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 {
		return nil, fail("invalid-config", "parse", false)
	}
	if u.Path != "" && u.Path != "/" {
		return nil, fail("invalid-config", "parse", false)
	}
	allowed := map[string]bool{"type": true, "security": true, "encryption": true, "flow": true, "sni": true, "fp": true, "pbk": true, "sid": true, "spx": true, "alpn": true, "host": true, "path": true, "serviceName": true, "mode": true, "authority": true, "headerType": true}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return nil, fail("invalid-config", "parse", false)
	}
	for k, v := range query {
		if !allowed[k] || len(v) != 1 || len(v[0]) > 4096 || strings.ContainsAny(v[0], "\x00\r\n") {
			return nil, fail("invalid-config", "parse", false)
		}
	}
	return u, nil
}

func vlessConfig(text string, listenPort int) ([]byte, error) {
	u, err := parseVless(text)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	network := q.Get("type")
	if network == "" || network == "tcp" {
		network = "raw"
	}
	if network != "raw" && network != "ws" && network != "grpc" && network != "xhttp" {
		return nil, fail("unsupported-profile", "transport", false)
	}
	security := q.Get("security")
	if security == "" {
		security = "none"
	}
	if security != "none" && security != "tls" && security != "reality" {
		return nil, fail("unsupported-profile", "tls", false)
	}
	flow := q.Get("flow")
	if flow != "" && (flow != "xtls-rprx-vision" || network != "raw" || security == "none") {
		return nil, fail("invalid-config", "transport", false)
	}
	encryption := q.Get("encryption")
	if encryption == "" {
		encryption = "none"
	}
	if encryption != "none" {
		return nil, fail("unsupported-profile", "encryption", false)
	}
	if header := q.Get("headerType"); header != "" && header != "none" {
		return nil, fail("unsupported-profile", "transport", false)
	}
	stream := map[string]any{"network": network, "security": security}
	sni := q.Get("sni")
	if sni == "" {
		sni = u.Hostname()
	}
	if !validHost(sni) {
		return nil, fail("invalid-config", "tls", false)
	}
	fp := q.Get("fp")
	if fp == "" {
		fp = "chrome"
	}
	switch fp {
	case "chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random", "randomized":
	default:
		return nil, fail("unsupported-profile", "tls", false)
	}
	if security == "tls" {
		tls := map[string]any{"serverName": sni, "fingerprint": fp, "allowInsecure": false}
		if alpn := q.Get("alpn"); alpn != "" {
			parts := strings.Split(alpn, ",")
			if len(parts) > 8 {
				return nil, fail("invalid-config", "tls", false)
			}
			tls["alpn"] = parts
		}
		stream["tlsSettings"] = tls
	}
	if security == "reality" {
		key, err := base64.RawURLEncoding.DecodeString(q.Get("pbk"))
		sid := q.Get("sid")
		if err != nil || len(key) != 32 || len(sid) > 16 || len(sid)%2 != 0 || !regexp.MustCompile(`^[0-9a-fA-F]*$`).MatchString(sid) {
			return nil, fail("invalid-config", "reality", false)
		}
		reality := map[string]any{"serverName": sni, "fingerprint": fp, "publicKey": q.Get("pbk"), "shortId": sid}
		if spx := q.Get("spx"); spx != "" {
			if !strings.HasPrefix(spx, "/") {
				return nil, fail("invalid-config", "reality", false)
			}
			reality["spiderX"] = spx
		}
		stream["realitySettings"] = reality
	}
	switch network {
	case "ws":
		path := q.Get("path")
		if path == "" {
			path = "/"
		}
		if !strings.HasPrefix(path, "/") {
			return nil, fail("invalid-config", "transport", false)
		}
		ws := map[string]any{"path": path}
		if host := q.Get("host"); host != "" {
			if !validHost(host) {
				return nil, fail("invalid-config", "transport", false)
			}
			ws["headers"] = map[string]string{"Host": host}
		}
		stream["wsSettings"] = ws
	case "grpc":
		grpc := map[string]any{"serviceName": q.Get("serviceName")}
		if q.Get("mode") == "multi" {
			grpc["multiMode"] = true
		} else if q.Get("mode") != "" && q.Get("mode") != "gun" {
			return nil, fail("unsupported-profile", "transport", false)
		}
		if q.Get("authority") != "" {
			grpc["authority"] = q.Get("authority")
		}
		stream["grpcSettings"] = grpc
	case "xhttp":
		path := q.Get("path")
		if path == "" {
			path = "/"
		}
		if !strings.HasPrefix(path, "/") {
			return nil, fail("invalid-config", "transport", false)
		}
		mode := q.Get("mode")
		if mode == "" {
			mode = "auto"
		}
		if mode != "auto" && mode != "packet-up" && mode != "stream-up" && mode != "stream-one" {
			return nil, fail("unsupported-profile", "transport", false)
		}
		settings := map[string]any{"path": path, "mode": mode}
		if q.Get("host") != "" {
			if !validHost(q.Get("host")) {
				return nil, fail("invalid-config", "transport", false)
			}
			settings["host"] = q.Get("host")
		}
		stream["xhttpSettings"] = settings
	}
	port, _ := strconv.Atoi(u.Port())
	user := map[string]any{"id": u.User.Username(), "encryption": encryption}
	if flow != "" {
		user["flow"] = flow
	}
	config := map[string]any{
		"log":       map[string]string{"loglevel": "warning"},
		"inbounds":  []any{map[string]any{"listen": "127.0.0.1", "port": listenPort, "protocol": "socks", "settings": map[string]any{"auth": "noauth", "udp": false}}},
		"outbounds": []any{map[string]any{"tag": "tunnel", "protocol": "vless", "settings": map[string]any{"vnext": []any{map[string]any{"address": u.Hostname(), "port": port, "users": []any{user}}}}, "streamSettings": stream}},
		"routing":   map[string]any{"domainStrategy": "AsIs"},
	}
	return json.Marshal(config)
}

// Only self-contained client configuration is accepted. No paths, scripts,
// plugins, system routes, management sockets or user-supplied child arguments.
func validateOpenVPN(text string) (string, error) {
	if len(text) == 0 || len(text) > maxProfileBytes || strings.ContainsRune(text, '\x00') {
		return "", fail("invalid-config", "parse", false)
	}
	allowed := map[string]bool{"client": true, "remote": true, "proto": true, "dev": true, "auth-user-pass": true, "resolv-retry": true, "connect-retry": true, "connect-timeout": true, "nobind": true, "persist-key": true, "persist-tun": true, "verb": true, "route-method": true, "remote-cert-tls": true, "verify-x509-name": true, "auth": true, "cipher": true, "data-ciphers": true, "data-ciphers-fallback": true, "key-direction": true, "redirect-gateway": true, "dhcp-option": true, "tun-mtu": true, "mssfix": true, "pull": true, "topology": true, "explicit-exit-notify": true, "tls-client": true, "tls-version-min": true, "reneg-sec": true, "ping": true, "ping-restart": true, "ping-exit": true, "remote-random": true, "remote-random-hostname": true, "float": true, "fast-io": true, "mute-replay-warnings": true, "auth-nocache": true, "setenv": true, "route": true, "route-delay": true, "route-metric": true, "sndbuf": true, "rcvbuf": true, "replay-window": true, "hand-window": true, "tran-window": true, "tcp-nodelay": true, "scramble": true, "tls-timeout": true}
	blocks := map[string]bool{"ca": true, "cert": true, "key": true, "tls-crypt": true, "tls-crypt-v2": true, "tls-auth": true}
	scanner := bufio.NewScanner(strings.NewReader(strings.TrimPrefix(text, "\ufeff")))
	scanner.Buffer(make([]byte, 4096), maxProfileBytes)
	block := ""
	seen := map[string]bool{}
	remote := false
	ca := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if len(line) > 8192 {
			return "", fail("invalid-config", "parse", false)
		}
		if block != "" {
			if line == "</"+block+">" {
				block = ""
			}
			continue
		}
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "<") {
			name := strings.TrimSuffix(strings.TrimPrefix(line, "<"), ">")
			if !blocks[name] || line != "<"+name+">" || seen[name] {
				return "", fail("invalid-config", "parse", false)
			}
			seen[name] = true
			block = name
			if name == "ca" {
				ca = true
			}
			continue
		}
		parts := strings.Fields(line)
		key := parts[0]
		if !allowed[key] {
			return "", fail("unsupported-profile", "config", false)
		}
		switch key {
		case "remote":
			if len(parts) < 2 || len(parts) > 4 || !validHost(parts[1]) {
				return "", fail("invalid-config", "endpoint", false)
			}
			if len(parts) >= 3 {
				n, e := strconv.Atoi(parts[2])
				if e != nil || n < 1 || n > 65535 {
					return "", fail("invalid-config", "endpoint", false)
				}
			}
			remote = true
		case "dev":
			if len(parts) != 2 || parts[1] != "tun" {
				return "", fail("unsupported-profile", "config", false)
			}
		case "proto":
			if len(parts) != 2 || !map[string]bool{"udp": true, "udp4": true, "udp6": true, "tcp": true, "tcp-client": true, "tcp4-client": true, "tcp6-client": true}[parts[1]] {
				return "", fail("unsupported-profile", "transport", false)
			}
		case "auth-user-pass":
			if len(parts) != 1 {
				return "", fail("invalid-config", "auth", false)
			}
		case "cipher", "data-ciphers", "data-ciphers-fallback":
			if len(parts) != 2 {
				return "", fail("invalid-config", "encryption", false)
			}
			for _, cipher := range strings.Split(parts[1], ":") {
				if cipher != "AES-256-GCM" && cipher != "AES-128-GCM" && cipher != "CHACHA20-POLY1305" {
					return "", fail("unsupported-profile", "encryption", false)
				}
			}
		case "setenv":
			if len(parts) != 3 || parts[1] != "CLIENT_CERT" || parts[2] != "0" {
				return "", fail("unsupported-profile", "config", false)
			}
		case "remote-cert-tls":
			if len(parts) != 2 || parts[1] != "server" {
				return "", fail("invalid-config", "tls", false)
			}
		case "route-method":
			if len(parts) != 2 || parts[1] != "exe" && parts[1] != "ipapi" && parts[1] != "adaptive" {
				return "", fail("invalid-config", "config", false)
			}
		}
	}
	if scanner.Err() != nil || block != "" || !remote || !ca {
		return "", fail("invalid-config", "parse", false)
	}
	return strings.TrimPrefix(text, "\ufeff"), nil
}

func endpoint(host string, port int) string {
	return net.JoinHostPort(strings.Trim(host, "[]"), fmt.Sprint(port))
}
func hasOpenVPNDirective(config, name string) bool {
	block := ""
	for _, line := range strings.Split(config, "\n") {
		line = strings.TrimSpace(line)
		if block != "" {
			if line == "</"+block+">" {
				block = ""
			}
			continue
		}
		if strings.HasPrefix(line, "<") && strings.HasSuffix(line, ">") {
			block = strings.TrimSuffix(strings.TrimPrefix(line, "<"), ">")
			continue
		}
		parts := strings.Fields(line)
		if len(parts) > 0 && parts[0] == name {
			return true
		}
	}
	return false
}

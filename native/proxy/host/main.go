// ADR-070: stdio native messaging, authenticated browser caller, no network API.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
)

const frameLimit = 512 * 1024

type diagnostic struct {
	Code      string `json:"code"`
	Phase     string `json:"phase"`
	Retryable bool   `json:"retryable"`
}

func (d *diagnostic) Error() string                 { return d.Code }
func fail(code, phase string, retryable bool) error { return &diagnostic{code, phase, retryable} }
func safeDiagnostic(err error) *diagnostic {
	var d *diagnostic
	if errors.As(err, &d) {
		return d
	}
	return &diagnostic{"operation-failed", "native", false}
}
func classifyNetwork(err error, phase string) error {
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return fail("dns-failed", "dns", true)
	}
	var network net.Error
	if errors.As(err, &network) && network.Timeout() {
		return fail("timeout", phase, true)
	}
	// The Errno(100xx) values are the Winsock codes, which syscall.E* do not match on Windows.
	switch {
	case errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.Errno(10061)): // WSAECONNREFUSED
		return fail("connection-refused", phase, true)
	case errors.Is(err, syscall.ENETUNREACH) || errors.Is(err, syscall.ENETDOWN) || errors.Is(err, syscall.Errno(10051)) || errors.Is(err, syscall.Errno(10050)): // WSAENETUNREACH, WSAENETDOWN
		return fail("network-unreachable", phase, true)
	case errors.Is(err, syscall.EHOSTUNREACH) || errors.Is(err, syscall.EHOSTDOWN) || errors.Is(err, syscall.Errno(10065)) || errors.Is(err, syscall.Errno(10064)): // WSAEHOSTUNREACH, WSAEHOSTDOWN
		return fail("host-unreachable", phase, true)
	}
	return fail("connection-failed", phase, true)
}

type request struct {
	V          int             `json:"v"`
	ID         string          `json:"id"`
	Op         string          `json:"op"`
	ProfileID  string          `json:"profileId,omitempty"`
	ProfileIDs []string        `json:"profileIds,omitempty"`
	Profile    json.RawMessage `json:"profile,omitempty"`
	URL        string          `json:"url,omitempty"`
	Endpoint   *probeEndpoint  `json:"endpoint,omitempty"`
}
type response struct {
	V      int         `json:"v"`
	ID     string      `json:"id"`
	OK     bool        `json:"ok"`
	Result any         `json:"result,omitempty"`
	Error  *diagnostic `json:"error,omitempty"`
}
type host struct {
	base      string
	vaultFile string
	profiles  map[string]profile
	activeID  string
	active    *tunnel
	lastError *diagnostic
	mu        sync.Mutex
}

func nativeFrame(reader io.Reader) ([]byte, error) {
	var head [4]byte
	if _, err := io.ReadFull(reader, head[:]); err != nil {
		return nil, err
	}
	n := binary.LittleEndian.Uint32(head[:])
	if n == 0 || n > frameLimit {
		return nil, fail("invalid-input", "frame", false)
	}
	data := make([]byte, int(n))
	_, err := io.ReadFull(reader, data)
	return data, err
}
func writeFrame(writer io.Writer, value any) error {
	data, err := json.Marshal(value)
	if err != nil || len(data) > frameLimit {
		return fail("operation-failed", "frame", false)
	}
	frame := binary.LittleEndian.AppendUint32(nil, uint32(len(data)))
	frame = append(frame, data...)
	_, err = writer.Write(frame)
	return err
}

// Reject duplicate JSON keys before decoding; otherwise a credential-bearing
// profile could have different meaning to the extension and the native host.
func uniqueJSON(data []byte) bool {
	d := json.NewDecoder(bytes.NewReader(data))
	depth := 0
	var value func() bool
	value = func() bool {
		depth++
		defer func() { depth-- }()
		if depth > 20 {
			return false
		}
		t, e := d.Token()
		if e != nil {
			return false
		}
		delim, ok := t.(json.Delim)
		if !ok {
			return true
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				k, e := d.Token()
				if e != nil {
					return false
				}
				s, ok := k.(string)
				if !ok || seen[s] || s == "__proto__" || s == "constructor" || s == "prototype" {
					return false
				}
				seen[s] = true
				if !value() {
					return false
				}
			}
			t, e = d.Token()
			return e == nil && t == json.Delim('}')
		case '[':
			for d.More() {
				if !value() {
					return false
				}
			}
			t, e = d.Token()
			return e == nil && t == json.Delim(']')
		default:
			return false
		}
	}
	if !value() {
		return false
	}
	_, err := d.Token()
	return err == io.EOF
}
func decodeRequest(data []byte) (request, error) {
	var r request
	if !uniqueJSON(data) {
		return r, fail("invalid-input", "parse", false)
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&r) != nil || r.V != 1 || !idPattern.MatchString(r.ID) {
		return r, fail("invalid-input", "parse", false)
	}
	if r.ProfileID != "" && !idPattern.MatchString(r.ProfileID) {
		return r, fail("invalid-input", "parse", false)
	}
	// Match operation-specific key presence, including empty/null fields. The
	// standard decoder's case-insensitive aliases must not widen the RPC schema.
	allowed := map[string]bool{"v": true, "id": true, "op": true}
	switch r.Op {
	case "save":
		allowed["profileId"], allowed["profile"] = true, true
	case "connect", "delete":
		allowed["profileId"] = true
	case "diagnose":
		allowed["url"], allowed["endpoint"] = true, true
	case "check":
		allowed["profileId"], allowed["url"] = true, true
	case "export":
		allowed["profileIds"] = true
	case "hello", "status", "disconnect":
	default:
		return r, fail("invalid-input", "parse", false)
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return r, fail("invalid-input", "parse", false)
	}
	for field := range fields {
		if !allowed[field] {
			return r, fail("invalid-input", "parse", false)
		}
	}
	switch r.Op {
	case "hello", "status", "disconnect":
		if r.ProfileID != "" || len(r.Profile) != 0 || r.URL != "" || r.Endpoint != nil {
			return r, fail("invalid-input", "parse", false)
		}
	case "save":
		if r.ProfileID == "" || len(r.Profile) == 0 || r.URL != "" || r.Endpoint != nil {
			return r, fail("invalid-input", "parse", false)
		}
	case "connect", "delete":
		if r.ProfileID == "" || len(r.Profile) != 0 || r.URL != "" || r.Endpoint != nil {
			return r, fail("invalid-input", "parse", false)
		}
	case "diagnose":
		if r.ProfileID != "" || len(r.Profile) != 0 {
			return r, fail("invalid-input", "parse", false)
		}
		if _, err := probeURL(r.URL); err != nil {
			return r, err
		}
		if raw, ok := fields["endpoint"]; ok && string(raw) != "null" && !exactEndpointFields(raw) {
			return r, fail("invalid-input", "parse", false)
		}
		if r.Endpoint != nil && !r.Endpoint.valid() {
			return r, fail("invalid-input", "endpoint", false)
		}
	case "check":
		if r.ProfileID == "" {
			return r, fail("invalid-input", "parse", false)
		}
		if _, err := probeURL(r.URL); err != nil {
			return r, err
		}
	case "export":
		if !validExportIDs(r.ProfileIDs) {
			return r, fail("invalid-input", "parse", false)
		}
	default:
		return r, fail("invalid-input", "parse", false)
	}
	return r, nil
}

func newHost(base, vault string) (*host, error) {
	h := &host{base: base, vaultFile: vault, profiles: map[string]profile{}}
	if !vaultAvailable() {
		return h, nil
	}
	data, err := os.ReadFile(vault)
	if errors.Is(err, os.ErrNotExist) {
		return h, nil
	}
	if err != nil || len(data) > 16*1024*1024 {
		return nil, fail("vault-unavailable", "vault", false)
	}
	plain, err := vaultTransform(data, false)
	if err != nil {
		return nil, err
	}
	defer func() {
		for i := range plain {
			plain[i] = 0
		}
	}()
	if !uniqueJSON(plain) {
		return nil, fail("vault-unavailable", "vault", false)
	}
	raw := map[string]json.RawMessage{}
	if json.Unmarshal(plain, &raw) != nil || len(raw) > 128 {
		return nil, fail("vault-unavailable", "vault", false)
	}
	for id, payload := range raw {
		if !idPattern.MatchString(id) {
			return nil, fail("vault-unavailable", "vault", false)
		}
		p, e := decodeProfile(payload)
		if e != nil {
			return nil, fail("vault-unavailable", "vault", false)
		}
		h.profiles[id] = p
	}
	return h, nil
}
func (h *host) saveVault() error {
	if !vaultAvailable() {
		return nil
	}
	plain, err := json.Marshal(h.profiles)
	if err != nil || len(plain) > 8*1024*1024 {
		return fail("vault-unavailable", "vault", false)
	}
	defer func() {
		for i := range plain {
			plain[i] = 0
		}
	}()
	encrypted, err := vaultTransform(plain, true)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(h.vaultFile), 0700); err != nil {
		return fail("vault-unavailable", "vault", false)
	}
	tmp := h.vaultFile + ".tmp"
	if err = os.WriteFile(tmp, encrypted, 0600); err != nil {
		return fail("vault-unavailable", "vault", false)
	}
	if err = os.Rename(tmp, h.vaultFile); err != nil {
		os.Remove(tmp)
		return fail("vault-unavailable", "vault", false)
	}
	return nil
}
func (h *host) capabilities() map[string]bool {
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	exists := func(name string) bool {
		info, e := os.Stat(filepath.Join(h.base, "engines", name+ext))
		return e == nil && !info.IsDir()
	}
	// http and https (CONNECT through an HTTP(S) proxy) are additions; an extension that predates them ignores the extra keys.
	return map[string]bool{"socks5": true, "http": true, "https": true, "vless": exists("xray"), "openvpn": exists("openvpn2socks"), "vault": vaultAvailable()}
}
func (h *host) dispatch(r request) (any, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch r.Op {
	case "hello":
		return map[string]any{"version": 1, "capabilities": h.capabilities()}, nil
	case "save":
		if len(h.profiles) >= 128 {
			if _, ok := h.profiles[r.ProfileID]; !ok {
				return nil, fail("capacity", "vault", false)
			}
		}
		p, err := decodeProfile(r.Profile)
		if err != nil {
			return nil, err
		}
		old, had := h.profiles[r.ProfileID]
		h.profiles[r.ProfileID] = p
		if err = h.saveVault(); err != nil {
			if had {
				h.profiles[r.ProfileID] = old
			} else {
				delete(h.profiles, r.ProfileID)
			}
			return nil, err
		}
		return map[string]any{"profileId": r.ProfileID, "summary": profileSummary(p)}, nil
	case "delete":
		if h.activeID == r.ProfileID {
			return nil, fail("busy", "disconnect", false)
		}
		old, ok := h.profiles[r.ProfileID]
		delete(h.profiles, r.ProfileID)
		if err := h.saveVault(); err != nil {
			if ok {
				h.profiles[r.ProfileID] = old
			}
			return nil, err
		}
		return map[string]bool{"deleted": true}, nil
	case "connect":
		p, ok := h.profiles[r.ProfileID]
		if !ok {
			return nil, fail("profile-not-found", "vault", false)
		}
		// A replacement tunnel is ready before retiring the old one. Browser
		// proxy writes are separately ownership-checked by the extension.
		t, err := startTunnel(h.base, p)
		if err != nil {
			h.lastError = safeDiagnostic(err)
			return nil, err
		}
		old := h.active
		h.active = t
		h.activeID = r.ProfileID
		h.lastError = nil
		if old != nil {
			old.Close()
		}
		return map[string]any{"host": "127.0.0.1", "port": t.port, "profileId": h.activeID}, nil
	case "disconnect":
		if h.active != nil {
			h.active.Close()
		}
		h.active = nil
		h.activeID = ""
		h.lastError = nil
		return map[string]bool{"disconnected": true}, nil
	case "status":
		state := "off"
		var port any = nil
		if h.active != nil {
			state = "connected"
			port = h.active.port
			if !h.active.alive() {
				state = "blocked"
				h.lastError = h.active.diagnostic()
			}
		}
		return map[string]any{"state": state, "profileId": h.activeID, "port": port, "diagnostic": h.lastError, "capabilities": h.capabilities()}, nil
	case "diagnose":
		target := r.Endpoint
		if target == nil {
			if h.active == nil || !h.active.alive() {
				return nil, fail("tunnel-disconnected", "tunnel", true)
			}
			target = &probeEndpoint{Host: "127.0.0.1", Port: h.active.port}
		}
		if p, ok := target.upstream(); ok {
			// An HTTP(S) server named by the caller: dialed directly with the dialer of Check, no profile and no active tunnel.
			return diagnoseUpstream(r.URL, p)
		}
		return diagnoseProxy(r.URL, *target)
	case "check":
		return h.checkProfile(r.ProfileID, r.URL)
	case "export":
		return h.exportProfiles(r.ID, r.ProfileIDs)
	}
	return nil, fail("invalid-input", "parse", false)
}
func (h *host) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.active != nil {
		h.active.Close()
	}
	for id := range h.profiles {
		delete(h.profiles, id)
	}
}

func runHost(in io.Reader, out io.Writer, h *host) error {
	defer h.close()
	for {
		data, err := nativeFrame(in)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		r, err := decodeRequest(data)
		resp := response{V: 1, ID: r.ID, OK: err == nil}
		if err == nil {
			resp.Result, err = h.dispatch(r)
			resp.OK = err == nil
		}
		if err != nil {
			resp.Error = safeDiagnostic(err)
			resp.Result = nil
		}
		for i := range data {
			data[i] = 0
		}
		if err = writeFrame(out, resp); err != nil {
			return err
		}
	}
}

func allowedCaller(base string, args []string) bool {
	return findCaller(base, args) != ""
}
func findCaller(base string, args []string) string {
	data, err := os.ReadFile(filepath.Join(base, "allowed-callers.json"))
	if err != nil || len(data) > 16384 {
		return ""
	}
	var allowed []string
	if json.Unmarshal(data, &allowed) != nil || len(allowed) > 16 {
		return ""
	}
	// Chrome passes its extension origin first. Firefox passes native manifest
	// path followed by the declared extension ID. Match whole strings only.
	for _, arg := range args {
		for _, candidate := range allowed {
			if arg == candidate {
				return candidate
			}
		}
	}
	return ""
}
func main() {
	executable, err := os.Executable()
	if err != nil {
		os.Exit(1)
	}
	base := filepath.Dir(executable)
	caller := findCaller(base, os.Args[1:])
	if caller == "" {
		os.Exit(1)
	}
	config, err := os.UserConfigDir()
	if err != nil {
		os.Exit(1)
	}
	sum := sha256.Sum256([]byte(caller))
	identity := hex.EncodeToString(sum[:])
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	release, err := lockVault(identity)
	if err != nil {
		os.Exit(1)
	}
	defer release()
	h, err := newHost(base, filepath.Join(config, "Detect.Expert", "Proxy", identity+".dpapi"))
	if err != nil {
		os.Exit(1)
	}
	if err = runHost(os.Stdin, os.Stdout, h); err != nil {
		os.Exit(1)
	}
}

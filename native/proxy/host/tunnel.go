package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type diagnosticSink struct {
	mu   sync.Mutex
	code string
}

func (s *diagnosticSink) Write(b []byte) (int, error) {
	// Raw child output may contain usernames, private keys, destinations or
	// server replies. Keep only a known diagnostic class, never the bytes.
	text := strings.ToLower(string(b))
	s.mu.Lock()
	defer s.mu.Unlock()
	failed := false
	for _, token := range []string{"failed", "failure", "error", "timeout", "timed out", "refused", "no records", "unavailable", "missing", "required"} {
		if strings.Contains(text, token) {
			failed = true
			break
		}
	}
	switch {
	case strings.Contains(text, "auth_failed") || strings.Contains(text, "authentication failed") || strings.Contains(text, "auth failed"):
		s.code = "auth-failed"
	case failed && (strings.Contains(text, "certificate") || strings.Contains(text, "x509")):
		s.code = "tls-failed"
	case strings.Contains(text, "reality") && strings.Contains(text, "fail"):
		s.code = "reality-failed"
	case failed && (strings.Contains(text, "resolve") || strings.Contains(text, "dns")):
		s.code = "dns-failed"
	case strings.Contains(text, "refused"):
		s.code = "connection-refused"
	case strings.Contains(text, "timeout") || strings.Contains(text, "timed out"):
		s.code = "timeout"
	case failed && strings.Contains(text, "server identity"):
		s.code = "identity-required"
	}
	return len(b), nil
}
func (s *diagnosticSink) diagnostic() *diagnostic {
	s.mu.Lock()
	defer s.mu.Unlock()
	code := s.code
	if code == "" {
		code = "engine-failed"
	}
	phase := "tunnel"
	if code == "auth-failed" {
		phase = "auth"
	}
	if code == "tls-failed" || code == "reality-failed" {
		phase = "tls"
	}
	if code == "dns-failed" {
		phase = "dns"
	}
	return &diagnostic{code, phase, true}
}

type tunnel struct {
	port       int
	relay      *socksRelay
	cmd        *exec.Cmd
	done       chan struct{}
	dir        string
	sink       *diagnosticSink
	once       sync.Once
	releaseJob func()
}

func (t *tunnel) Close() {
	t.once.Do(func() {
		if t.relay != nil {
			t.relay.Close()
		}
		if t.cmd != nil && t.cmd.Process != nil {
			t.cmd.Process.Kill()
			select {
			case <-t.done:
			case <-time.After(5 * time.Second):
			}
		}
		if t.dir != "" {
			os.RemoveAll(t.dir)
		}
		if t.releaseJob != nil {
			t.releaseJob()
		}
	})
}
func (t *tunnel) alive() bool {
	if t.relay != nil {
		return true
	}
	select {
	case <-t.done:
		return false
	default:
		return true
	}
}
func (t *tunnel) diagnostic() *diagnostic {
	if t.sink != nil {
		return t.sink.diagnostic()
	}
	return &diagnostic{"tunnel-disconnected", "tunnel", true}
}
func reservePort() (int, error) {
	l, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		return 0, fail("proxy-error", "listen", true)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	return port, nil
}

func startTunnel(base string, p profile) (*tunnel, error) {
	return startTunnelContext(context.Background(), base, p)
}

// startTunnelContext is startTunnel with the upstream probe of a SOCKS5 or HTTP(S) profile bounded by ctx. The engines of VLESS
// and OpenVPN have startup times of their own, which ctx does not limit.
func startTunnelContext(ctx context.Context, base string, p profile) (*tunnel, error) {
	if p.Type == "socks5" || p.Type == "http" || p.Type == "https" {
		if err := probeUpstreamContext(ctx, p); err != nil {
			return nil, err
		}
		r, err := startRelay(p)
		if err != nil {
			return nil, err
		}
		return &tunnel{port: r.port(), relay: r}, nil
	}
	name := "xray"
	if p.Type == "openvpn" {
		name = "openvpn2socks"
	}
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	executable := filepath.Join(base, "engines", name)
	if info, e := os.Stat(executable); e != nil || info.IsDir() {
		return nil, fail("engine-missing", "engine", false)
	}
	port, err := reservePort()
	if err != nil {
		return nil, err
	}
	t := &tunnel{port: port, done: make(chan struct{}), sink: &diagnosticSink{}}
	cleanup := true
	defer func() {
		if cleanup {
			t.Close()
		}
	}()
	args := []string{}
	var input []byte
	if p.Type == "vless" {
		config, e := vlessConfig(p.URI, port)
		if e != nil {
			return nil, e
		}
		input = config
		args = []string{"run", "-config", "stdin:", "-format", "json"}
	} else if p.Type == "openvpn" {
		config, e := validateOpenVPN(p.Config)
		if e != nil {
			return nil, e
		}
		input = []byte(config)
		args = []string{"-config", "-", "-listen", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), "-timeout", "30s"}
		// Standard CA-scoped OpenVPN profiles often have an IP remote without
		// an expected certificate name. The engine still validates the supplied
		// inline CA chain and ServerAuth EKU; this never disables TLS validation.
		if !hasOpenVPNDirective(config, "verify-x509-name") {
			args = append(args, "-allow-no-server-identity")
		}
	} else {
		return nil, fail("unsupported-profile", "parse", false)
	}
	t.cmd = exec.Command(executable, args...)
	hideChild(t.cmd)
	t.cmd.Stdin = bytes.NewReader(input)
	t.cmd.Stdout = t.sink
	t.cmd.Stderr = t.sink
	// No parent proxy variables, injected Go settings, engine overrides or
	// inherited credential environment are exposed to the packaged child.
	t.cmd.Env = []string{}
	for _, key := range []string{"SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"} {
		if value := os.Getenv(key); value != "" {
			t.cmd.Env = append(t.cmd.Env, key+"="+value)
		}
	}
	if p.Type == "openvpn" {
		t.cmd.Env = append(t.cmd.Env, "OVPN_USER="+p.Username, "OVPN_PASS="+p.Password)
	}
	if err = t.cmd.Start(); err != nil {
		return nil, fail("engine-failed", "engine", true)
	}
	t.releaseJob, err = attachChild(t.cmd)
	if err != nil {
		t.cmd.Process.Kill()
		t.cmd.Wait()
		close(t.done)
		return nil, err
	}
	go func() { t.cmd.Wait(); close(t.done) }()
	deadline := time.Now().Add(35 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-t.done:
			return nil, t.sink.diagnostic()
		default:
		}
		c, e := net.DialTimeout("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), 100*time.Millisecond)
		if e == nil {
			c.SetDeadline(time.Now().Add(time.Second))
			_, e = c.Write([]byte{5, 1, 0})
			var reply [2]byte
			if e == nil {
				_, e = io.ReadFull(c, reply[:])
			}
			c.Close()
			if e == nil && reply[0] == 5 && reply[1] == 0 {
				cleanup = false
				return t, nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil, fail("timeout", "tunnel", true)
}

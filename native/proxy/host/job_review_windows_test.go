//go:build windows

package main

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestReviewOwnedJobHelper(t *testing.T) {
	if os.Getenv("DETECT_OWNED_JOB_TEST") != "1" {
		return
	}
	base := os.Getenv("DETECT_OWNED_JOB_BASE")
	tunnel, err := startTunnel(base, profile{Type: "vless", URI: "vless://00000000-0000-4000-8000-000000000001@127.0.0.1:9?type=tcp&security=none&encryption=none"})
	if err != nil {
		os.Exit(2)
	}
	fmt.Fprintf(os.Stdout, "port:%d\n", tunnel.port)
	select {}
}

func TestReviewJobClosesRealEngineWhenNativeHostIsKilled(t *testing.T) {
	base, err := filepath.Abs(filepath.Join("..", "..", "..", "release", "proxy-native", "windows-amd64"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(base, "engines", "xray.exe")); err != nil {
		t.Skip("Build pinned Windows engine artifact to run the actual Job Object test")
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestReviewOwnedJobHelper$")
	cmd.Env = append(os.Environ(), "DETECT_OWNED_JOB_TEST=1", "DETECT_OWNED_JOB_BASE="+base)
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
	}()
	line := make(chan string, 1)
	go func() { text, _ := bufio.NewReader(out).ReadString('\n'); line <- text }()
	var text string
	select {
	case text = <-line:
	case <-time.After(10 * time.Second):
		t.Fatal("owned engine did not become ready")
	}
	port, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(text, "port:")))
	if err != nil || port < 1 {
		t.Fatal("owned engine did not report its loopback port")
	}
	endpoint := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	socket, err := net.DialTimeout("tcp", endpoint, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	socket.Close()
	if err = cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	cmd.Wait()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		socket, err = net.DialTimeout("tcp", endpoint, 100*time.Millisecond)
		if err != nil {
			return
		}
		socket.Close()
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("actual Xray listener survived forced native-host death")
}

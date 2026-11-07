package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSummaryOpenVPNUnambiguousValidatedRemote(t *testing.T) {
	const inline = "\n<ca>\nPRIVATE_CA_CANARY\nremote not-a-real-remote.invalid 4444\n</ca>\n<cert>\nPRIVATE_CERT_CANARY\nremote ignored-cert.invalid 5555\n</cert>\n<key>\nPRIVATE_KEY_CANARY\nremote ignored-key.invalid 6666\n</key>\n"
	for _, tc := range []struct {
		name   string
		config string
		host   string
		port   int
	}{
		{"explicit", "client\nremote vpn.example 11294\n" + inline, "vpn.example", 11294},
		{"engine-default", "client\nremote 203.0.113.9\n" + inline, "203.0.113.9", 1194},
		{"ipv6", "client\nremote 2001:db8::5 443 udp6\n" + inline, "2001:db8::5", 443},
		{"bracketed-ipv6", "client\nremote [2001:db8::5] 1195\n" + inline, "2001:db8::5", 1195},
		{"bom-comments", "\ufeff# remote fake-comment.invalid 9000\r\n; remote another-comment.invalid 8000\r\nclient\r\nremote vpn.example 1234\r\n" + inline, "vpn.example", 1234},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := profileSummary(profile{Type: "openvpn", Config: tc.config, Username: "PRIVATE_USER_CANARY", Password: "PRIVATE_PASSWORD_CANARY"})
			if got.Host == nil || *got.Host != tc.host || got.Port == nil || *got.Port != tc.port {
				t.Fatal("summary did not match exactly one validated endpoint")
			}
			encoded, _ := json.Marshal(got)
			if strings.Contains(string(encoded), "PRIVATE_") || strings.Contains(string(encoded), "ignored-") || strings.Contains(string(encoded), "not-a-real-") {
				t.Fatal("summary exposed inline or credential data")
			}
		})
	}
}

func TestSummaryOpenVPNAmbiguousOrInvalidRemoteStaysUnknown(t *testing.T) {
	const ca = "\n<ca>\nPRIVATE_CA_CANARY\n</ca>\n"
	for _, config := range []string{
		"client\nremote a.example 1194\nremote b.example 1194\n" + ca,
		"client\nremote a.example 1194\nremote a.example 1194\n" + ca,
		"client\n<ca>\nremote only-inside-cert.invalid 1194\n</ca>\n",
		"client\nremote invalid/host 1194\n" + ca,
		"client\nremote a.example 65536\n" + ca,
		"client\nremote a.example 1194\nup forbidden-script\n" + ca,
		"client\nremote a.example 1194\n<ca>\nunterminated\n",
	} {
		got := profileSummary(profile{Type: "openvpn", Config: config})
		if got.Host != nil || got.Port != nil {
			t.Fatal("summary guessed endpoint for ambiguous or invalid profile")
		}
	}
}

// ADR-071 / E22-25: explicit per-profile checks and user-requested plaintext export.
package main

import (
	"context"
	"encoding/json"
)

type exportedProfile struct {
	ProfileID string  `json:"profileId"`
	Profile   profile `json:"profile"`
}

type exportResult struct {
	Profiles []exportedProfile `json:"profiles"`
}

func validExportIDs(ids []string) bool {
	if len(ids) == 0 || len(ids) > 100 {
		return false
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if !idPattern.MatchString(id) || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

// Caller holds h.mu. Secret profiles are returned solely for the explicit
// export RPC; ordinary snapshots/status/diagnostics keep their redacted types.
func (h *host) exportProfiles(requestID string, ids []string) (exportResult, error) {
	empty := exportResult{}
	if !validExportIDs(ids) {
		return empty, fail("invalid-input", "parse", false)
	}
	result := exportResult{Profiles: make([]exportedProfile, 0, len(ids))}
	for _, id := range ids {
		p, ok := h.profiles[id]
		if !ok {
			return empty, fail("profile-not-found", "vault", false)
		}
		result.Profiles = append(result.Profiles, exportedProfile{ProfileID: id, Profile: p})
	}
	// Native messaging responses remain bounded. Reject the complete export
	// before runHost writes anything; callers may assemble one-profile chunks
	// in their private Options memory without killing the native port.
	encoded, err := json.Marshal(response{V: 1, ID: requestID, OK: true, Result: result})
	tooLarge := len(encoded) > frameLimit
	for index := range encoded {
		encoded[index] = 0
	}
	if err != nil || tooLarge {
		return empty, fail("capacity", "frame", false)
	}
	return result, nil
}

// Caller holds h.mu, so temporary checks are physically sequential with all
// native operations and cannot replace/close the browser's active tunnel.
func (h *host) checkProfile(id, url string) (probeResult, error) {
	p, ok := h.profiles[id]
	if !ok {
		return probeResult{}, fail("profile-not-found", "vault", false)
	}
	if _, err := probeURL(url); err != nil {
		return probeResult{}, err
	}
	if p.Type == "http" || p.Type == "https" {
		// An HTTP(S) upstream has no session to protect and no engine to start: the check dials it directly, with the dialer the
		// relay uses, whether or not a tunnel is active. The active route and its status are not touched.
		return diagnoseUpstream(url, p)
	}
	if h.active != nil && h.activeID == id {
		if !h.active.alive() {
			return probeResult{}, fail("tunnel-disconnected", "tunnel", true)
		}
		return diagnoseProxy(url, probeEndpoint{Host: "127.0.0.1", Port: h.active.port})
	}
	if h.active != nil && h.active.alive() && p.Type == "openvpn" && h.profiles[h.activeID].Type == "openvpn" {
		// OpenVPN servers without duplicate-cn can retire an existing session
		// when another profile reuses its client identity. Never risk that during
		// a background check of a different saved profile.
		return probeResult{}, fail("active-vpn", "tunnel", false)
	}
	// One budget covers the whole check of a SOCKS5 profile: the probe of its server, the temporary relay, the request and its
	// answer. The engines of VLESS and OpenVPN start in their own time (up to 35 s), which is not charged to it; their request
	// gets a budget of its own.
	ctx, cancel := context.Background(), context.CancelFunc(func() {})
	if p.Type == "socks5" {
		ctx, cancel = context.WithTimeout(ctx, checkBudget.get())
	}
	defer cancel()
	temporary, err := startTunnelContext(ctx, h.base, p)
	if err != nil {
		return probeResult{}, err
	}
	return diagnoseTemporaryTunnelContext(ctx, temporary, url)
}

func diagnoseTemporaryTunnel(temporary *tunnel, url string) (probeResult, error) {
	return diagnoseTemporaryTunnelContext(context.Background(), temporary, url)
}

func diagnoseTemporaryTunnelContext(ctx context.Context, temporary *tunnel, url string) (probeResult, error) {
	defer temporary.Close()
	return diagnoseProxyContext(ctx, url, probeEndpoint{Host: "127.0.0.1", Port: temporary.port})
}

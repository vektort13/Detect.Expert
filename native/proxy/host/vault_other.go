//go:build !windows

package main

// Persistent secrets are disabled until a platform-native keychain is wired.
func vaultAvailable() bool { return false }
func vaultTransform(input []byte, encrypt bool) ([]byte, error) {
	return nil, fail("vault-unavailable", "vault", false)
}

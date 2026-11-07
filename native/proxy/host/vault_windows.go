//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

type dataBlob struct {
	Size uint32
	Data *byte
}

var crypt32 = syscall.NewLazyDLL("crypt32.dll")
var cryptProtectData = crypt32.NewProc("CryptProtectData")
var cryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
var localFree = syscall.NewLazyDLL("kernel32.dll").NewProc("LocalFree")

func vaultAvailable() bool { return true }
func vaultTransform(input []byte, encrypt bool) ([]byte, error) {
	if len(input) == 0 {
		return nil, fail("vault-unavailable", "vault", false)
	}
	in := dataBlob{uint32(len(input)), &input[0]}
	var out dataBlob
	fn := cryptUnprotectData
	if encrypt {
		fn = cryptProtectData
	}
	// CRYPTPROTECT_UI_FORBIDDEN; DPAPI binds to this interactive Windows user.
	r, _, _ := fn.Call(uintptr(unsafe.Pointer(&in)), 0, 0, 0, 0, 1, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		return nil, fail("vault-unavailable", "vault", false)
	}
	defer localFree.Call(uintptr(unsafe.Pointer(out.Data)))
	result := append([]byte(nil), unsafe.Slice(out.Data, int(out.Size))...)
	for i := range unsafe.Slice(out.Data, int(out.Size)) {
		unsafe.Slice(out.Data, int(out.Size))[i] = 0
	}
	return result, nil
}

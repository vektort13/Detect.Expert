//go:build !windows

package main

import "os/exec"

func hideChild(cmd *exec.Cmd)                   {}
func attachChild(cmd *exec.Cmd) (func(), error) { return func() {}, nil }
func lockVault(name string) (func(), error)     { return func() {}, nil }

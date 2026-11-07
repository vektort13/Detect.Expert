//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

func hideChild(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

type jobBasicLimits struct {
	ProcessTime       int64
	JobTime           int64
	Flags             uint32
	MinimumWorkingSet uintptr
	MaximumWorkingSet uintptr
	ActiveProcesses   uint32
	Affinity          uintptr
	Priority          uint32
	Scheduling        uint32
}
type jobIO struct {
	ReadOperations  uint64
	WriteOperations uint64
	OtherOperations uint64
	ReadBytes       uint64
	WriteBytes      uint64
	OtherBytes      uint64
}
type jobLimits struct {
	Basic             jobBasicLimits
	IO                jobIO
	ProcessMemory     uintptr
	JobMemory         uintptr
	PeakProcessMemory uintptr
	PeakJobMemory     uintptr
}

func attachChild(cmd *exec.Cmd) (func(), error) {
	kernel := syscall.NewLazyDLL("kernel32.dll")
	job, _, _ := kernel.NewProc("CreateJobObjectW").Call(0, 0)
	if job == 0 {
		return nil, fail("engine-failed", "engine", false)
	}
	closeJob := func() { syscall.CloseHandle(syscall.Handle(job)) }
	limits := jobLimits{}
	limits.Basic.Flags = 0x2000 // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	ok, _, _ := kernel.NewProc("SetInformationJobObject").Call(job, 9, uintptr(unsafe.Pointer(&limits)), unsafe.Sizeof(limits))
	if ok == 0 {
		closeJob()
		return nil, fail("engine-failed", "engine", false)
	}
	process, err := syscall.OpenProcess(0x0101, false, uint32(cmd.Process.Pid))
	if err != nil {
		closeJob()
		return nil, fail("engine-failed", "engine", false)
	}
	defer syscall.CloseHandle(process)
	ok, _, _ = kernel.NewProc("AssignProcessToJobObject").Call(job, uintptr(process))
	if ok == 0 {
		closeJob()
		return nil, fail("engine-failed", "engine", false)
	}
	return closeJob, nil
}

func lockVault(name string) (func(), error) {
	kernel := syscall.NewLazyDLL("kernel32.dll")
	wide, err := syscall.UTF16PtrFromString("Local\\DetectExpertProxy-" + name)
	if err != nil {
		return nil, fail("vault-unavailable", "vault", false)
	}
	handle, _, _ := kernel.NewProc("CreateMutexW").Call(0, 0, uintptr(unsafe.Pointer(wide)))
	if handle == 0 {
		return nil, fail("vault-unavailable", "vault", false)
	}
	result, _, _ := kernel.NewProc("WaitForSingleObject").Call(handle, 1000)
	if result != 0 && result != 0x80 {
		syscall.CloseHandle(syscall.Handle(handle))
		return nil, fail("busy", "vault", true)
	}
	return func() { kernel.NewProc("ReleaseMutex").Call(handle); syscall.CloseHandle(syscall.Handle(handle)) }, nil
}

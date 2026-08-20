package main

import (
	"context"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/tunnel"
)

func TestDeviceWithTunnelConfiguresRsdBeforeHandshake(t *testing.T) {
	device := ios.DeviceEntry{Properties: ios.DeviceProperties{SerialNumber: "ipad-1"}}
	configured := deviceWithTunnel(device, tunnel.Tunnel{
		Address:          "fd00::1",
		RsdPort:          58783,
		Udid:             "ipad-1",
		UserspaceTUN:     true,
		UserspaceTUNPort: 60105,
	}, "127.0.0.1")
	if !configured.UserspaceTUN {
		t.Fatal("RSD device was not marked for the userspace tunnel")
	}
	if got, want := configured.UserspaceTUNHost, "127.0.0.1"; got != want {
		t.Fatalf("userspace tunnel host = %q, want %q", got, want)
	}
	if got, want := configured.UserspaceTUNPort, 60105; got != want {
		t.Fatalf("userspace tunnel port = %d, want %d", got, want)
	}
}

func TestCloseOnceIsSafeAcrossConcurrentShutdownPaths(t *testing.T) {
	var instrumentsClosed atomic.Int32
	var outputClosed atomic.Int32
	close := closeOnce(
		func() { instrumentsClosed.Add(1) },
		func() { outputClosed.Add(1) },
	)
	var callers sync.WaitGroup
	for index := 0; index < 100; index++ {
		callers.Add(1)
		go func() {
			defer callers.Done()
			close()
		}()
	}
	callers.Wait()
	if got := instrumentsClosed.Load(); got != 1 {
		t.Fatalf("Instruments close calls = %d, want 1", got)
	}
	if got := outputClosed.Load(); got != 1 {
		t.Fatalf("stdout close calls = %d, want 1", got)
	}
}

func TestLatestFrameRetainsOnlyNewestImage(t *testing.T) {
	slot := newLatestFrame()
	for index := 0; index < 10_000; index++ {
		slot.offer([]byte{byte(index >> 8), byte(index)})
	}
	frame, version, err := slot.next(context.Background(), 0)
	if err != nil {
		t.Fatalf("next: %v", err)
	}
	if version != 10_000 {
		t.Fatalf("version = %d, want 10000", version)
	}
	if got, want := string(frame), string([]byte{0x27, 0x0f}); got != want {
		t.Fatalf("frame = %x, want %x", frame, []byte{0x27, 0x0f})
	}
}

func TestLatestFrameOffersDoNotBlockBehindStalledWriter(t *testing.T) {
	slot := newLatestFrame()
	before := runtime.NumGoroutine()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for index := 0; index < 100_000; index++ {
			slot.offer([]byte{byte(index)})
		}
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("offers blocked while no writer consumed the slot")
	}
	if after := runtime.NumGoroutine(); after > before+2 {
		t.Fatalf("goroutines grew from %d to %d while writer stalled", before, after)
	}
}

func TestLatestFrameConcurrentCancellationCannotPanic(t *testing.T) {
	slot := newLatestFrame()
	var writers sync.WaitGroup
	for writer := 0; writer < 8; writer++ {
		writers.Add(1)
		go func(value byte) {
			defer writers.Done()
			for index := 0; index < 1_000; index++ {
				slot.offer([]byte{value, byte(index)})
			}
		}(byte(writer))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := slot.next(ctx, 1<<63); err == nil {
		t.Fatal("next succeeded after cancellation")
	}
	writers.Wait()
}

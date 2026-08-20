package main

import (
	"context"
	"sync"
)

// latestFrame is a one-slot handoff between Instruments capture and Relay's
// local pipe. It intentionally never closes its notification channel: a
// capture finishing while the consumer disconnects must be harmless.
//
// A blocked writer can retain only the most recent JPEG. It cannot create a
// goroutine per frame or retain an unbounded queue of stale images.
type latestFrame struct {
	mu      sync.Mutex
	jpeg    []byte
	version uint64
	wake    chan struct{}
}

func newLatestFrame() *latestFrame {
	return &latestFrame{wake: make(chan struct{}, 1)}
}

func (slot *latestFrame) offer(jpeg []byte) {
	// The encoder normally returns a fresh buffer. Copy it anyway so this
	// bounded handoff remains correct if a future encoder reuses its input.
	frame := append([]byte(nil), jpeg...)
	slot.mu.Lock()
	slot.jpeg = frame
	slot.version++
	slot.mu.Unlock()

	// One notification is enough: a receiver always reads the newest version.
	select {
	case slot.wake <- struct{}{}:
	default:
	}
}

func (slot *latestFrame) next(ctx context.Context, after uint64) ([]byte, uint64, error) {
	for {
		slot.mu.Lock()
		if slot.version > after {
			jpeg, version := slot.jpeg, slot.version
			slot.mu.Unlock()
			return jpeg, version, nil
		}
		slot.mu.Unlock()

		select {
		case <-ctx.Done():
			return nil, after, ctx.Err()
		case <-slot.wake:
		}
	}
}

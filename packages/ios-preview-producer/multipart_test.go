package main

import (
	"bytes"
	"context"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

type notifyingBuffer struct {
	mu    sync.Mutex
	bytes bytes.Buffer
	first chan struct{}
	once  sync.Once
}

func newNotifyingBuffer() *notifyingBuffer {
	return &notifyingBuffer{first: make(chan struct{})}
}

func (buffer *notifyingBuffer) Write(data []byte) (int, error) {
	buffer.mu.Lock()
	n, err := buffer.bytes.Write(data)
	buffer.mu.Unlock()
	buffer.once.Do(func() { close(buffer.first) })
	return n, err
}

func (buffer *notifyingBuffer) Bytes() []byte {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return append([]byte(nil), buffer.bytes.Bytes()...)
}

func TestWriteMjpegFrameUsesBoundedRelayMultipartShape(t *testing.T) {
	var output bytes.Buffer
	jpeg := []byte{0xff, 0xd8, 0xff, 0xd9}
	if err := writeMjpegFrame(&output, jpeg); err != nil {
		t.Fatalf("write frame: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, relayMjpegBoundary) || !strings.Contains(text, "Content-Length: 4") {
		t.Fatalf("unexpected multipart header: %q", text)
	}
	if !bytes.Contains(output.Bytes(), jpeg) {
		t.Fatalf("multipart output did not retain jpeg: %x", output.Bytes())
	}
}

func TestWriteLatestFramesStopsWithContextWithoutClosingProducerSignal(t *testing.T) {
	slot := newLatestFrame()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := writeLatestFrames(ctx, &bytes.Buffer{}, slot); err == nil {
		t.Fatal("writeLatestFrames succeeded after cancellation")
	}
	// The source may still publish after a disconnected parent. This is the
	// exact case that used to race a close(c) in go-ios.
	slot.offer([]byte{0xff, 0xd8, 0xff, 0xd9})
}

func TestStalledParentPipeStaysBoundedAndCanReconnect(t *testing.T) {
	slot := newLatestFrame()
	reader, writer := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	writerDone := make(chan error, 1)
	go func() { writerDone <- writeLatestFrames(ctx, writer, slot) }()

	// No one reads the parent pipe. The writer blocks on one frame, while
	// capture may still replace the one retained slot thousands of times.
	slot.offer([]byte{0xff, 0xd8, 0x00, 0xd9})
	for index := 0; index < 10_000; index++ {
		slot.offer([]byte{0xff, 0xd8, byte(index), 0xd9})
	}
	if err := reader.Close(); err != nil {
		t.Fatalf("close stalled reader: %v", err)
	}
	select {
	case err := <-writerDone:
		if err == nil {
			t.Fatal("writer unexpectedly completed a closed parent pipe")
		}
	case <-time.After(time.Second):
		t.Fatal("writer did not stop after parent pipe closed")
	}

	// A later Relay source is a fresh consumer of the same bounded handoff;
	// there is no closed notification channel to race against a new frame.
	slot.offer([]byte{0xff, 0xd8, 0x7f, 0xd9})
	reconnected := newNotifyingBuffer()
	secondContext, secondCancel := context.WithCancel(context.Background())
	secondDone := make(chan error, 1)
	go func() { secondDone <- writeLatestFrames(secondContext, reconnected, slot) }()
	deadline := time.Now().Add(time.Second)
	select {
	case <-reconnected.first:
	case <-time.After(time.Until(deadline)):
		t.Fatal("reconnected writer did not receive a frame")
	}
	secondCancel()
	select {
	case <-secondDone:
	case <-time.After(time.Second):
		t.Fatal("reconnected writer did not honor cancellation")
	}
	if received := reconnected.Bytes(); !bytes.Contains(received, []byte{0xff, 0xd8, 0x7f, 0xd9}) {
		t.Fatalf("reconnected pipe did not receive current frame: %x", received)
	}
}

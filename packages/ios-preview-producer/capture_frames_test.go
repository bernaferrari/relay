package main

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"testing"
	"time"
)

// scriptedScreenshotService replays a fixed error/ok sequence; the last entry
// repeats forever.
type scriptedScreenshotService struct {
	script []error
	calls  int
}

func (service *scriptedScreenshotService) TakeScreenshot() ([]byte, error) {
	index := service.calls
	if index >= len(service.script) {
		index = len(service.script) - 1
	}
	service.calls++
	err := service.script[index]
	if err != nil {
		return nil, err
	}
	return minimalPng(), nil
}

func success() error { return nil }

func failure() error { return errors.New("transient transport failure") }

// minimalPng returns a real 1×1 image so pngToJPEG can decode it.
func minimalPng() []byte {
	var buffer bytes.Buffer
	image := image.NewRGBA(image.Rect(0, 0, 1, 1))
	image.Set(0, 0, color.White)
	if err := png.Encode(&buffer, image); err != nil {
		panic(err)
	}
	return buffer.Bytes()
}

func TestCaptureFramesSurvivesTransientFailuresThenExitsOnConsecutiveLimit(t *testing.T) {
	slot := newLatestFrame()
	service := &scriptedScreenshotService{
		script: []error{failure(), failure(), success(), failure(), failure(), failure()},
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- captureFrames(ctx, service, slot, 80) }()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("captureFrames returned nil, want the consecutive-failure error")
		}
		if service.calls != 6 {
			t.Fatalf("TakeScreenshot calls = %d, want 6 (2 recovered + 1 frame + 3 fatal)", service.calls)
		}
	case <-time.After(5 * time.Second):
		cancel()
		t.Fatal("captureFrames did not exit after the consecutive-failure limit")
	}
}

func TestCaptureFramesExitsAfterFailuresFromTheFirstFrame(t *testing.T) {
	slot := newLatestFrame()
	service := &scriptedScreenshotService{script: []error{failure()}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- captureFrames(ctx, service, slot, 80) }()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("captureFrames returned nil, want the consecutive-failure error")
		}
		if service.calls != maxConsecutiveCaptureFailures {
			t.Fatalf(
				"TakeScreenshot calls = %d, want exactly %d before giving up",
				service.calls,
				maxConsecutiveCaptureFailures,
			)
		}
	case <-time.After(5 * time.Second):
		cancel()
		t.Fatal("captureFrames did not exit after the consecutive-failure limit")
	}
}

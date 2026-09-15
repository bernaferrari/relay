package main

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestPixelToHidScalesScreenshotPixels(t *testing.T) {
	if got := pixelToHid(0, 2224); got != 0 {
		t.Fatalf("left edge: got %d", got)
	}
	if got := pixelToHid(2224, 2224); got != 65535 {
		t.Fatalf("right edge: got %d", got)
	}
	if got := pixelToHid(1112, 2224); got != 32768 {
		t.Fatalf("center x: got %d", got)
	}
	if got := pixelToHid(1010, 1668); got != 39682 {
		t.Fatalf("bernardo pill y: got %d", got)
	}
}

func TestTouchscreenReportLayout(t *testing.T) {
	report := buildTouchscreenReport(touchscreenStateContact, 32768, 39685, 0x010203040506)
	if len(report) != 58 {
		t.Fatalf("len=%d", len(report))
	}
	if report[0] != 0x09 || report[1] != 0x01 || report[2] != 0x05 || report[3] != 0xC2 {
		t.Fatalf("header %+v", report[:4])
	}
	if binary.LittleEndian.Uint16(report[4:6]) != 32768 {
		t.Fatalf("x=%d", binary.LittleEndian.Uint16(report[4:6]))
	}
	if binary.LittleEndian.Uint16(report[6:8]) != 39685 {
		t.Fatalf("y=%d", binary.LittleEndian.Uint16(report[6:8]))
	}
	if !bytes.Equal(report[8:40], make([]byte, 32)) {
		t.Fatal("expected 32 zero bytes after coordinates")
	}
	if report[40] != 0x02 || report[41] != 0 || report[42] != 0 || report[43] != 0 {
		t.Fatalf("marker %+v", report[40:44])
	}
	if !bytes.Equal(report[44:50], []byte{0x06, 0x05, 0x04, 0x03, 0x02, 0x01}) {
		t.Fatalf("timestamp %+v", report[44:50])
	}
	release := buildTouchscreenReport(touchscreenStateRelease, 32768, 39685, 1)
	if release[3] != 0x02 {
		t.Fatalf("release state %x", release[3])
	}
}

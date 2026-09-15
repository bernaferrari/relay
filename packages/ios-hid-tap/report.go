package main

import (
	"encoding/binary"
	"math"
	"time"
)

const (
	touchscreenReportID            = 0x09
	touchscreenStateContact        = 0xC2
	touchscreenStateRelease        = 0x02
	touchscreenReportLength        = 58
	mainTouchscreenServiceID       = 257
	hidNormalizedMax         int64 = 65535
)

// pixelToHid maps a screenshot pixel into the UInt16 0..65535 space dtuhidd
// expects. Screenshot pixels are not HID units.
func pixelToHid(px, dim int) uint16 {
	if dim <= 0 {
		return 0
	}
	scaled := int64(math.Round(float64(px) * float64(hidNormalizedMax) / float64(dim)))
	if scaled < 0 {
		return 0
	}
	if scaled > hidNormalizedMax {
		return uint16(hidNormalizedMax)
	}
	return uint16(scaled)
}

// buildTouchscreenReport encodes one 58-byte mainTouchscreen HID report
// (report ID 0x09). Layout matches a sniffed Universal Control session.
func buildTouchscreenReport(state byte, x, y uint16, timestamp uint64) []byte {
	report := make([]byte, touchscreenReportLength)
	report[0] = touchscreenReportID
	report[1] = 0x01
	report[2] = 0x05
	report[3] = state
	binary.LittleEndian.PutUint16(report[4:6], x)
	binary.LittleEndian.PutUint16(report[6:8], y)
	// bytes 8..39 stay zero
	report[40] = 0x02
	ts := timestamp & ((1 << 48) - 1)
	for i := 0; i < 6; i++ {
		report[44+i] = byte(ts >> (8 * i))
	}
	return report
}

func monotonicTimestamp() uint64 {
	return uint64(time.Now().UnixNano()) & ((1 << 48) - 1)
}

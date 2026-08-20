package main

import (
	"context"
	"fmt"
	"io"
)

const relayMjpegBoundary = "--RelayFrame"

// writeMjpegFrame is deliberately a synchronous single-consumer writer. The
// parent is Relay, not an HTTP fanout; stdout backpressure therefore stalls
// this writer only, while latestFrame continues to replace stale frames.
func writeMjpegFrame(writer io.Writer, jpeg []byte) error {
	if _, err := fmt.Fprintf(
		writer,
		"%s\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n",
		relayMjpegBoundary,
		len(jpeg),
	); err != nil {
		return err
	}
	if _, err := writer.Write(jpeg); err != nil {
		return err
	}
	_, err := io.WriteString(writer, "\r\n")
	return err
}

func writeLatestFrames(ctx context.Context, writer io.Writer, slot *latestFrame) error {
	var seen uint64
	for {
		jpeg, version, err := slot.next(ctx, seen)
		if err != nil {
			return err
		}
		seen = version
		if err := writeMjpegFrame(writer, jpeg); err != nil {
			return err
		}
	}
}

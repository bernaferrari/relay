package main

import (
	"fmt"
	"time"

	"github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/xpc"
)

const (
	universalHIDServiceName = "com.apple.coredevice.hid.universalhidservice"
	universalHIDFeature     = "com.apple.coredevice.feature.remote.universalhidservice"
	tapHold                 = 80 * time.Millisecond
)

type hidConn interface {
	Send(data map[string]interface{}, flags ...uint32) error
	Close() error
}

func connectUniversalHID(device ios.DeviceEntry) (hidConn, error) {
	conn, err := ios.ConnectToXpcServiceTunnelIface(device, universalHIDServiceName)
	if err != nil {
		return nil, fmt.Errorf(
			"connect CoreDevice Universal HID: %w (this DDI/RSD has no dtuhidd surface — iOS 17.7 images typically omit it; do not retry an XCTest tap)",
			err,
		)
	}
	return conn, nil
}

func sendTouchscreenReport(conn hidConn, report []byte) error {
	msg := map[string]interface{}{
		"featureIdentifier": universalHIDFeature,
		"messageType":       "Request",
		"payload": map[string]interface{}{
			"send": map[string]interface{}{
				"_0": report,
				"_1": uint64(mainTouchscreenServiceID),
			},
		},
	}
	if err := conn.Send(msg, xpc.HeartbeatRequestFlag); err != nil {
		return fmt.Errorf("send HID report: %w", err)
	}
	return nil
}

func tapTouchscreen(conn hidConn, hidX, hidY uint16) error {
	ts := monotonicTimestamp()
	if err := sendTouchscreenReport(conn, buildTouchscreenReport(touchscreenStateContact, hidX, hidY, ts)); err != nil {
		return err
	}
	time.Sleep(tapHold)
	if err := sendTouchscreenReport(conn, buildTouchscreenReport(touchscreenStateRelease, hidX, hidY, monotonicTimestamp())); err != nil {
		return err
	}
	return nil
}

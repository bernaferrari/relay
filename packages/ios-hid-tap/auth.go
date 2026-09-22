package main

import (
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/xpc"
)

const displayServiceName = "com.apple.coredevice.displayservice"

// hidNotDispatched is the pre-dispatch refusal. Callers match
// "universalhidservice" and may press through XCTest. The touch report
// has not been sent.
const hidNotDispatched = "universalhidservice touch was not dispatched"

const hidNotAuthenticated = hidNotDispatched +
	": no CoreDevice media stream is authenticating the digitizer, so backboardd drops the report. Remote control requires iOS 27"

func requireAuthenticatedHidSurface(device ios.DeviceEntry) error {
	response, err := queryMediaStreamStatus(device)
	return authenticateFromStatus(response, err)
}

func authenticateFromStatus(response map[string]interface{}, queryErr error) error {
	if queryErr != nil {
		return fmt.Errorf("%s: %w", hidNotDispatched, queryErr)
	}
	running, err := mediaStreamRunning(response)
	if err != nil {
		return fmt.Errorf("%s: %w", hidNotDispatched, err)
	}
	if !running {
		return errors.New(hidNotAuthenticated)
	}
	return nil
}

func mediaStreamRunning(response map[string]interface{}) (bool, error) {
	if _, ok := response["CoreDevice.error"]; ok {
		return false, errors.New("media stream status returned CoreDevice.error")
	}
	output, ok := response["CoreDevice.output"].(map[string]interface{})
	if !ok {
		return false, errors.New("media stream status returned no CoreDevice.output")
	}
	running, ok := output["running"].(bool)
	if !ok {
		return false, errors.New("media stream status is missing the running flag")
	}
	return running, nil
}

func queryMediaStreamStatus(device ios.DeviceEntry) (map[string]interface{}, error) {
	conn, err := ios.ConnectToXpcServiceTunnelIface(device, displayServiceName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	request := map[string]interface{}{
		"CoreDevice.CoreDeviceDDIProtocolVersion": int64(2),
		"CoreDevice.action":                       map[string]interface{}{},
		"CoreDevice.actionIdentifier":             "com.apple.coredevice.action.mediastreamstatus",
		"CoreDevice.coreDeviceVersion": map[string]interface{}{
			"components":              []interface{}{uint64(629), uint64(3)},
			"originalComponentsCount": int64(2),
			"stringValue":             "629.3",
		},
		"CoreDevice.deviceIdentifier":     newInvocationID(),
		"CoreDevice.featureIdentifier":    "com.apple.coredevice.feature.getmediastreamserverstatus",
		"CoreDevice.input":                map[string]interface{}{},
		"CoreDevice.invocationIdentifier": newInvocationID(),
	}
	if err := conn.Send(request, xpc.HeartbeatRequestFlag); err != nil {
		return nil, err
	}
	type result struct {
		msg map[string]interface{}
		err error
	}
	ch := make(chan result, 1)
	go func() {
		msg, err := conn.ReceiveOnServerClientStream()
		ch <- result{msg, err}
	}()
	select {
	case res := <-ch:
		return res.msg, res.err
	case <-time.After(8 * time.Second):
		return nil, errors.New("media stream status timed out")
	}
}

func newInvocationID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "00000000-0000-4000-8000-000000000000"
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

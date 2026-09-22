package main

import (
	"strings"
	"testing"
)

func TestUnauthenticatedMediaStreamRefusesBeforeSend(t *testing.T) {
	err := authenticateFromStatus(map[string]interface{}{
		"CoreDevice.output": map[string]interface{}{
			"running":  false,
			"sessions": []interface{}{},
		},
	}, nil)
	if err == nil {
		t.Fatal("expected refusal")
	}
	if !strings.Contains(err.Error(), "universalhidservice touch was not dispatched") {
		t.Fatalf("refusal must be a pre-dispatch miss: %v", err)
	}
	if !strings.Contains(err.Error(), "iOS 27") {
		t.Fatalf("refusal should name the OS gate: %v", err)
	}
}

func TestAuthenticatedMediaStreamAllowsSend(t *testing.T) {
	err := authenticateFromStatus(map[string]interface{}{
		"CoreDevice.output": map[string]interface{}{"running": true},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
}

func TestMediaStreamQueryFailureIsPreDispatch(t *testing.T) {
	err := authenticateFromStatus(nil, errString("service 'com.apple.coredevice.displayservice' is not available in RSD"))
	if err == nil || !strings.Contains(err.Error(), hidNotDispatched) {
		t.Fatalf("query failure must stay pre-dispatch: %v", err)
	}
}

func TestMediaStreamRunningRejectsMalformedStatus(t *testing.T) {
	if _, err := mediaStreamRunning(map[string]interface{}{}); err == nil {
		t.Fatal("expected missing output to fail")
	}
	if _, err := mediaStreamRunning(map[string]interface{}{
		"CoreDevice.error": map[string]interface{}{"code": int64(9021)},
	}); err == nil {
		t.Fatal("expected CoreDevice.error to fail")
	}
}

type errString string

func (e errString) Error() string { return string(e) }

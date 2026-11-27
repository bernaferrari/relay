import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inspectLabMacLaunchd,
  LAB_MAC_LAUNCHD_LABEL,
  LAB_MAC_SERVER_NOT_LOADED,
} from "./lab-mac-server.js";

const missing = `Bad request.
Could not find service "${LAB_MAC_LAUNCHD_LABEL}" in domain for user gui: 501`;

const running = `gui/501/${LAB_MAC_LAUNCHD_LABEL} = {
	active count = 1
	path = /Users/qa/Library/LaunchAgents/${LAB_MAC_LAUNCHD_LABEL}.plist
	type = LaunchAgent
	state = running
	program = /usr/bin/env
}`;

const sidecarRunning = `gui/501/com.apple.sidecar-relay = {
	state = running
	program = /usr/libexec/SidecarRelay
}`;

test("missing lab-server launchd stays needs-attention", () => {
  const status = inspectLabMacLaunchd(missing);
  assert.equal(status.status, "needs-attention");
  assert.equal(status.loaded, false);
  assert.equal(status.detail, LAB_MAC_SERVER_NOT_LOADED);
  assert.match(status.detail, /Lab Mac launchd stays unloaded/u);
  assert.equal(inspectLabMacLaunchd(null).loaded, false);
  assert.equal(inspectLabMacLaunchd("").loaded, false);
});

test("a running sidecar LaunchAgent is not the lab-server job", () => {
  const status = inspectLabMacLaunchd(sidecarRunning);
  assert.equal(status.status, "needs-attention");
  assert.equal(status.loaded, false);
});

test("ready only when print names this job and state is running", () => {
  const status = inspectLabMacLaunchd(running);
  assert.equal(status.status, "ready");
  assert.equal(status.loaded, true);
  assert.match(status.detail, /dev\.relay\.lab-server is running/u);
});

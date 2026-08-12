import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  diagnoseIosRunnerError,
  IosDeviceAttentionError,
  IosDeveloperDiskImageError,
  iosRecordingOptions,
  IosRunnerSetupError,
  IosXCTestSessionUnavailableError,
  normalizeIosRunnerError,
  parseIosDeviceLockState,
} from "./ios-device-adapter.js";

test("maps signing failures to the Relay iOS setup action", () => {
  const error = normalizeIosRunnerError(
    new Error("xcodebuild build-for-testing failed: Provisioning profile is required"),
  );
  assert.ok(error instanceof IosRunnerSetupError);
  assert.match(error.message, /could not sign its local iPad runner/);
});

test("maps disabled Developer Mode to the Relay iOS setup action", () => {
  const error = normalizeIosRunnerError(new Error("Developer Mode is not enabled on this iPad"));
  assert.ok(error instanceof IosRunnerSetupError);
  assert.match(error.message, /Turn on Developer Mode/);
});

test("preserves a CoreDevice developer disk image mount failure as a typed action", () => {
  const error = normalizeIosRunnerError(
    new Error(
      "CoreDeviceError Code=12040: kAMDMobileImageMounterMissingImagePath: The developer disk image could not be mounted",
    ),
  );
  assert.ok(error instanceof IosDeveloperDiskImageError);
  assert.match(error.message, /developer support image/i);
  assert.match(error.message, /CoreDevice 12040/);
  assert.match(error.message, /press Reconnect/i);
});

test("explains automatic and manual signing conflicts directly", () => {
  const error = normalizeIosRunnerError(
    new Error(
      "AgentDeviceRunner is automatically signed, but code signing identity has been manually specified",
    ),
  );
  assert.ok(error instanceof IosRunnerSetupError);
  assert.match(error.message, /AGENT_DEVICE_IOS_SIGNING_IDENTITY/);
  assert.match(error.message, /daemon/);
});

test("explains when Xcode has no account for the configured Apple team", () => {
  const error = normalizeIosRunnerError(
    new Error('No Account for Team "ABCDE12345". Add a new account in Accounts settings.'),
  );
  assert.ok(error instanceof IosRunnerSetupError);
  assert.match(error.message, /Xcode is not signed in to this Apple team/);
});

test("reads signing diagnostics from the selected iPad session", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-ios-runner-log-"));
  const previousStateDir = process.env.AGENT_DEVICE_STATE_DIR;
  const udid = "device:with/unsafe characters";
  try {
    process.env.AGENT_DEVICE_STATE_DIR = root;
    const session = join(root, "sessions", "relay-ios-device-with-unsafe-characters");
    await mkdir(session, { recursive: true });
    await writeFile(
      join(session, "runner.log"),
      'error: No Account for Team "ABCDE12345". Add a new account in Accounts settings.\n',
      "utf8",
    );

    const error = await diagnoseIosRunnerError(new Error("xcodebuild failed"), udid);
    assert.ok(error instanceof IosRunnerSetupError);
    assert.match(error.message, /Xcode is not signed in to this Apple team/);
  } finally {
    if (previousStateDir === undefined) delete process.env.AGENT_DEVICE_STATE_DIR;
    else process.env.AGENT_DEVICE_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("does not relabel an app-session failure from an older signing log", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-ios-runtime-log-"));
  const previousStateDir = process.env.AGENT_DEVICE_STATE_DIR;
  const udid = "ipad-runtime";
  try {
    process.env.AGENT_DEVICE_STATE_DIR = root;
    const session = join(root, "sessions", "relay-ios-ipad-runtime");
    await mkdir(session, { recursive: true });
    await writeFile(
      join(session, "runner.log"),
      'old error: No Account for Team "ABCDE12345".\nCommand line invocation:\nnew runner command completed ok=1\n',
      "utf8",
    );

    const original = new Error("iOS snapshot requires an active app session");
    assert.equal(await diagnoseIosRunnerError(original, udid), original);
  } finally {
    if (previousStateDir === undefined) delete process.env.AGENT_DEVICE_STATE_DIR;
    else process.env.AGENT_DEVICE_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers the DDI cause when a later snapshot only reports no active XCTest session", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-ios-ddi-log-"));
  const previousStateDir = process.env.AGENT_DEVICE_STATE_DIR;
  const udid = "ipad-ddi";
  try {
    process.env.AGENT_DEVICE_STATE_DIR = root;
    const session = join(root, "sessions", "relay-ios-ipad-ddi");
    await mkdir(session, { recursive: true });
    await writeFile(
      join(session, "runner.log"),
      [
        "Command line invocation:",
        "operation_errorDomain = com.apple.dt.CoreDeviceError.12040.com.apple.dt.CoreDeviceError;",
        "kAMDMobileImageMounterMissingImagePath: Could not support development.",
        "Testing failed: The developer disk image could not be mounted on this device.",
      ].join("\n"),
      "utf8",
    );

    const error = await diagnoseIosRunnerError(
      new Error("iOS snapshot needs an active XCTest session"),
      udid,
    );
    assert.ok(error instanceof IosDeveloperDiskImageError);
    assert.match(error.message, /developer support image/i);
    assert.match(error.message, /CoreDevice 12040/);
  } finally {
    if (previousStateDir === undefined) delete process.env.AGENT_DEVICE_STATE_DIR;
    else process.env.AGENT_DEVICE_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("makes an otherwise unexplained XCTest-session failure actionable", async () => {
  const error = await diagnoseIosRunnerError(
    new Error("iOS snapshot needs an active XCTest session"),
  );
  assert.ok(error instanceof IosXCTestSessionUnavailableError);
  assert.match(error.message, /Press Reconnect/i);
  assert.match(error.message, /unlocked/i);
});

test("upgrades an already-normalized XCTest error when the fresh runner log shows DDI", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-ios-normalized-ddi-log-"));
  const previousStateDir = process.env.AGENT_DEVICE_STATE_DIR;
  const udid = "ipad-normalized-ddi";
  try {
    process.env.AGENT_DEVICE_STATE_DIR = root;
    const session = join(root, "sessions", "relay-ios-ipad-normalized-ddi");
    await mkdir(session, { recursive: true });
    await writeFile(
      join(session, "runner.log"),
      [
        "Command line invocation:",
        "CoreDeviceError Code=12040",
        "Testing failed: The developer disk image could not be mounted on this device.",
      ].join("\n"),
      "utf8",
    );

    const error = await diagnoseIosRunnerError(new IosXCTestSessionUnavailableError("sdk"), udid);
    assert.ok(error instanceof IosDeveloperDiskImageError);
    assert.match(error.message, /developer support image/i);
  } finally {
    if (previousStateDir === undefined) delete process.env.AGENT_DEVICE_STATE_DIR;
    else process.env.AGENT_DEVICE_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps regular runner failures intact", () => {
  const original = new Error("The iPad was unplugged");
  assert.equal(normalizeIosRunnerError(original), original);
});

test("maps an interrupted physical-device automation session to an unlock action", () => {
  const error = normalizeIosRunnerError(new Error("artifact restored but runner did not connect"));
  assert.ok(error instanceof IosDeviceAttentionError);
  assert.match(error.message, /reconnect its cable/i);
  assert.doesNotMatch(error.message, /sign|setup/i);
});

test("parses CoreDevice lock state without guessing from unrelated fields", () => {
  assert.deepEqual(parseIosDeviceLockState({ result: { passcodeRequired: true } }), {
    locked: true,
  });
  assert.deepEqual(parseIosDeviceLockState({ result: { passcodeRequired: false } }), {
    locked: false,
  });
  assert.equal(parseIosDeviceLockState({ result: { unlockedSinceBoot: true } }), undefined);
});

test("records a physical iPad with one canonical target selector", () => {
  const options = iosRecordingOptions({
    udid: "ipad-udid",
    action: "start",
    path: "/tmp/take.mp4",
  }) as Record<string, unknown>;

  assert.equal(options.platform, "ios");
  assert.equal(options.udid, "ipad-udid");
  assert.equal(options.device, undefined);
  assert.equal(options.action, "start");
  assert.equal(options.path, "/tmp/take.mp4");
});

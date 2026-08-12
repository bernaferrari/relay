import assert from "node:assert/strict";
import test from "node:test";
import { liveInspectionHint, resolveDevicePanelState } from "./stage-presentation";

test("live inspection stays quiet when names are available", () => {
  assert.equal(liveInspectionHint({ inspectable: true, nodeCount: 12 }), null);
  assert.equal(liveInspectionHint({}), null);
});

test("live inspection tells a person to unlock, wake, or reconnect", () => {
  assert.deepEqual(liveInspectionHint({ inspectable: false, inspectionState: "asleep" }), {
    title: "Screen is off",
    detail: "Relay will wake it and try to read names again.",
    actionLabel: "Wake",
  });
  assert.deepEqual(liveInspectionHint({ inspectable: false, inspectionState: "keyguard" }), {
    title: "Unlock the phone",
    detail: "Names appear after you unlock. The picture still works.",
    actionLabel: "Try again",
  });
  assert.equal(
    liveInspectionHint({ inspectable: false, inspectionState: "unavailable" })?.actionLabel,
    "Reconnect",
  );
});

test("missing iPad developer support opens Xcode before retrying inspection", () => {
  assert.deepEqual(
    liveInspectionHint({
      inspectable: false,
      platform: "ios",
      openXcodeAvailable: true,
      inspectionError:
        "Relay could not mount Apple’s developer support image for this iPad (CoreDevice 12040).",
    }),
    {
      title: "iPad automation needs Xcode",
      detail:
        "The picture still works. Open Xcode and keep the iPad unlocked while it prepares device support, then reconnect for labels and replay.",
      actionLabel: "Open Xcode",
      action: "open-xcode",
    },
  );
});

test("CoreDevice's unavailable developer services selects Xcode before a runner error exists", () => {
  assert.equal(
    liveInspectionHint({
      inspectable: false,
      platform: "ios",
      developerServicesAvailable: false,
      inspectionError: "Relay cannot attach its iOS UI Automation session yet.",
      openXcodeAvailable: true,
    })?.action,
    "open-xcode",
  );
});

test("a current pixels-only iPad frame remains visible while device support prepares", () => {
  assert.equal(
    resolveDevicePanelState({
      serverOnline: true,
      arming: false,
      physicalIosRecording: false,
      hasDisplayImage: true,
      inspectionError:
        "Relay could not mount Apple’s developer support image for this iPad (CoreDevice 12040).",
      recordingIssue: null,
      liveCaptureIssue: null,
      developerModeDisabled: false,
      iosSetupGuidance: "Keep the iPad unlocked.",
      iosDeviceSupportPending: true,
      checkingIosSetup: false,
      preparingIosScreen: false,
      hasIosSetupIssue: false,
      deviceName: "iPad Pro",
      platform: "ios",
      openXcodeAvailable: true,
      emptyStageTitle: "Preparing this iPad",
    }),
    null,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  platformLabel,
  preferredTargetSerial,
  presentTarget,
  targetGroupMatchesQuery,
  targetIsReady,
  targetSearchText,
} from "./target-presentation";
import { deviceReadiness } from "./device-readiness";

test("uses readable platform labels in settings and target details", () => {
  assert.equal(platformLabel("ios"), "iOS");
  assert.equal(platformLabel("android"), "Android");
  assert.equal(platformLabel("browser"), "Browser");
});

test("presents a named simulator without exposing its UUID in the label", () => {
  const target = presentTarget({
    serial: "BFFE9EE7-EC40-4B58-8EED-3084F08EA7CD",
    name: "iPhone 16",
    platform: "ios",
    kind: "simulator",
    booted: true,
  });
  assert.equal(target.displayName, "iPhone 16");
  assert.equal(target.statusLabel, "Simulator ready");
  assert.equal(target.details.at(-1)?.value, "BFFE9EE7-EC40-4B58-8EED-3084F08EA7CD");
  assert.equal(target.displayName.includes("BFFE"), false);
});

test("uses a human fallback while retaining technical identity for search and details", () => {
  const device = { serial: "emulator-5554", platform: "android" as const, booted: true };
  const target = presentTarget(device);
  assert.equal(target.displayName, "Android device");
  assert.equal(target.statusLabel, "Connected");
  assert.match(targetSearchText(device), /emulator-5554/);
});

test("explains attached Android hardware that still needs authorization", () => {
  const target = presentTarget({
    serial: "RQCY104BG8X",
    name: "Android device",
    platform: "android",
    kind: "Physical device",
    booted: false,
    connectionState: "unauthorized",
  });
  assert.equal(target.statusLabel, "Authorize on phone");
  assert.match(
    targetSearchText({
      serial: "RQCY104BG8X",
      platform: "android",
      connectionState: "unauthorized",
    }),
    /authorize on phone/,
  );
});

test("presents managed browsers as their own target group", () => {
  const target = presentTarget({
    serial: "chat-web",
    name: "Chat app — Chrome",
    platform: "browser",
  });
  assert.equal(target.group, "browsers");
  assert.equal(target.statusLabel, "Ready");
});

test("matches a grouped target through any configuration", () => {
  const configurations = [
    {
      serial: "iphone-16-ios-18",
      name: "iPhone 16",
      platform: "ios" as const,
      kind: "simulator",
    },
    {
      serial: "iphone-16-ios-19-beta",
      name: "iPhone 16",
      platform: "ios" as const,
      kind: "simulator",
    },
  ];

  assert.equal(targetGroupMatchesQuery(configurations, "ios-19-beta"), true);
  assert.equal(targetGroupMatchesQuery(configurations, "pixel"), false);
});

test("shares one readiness rule across recording and discovery", () => {
  const target = { serial: "iphone", platform: "ios" as const, booted: true };
  assert.equal(targetIsReady(target, true), true);
  assert.equal(targetIsReady(target, false), false);
  assert.equal(targetIsReady({ ...target, booted: false }, true), false);
  assert.equal(targetIsReady({ ...target, connectionState: "unauthorized" }, true), false);
  assert.equal(targetIsReady(null, true), false);
});

test("prefers a controllable target instead of selecting the first stopped simulator", () => {
  assert.equal(
    preferredTargetSerial([
      { serial: "iphone-stopped", platform: "ios", booted: false },
      {
        serial: "phone-attached",
        platform: "android",
        booted: false,
        connectionState: "unauthorized",
      },
      { serial: "phone-ready", platform: "android", booted: true, connectionState: "connected" },
    ]),
    "phone-ready",
  );
  assert.equal(
    preferredTargetSerial([
      { serial: "iphone-stopped", platform: "ios", booted: false },
      {
        serial: "phone-attached",
        platform: "android",
        booted: false,
        connectionState: "unauthorized",
      },
    ]),
    null,
  );
});

test("one session-readiness rule blocks recording for Apple setup and capture failures", () => {
  const ipad = { serial: "ipad", name: "iPad", platform: "ios" as const, booted: true };
  assert.equal(deviceReadiness(ipad, true, { appleSetup: null }).kind, "checking-ios");
  assert.equal(
    deviceReadiness(ipad, true, { appleSetup: null, liveScreenAvailable: true }).kind,
    "ready",
    "a real selected-device frame wins over a lagging setup check",
  );
  assert.equal(
    deviceReadiness(ipad, true, {
      appleSetup: {
        setup: { ios: {} },
        checks: [{ status: "needs-attention", detail: "Sign in to Xcode" }],
      },
    }).kind,
    "setup-ios",
  );
  assert.equal(
    deviceReadiness(ipad, true, {
      appleSetup: { setup: { ios: {} }, checks: [] },
      requireLiveScreen: true,
      liveScreenAvailable: false,
    }).kind,
    "screen-preparing",
  );
  assert.equal(
    deviceReadiness(ipad, true, {
      appleSetup: { setup: { ios: {} }, checks: [] },
      recordingIssue: { kind: "setup", message: "Xcode signing failed" },
      liveScreenAvailable: true,
    }).kind,
    "setup-ios",
  );
  assert.equal(
    deviceReadiness({ serial: "android", name: "Pixel", platform: "android", booted: true }, true, {
      requireLiveScreen: true,
      liveScreenAvailable: false,
    }).kind,
    "screen-preparing",
  );
  assert.equal(
    deviceReadiness({ serial: "android", platform: "android", booted: true }, true, {
      liveCaptureIssue: "The screen stream stopped",
    }).kind,
    "capture-error",
  );
});

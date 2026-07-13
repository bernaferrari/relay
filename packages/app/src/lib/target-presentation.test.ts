import assert from "node:assert/strict";
import test from "node:test";
import {
  platformLabel,
  presentTarget,
  targetGroupMatchesQuery,
  targetIsReady,
  targetSearchText,
} from "./target-presentation";

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
  assert.equal(targetIsReady(null, true), false);
});

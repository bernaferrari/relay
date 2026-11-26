import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscoveryCoverage } from "./discovery-coverage.js";

const profile = (id: string, name: string) => ({
  id,
  targetId: id,
  source: "device" as const,
  platform: "android" as const,
  name,
  capabilities: ["tap" as const],
  observedAt: 1,
});

test("discovery coverage compares only sessions that share a map name", () => {
  const pixel = profile("pixel", "Pixel 9");
  const galaxy = profile("galaxy", "Galaxy S25");
  const first = {
    id: "first",
    name: "Sign-in map",
    targetId: "pixel",
    targetProfile: pixel,
    scope: {
      maxScreens: 5,
      maxTransitions: 5,
      maxDurationMs: 1_000,
      allowSensitiveControls: false,
    },
    status: "complete" as const,
    createdAt: 1,
    updatedAt: 1,
    screens: [
      { id: "a", fingerprint: "welcome", title: "Welcome", capturedAt: 1 },
      { id: "b", fingerprint: "sign-in", title: "Sign in", capturedAt: 2 },
    ],
    transitions: [
      {
        id: "t",
        fromScreenId: "a",
        toScreenId: "b",
        kind: "tap" as const,
        label: "Continue",
        changedScreen: true,
        capturedAt: 2,
      },
    ],
  };
  const second = {
    ...first,
    id: "second",
    targetId: "galaxy",
    targetProfile: galaxy,
    screens: [first.screens[0]!],
    transitions: [],
  };
  const unrelated = { ...first, id: "unrelated", name: "Checkout map" };
  const report = buildDiscoveryCoverage(first, [first, second, unrelated]);
  assert.equal(report.profiles.length, 2);
  assert.equal(report.screens.find((item) => item.id === "welcome")?.missingProfileIds.length, 0);
  assert.deepEqual(report.screens.find((item) => item.id === "sign-in")?.missingProfileIds, [
    "galaxy",
  ]);
  assert.deepEqual(report.transitions[0]?.missingProfileIds, ["galaxy"]);
});

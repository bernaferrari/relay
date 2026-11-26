import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoverySession } from "@relay/protocol";
import {
  buildExplorationTimeline,
  discoveryExploreOutcome,
  inferDiscoveryBlockedReasons,
} from "./discovery-exploration-timeline.js";
import { buildDiscoveryCoverage } from "./discovery-coverage.js";

function session(overrides: Partial<DiscoverySession> = {}): DiscoverySession {
  return {
    id: "session",
    name: "Settings map",
    targetId: "pixel",
    scope: {
      maxScreens: 20,
      maxTransitions: 40,
      maxDurationMs: 60_000,
      allowSensitiveControls: false,
    },
    status: "complete",
    createdAt: 1,
    updatedAt: 10,
    screens: [
      {
        id: "settings",
        fingerprint: "fp-settings",
        title: "Settings",
        capturedAt: 1,
        screenshotPath: "screens/settings.png",
      },
      {
        id: "memory",
        fingerprint: "fp-memory",
        title: "Memory",
        capturedAt: 3,
        screenshotPath: "screens/memory.png",
      },
      {
        id: "kids",
        fingerprint: "fp-kids",
        title: "Kids Mode",
        capturedAt: 5,
        screenshotPath: "screens/kids.png",
      },
    ],
    transitions: [
      {
        id: "open-memory",
        fromScreenId: "settings",
        toScreenId: "memory",
        kind: "tap",
        label: "Memory",
        capturedAt: 2,
        changedScreen: true,
      },
      {
        id: "back-1",
        fromScreenId: "memory",
        toScreenId: "settings",
        kind: "back",
        label: "Back",
        capturedAt: 4,
        changedScreen: true,
      },
      {
        id: "open-kids",
        fromScreenId: "settings",
        toScreenId: "kids",
        kind: "tap",
        label: "Kids Mode",
        capturedAt: 6,
        changedScreen: true,
      },
    ],
    ...overrides,
  };
}

test("exploration timeline orders transitions and keeps screenshot refs", () => {
  const timeline = buildExplorationTimeline(session(), 100);
  assert.equal(timeline.stepCount, 3);
  assert.deepEqual(
    timeline.steps.map((step) => step.label),
    ["Memory", "Back", "Kids Mode"],
  );
  assert.equal(timeline.steps[0]?.screenshotPath, "screens/memory.png");
  assert.equal(timeline.steps[0]?.screenshotScreenId, "memory");
  assert.equal(timeline.steps[0]?.fromTitle, "Settings");
  assert.equal(timeline.steps[0]?.toTitle, "Memory");
  assert.equal(timeline.steps[2]?.toTitle, "Kids Mode");
});

test("coverage report includes the exploration timeline, blocked reasons, and explore outcome", () => {
  const anchor = session({
    status: "stopped",
    screens: [
      ...session().screens,
      { id: "sign-in", fingerprint: "fp-auth", title: "Sign in", capturedAt: 9 },
    ],
    transitions: [
      ...session().transitions,
      {
        id: "language",
        fromScreenId: "settings",
        toScreenId: "sign-in",
        kind: "tap",
        label: "App Language",
        capturedAt: 8,
        changedScreen: true,
      },
    ],
  });
  const report = buildDiscoveryCoverage(anchor, [anchor], 50);
  assert.equal(report.explorationTimeline?.stepCount, 4);
  assert.equal(report.exploreOutcome, "blocked");
  assert.ok(report.blockedReasons?.some((reason) => reason.code === "auth"));
  assert.ok(report.blockedReasons?.some((reason) => reason.code === "left-app"));
  assert.ok(report.blockedReasons?.some((reason) => reason.code === "cancelled"));
});

test("inferDiscoveryBlockedReasons reports budget exhaustion", () => {
  const full = session({
    scope: {
      maxScreens: 3,
      maxTransitions: 100,
      maxDurationMs: 60_000,
      allowSensitiveControls: false,
    },
  });
  const reasons = inferDiscoveryBlockedReasons(full);
  assert.ok(reasons.some((reason) => reason.code === "budget"));
  assert.equal(discoveryExploreOutcome(full, reasons), "partial");
});

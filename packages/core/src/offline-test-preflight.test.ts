import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledTest } from "@relay/protocol";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";

function plan(steps: AppMapCompiledTest["recipes"][string]["steps"]): AppMapCompiledTest {
  return {
    schemaVersion: 1,
    appMapId: "grok",
    appMapRevision: 1,
    test: { id: "relay-40", name: "Relay 40", kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: "root",
    recipes: { root: { id: "root", title: "Root", parameters: [], steps } },
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  };
}

const observation = {
  fingerprint: "settings",
  nodes: [
    { role: "button", identifier: "appearance", label: "Appearance", hittable: true },
    { role: "textview", label: "Birth Year" },
    { role: "button", label: "Delete conversations", hittable: true },
    { role: "button", label: "Delete conversations", hittable: true },
  ],
  volatileSignals: [],
};

test("offline preflight blocks absent and ambiguous selectors before a device run", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint: "settings",
        observations: [observation],
      },
      { kind: "tap", id: "appearance", target: { identifier: "appearance" } },
      { kind: "tap", id: "missing", target: { label: "Cloud filter" } },
      { kind: "tap", id: "duplicate", target: { label: "Delete conversations" } },
    ]),
  );
  assert.equal(report.summary.checkedSelectors, 3);
  assert.equal(report.summary.blockers, 2);
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["selector-absent", "selector-ambiguous"],
  );
});

test("offline preflight keeps a following-row repair and incomplete surface honest", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "profile",
        screenTitle: "Profile",
        fingerprint: "profile",
        observations: [observation],
      },
      {
        kind: "tap",
        id: "birth-year",
        target: { relation: { kind: "following-row", anchor: { label: "Birth Year" } } },
      },
      {
        kind: "capture-surface",
        screenId: "settings",
        screenTitle: "Settings",
        variantId: "android-en",
        surfaceId: "settings-surface",
        baselineCaptureId: "stopped-capture",
        reason: "Settings",
        baselineTrust: "recapture-required",
        baselineTrustReason: "Baseline capture is stopped/seam-ambiguous.",
      },
    ]),
  );
  assert.equal(report.summary.blockers, 0);
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["selector-needs-raw-tree", "surface-recapture-required"],
  );
});

test("offline preflight is deterministic and never turns unresolved Back into a gesture", () => {
  const compiled = plan([
    {
      kind: "expect-screen",
      id: "return-needed",
      screenId: "settings",
      screenTitle: "Settings",
      fingerprint: "settings",
      returnRequirement: {
        connectionId: "return-from-help",
        fromScreenId: "help",
        destinationScreenId: "settings",
      },
    },
  ]);
  const first = preflightCompiledAppMapTestOffline(compiled);
  assert.deepEqual(preflightCompiledAppMapTestOffline(structuredClone(compiled)), first);
  assert.equal(first.findings[0]?.code, "unresolved-return");
  assert.equal(first.findings[0]?.severity, "blocker");
});

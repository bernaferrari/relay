import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTargetOperationResult } from "./target-summary.js";

test("device command summaries hide stopped simulators without hiding physical hardware", () => {
  const result = summarizeTargetOperationResult("target.devices.list", {
    devices: [
      {
        id: "phone",
        serial: "phone",
        name: "Physical phone",
        kind: "Physical device",
        booted: false,
        platform: "android",
      },
      {
        id: "running-sim",
        serial: "running-sim",
        name: "Running simulator",
        kind: "simulator",
        booted: true,
        platform: "ios",
      },
      {
        id: "stopped-sim",
        serial: "stopped-sim",
        name: "Stopped simulator",
        kind: "simulator",
        booted: false,
        platform: "ios",
      },
    ],
  });
  assert.deepEqual(result, {
    devices: [
      {
        id: "phone",
        serial: "phone",
        name: "Physical phone",
        kind: "Physical device",
        booted: false,
        platform: "android",
      },
      {
        id: "running-sim",
        serial: "running-sim",
        name: "Running simulator",
        kind: "simulator",
        booted: true,
        platform: "ios",
      },
    ],
    hiddenUnavailableCount: 1,
  });
});

test("snapshot summaries list named controls with tap centers instead of the full tree", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    bounds: { width: 834, height: 1112 },
    screenIdentity: { fingerprint: "abcdef0123456789deadbeef" },
    nodes: [
      {
        type: "Button",
        identifier: "navigation.tab.ask",
        label: "Ask",
        hittable: false,
        rect: { x: 331, y: 22, width: 44, height: 38 },
      },
      { type: "Other", hittable: false, rect: { x: 0, y: 0, width: 10, height: 10 } },
    ],
  });
  assert.deepEqual(result, {
    serial: "ipad",
    bounds: { width: 834, height: 1112 },
    inspectable: true,
    fingerprint: "abcdef0123456789",
    nodeCount: 2,
    controls: [
      {
        identifier: "navigation.tab.ask",
        label: "Ask",
        type: "Button",
        hittable: false,
        x: 353,
        y: 41,
      },
    ],
  });
});

test("snapshot summaries name the app and header so agents know where they are", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    bounds: { width: 834, height: 1112 },
    screenIdentity: { fingerprint: "ffffffffffffffffffffffffffffffff" },
    nodes: [
      {
        type: "Application",
        label: "Grok",
        hittable: true,
        rect: { x: 0, y: 0, width: 834, height: 1112 },
      },
      {
        type: "NavigationBar",
        identifier: "Settings",
        label: "grok-close",
        hittable: false,
        rect: { x: 0, y: 60, width: 834, height: 50 },
      },
      {
        type: "StaticText",
        label: "Settings",
        hittable: false,
        rect: { x: 380, y: 72, width: 80, height: 22 },
      },
    ],
  }) as { app?: string; header?: string };
  assert.equal(result.app, "Grok");
  assert.equal(result.header, "Settings");
});

test("snapshot summaries keep navigation tabs even when chrome fills the tree first", () => {
  const nodes = [
    ...Array.from({ length: 45 }, (_, index) => ({
      type: "StaticText",
      label: `Hello ${index}`,
      hittable: false,
      rect: { x: 10, y: index * 8, width: 40, height: 12 },
    })),
    {
      type: "Button",
      identifier: "navigation.tab.imagine",
      label: "Imagine",
      hittable: false,
      rect: { x: 400, y: 20, width: 44, height: 38 },
    },
    {
      type: "Button",
      identifier: "navigation.tab.build",
      label: "Build",
      hittable: true,
      rect: { x: 460, y: 20, width: 44, height: 38 },
    },
  ];
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    bounds: { width: 834, height: 1112 },
    screenIdentity: { fingerprint: "ffffffffffffffffffffffffffffffff" },
    nodes,
  }) as { controls: Array<{ identifier?: string }> };
  const identifiers = result.controls.map((control) => control.identifier).filter(Boolean);
  assert.ok(identifiers.includes("navigation.tab.imagine"));
  assert.ok(identifiers.includes("navigation.tab.build"));
});

test("uninspectable snapshots tell agents to use pixels and point taps", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    inspectable: false,
    source: "pixels-only",
    nodes: [],
  }) as { inspectable?: boolean; note?: string; nodeCount?: number };
  assert.equal(result.inspectable, false);
  assert.equal(result.nodeCount, 0);
  assert.match(result.note ?? "", /tap by point/i);
  assert.match(result.note ?? "", /device recover/i);
});

test("uninspectable snapshots surface visual fingerprint and proposed rows", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "phone",
    inspectable: false,
    source: "android-system",
    inspectionState: "unavailable",
    nodes: [],
    visualFingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    proposedRows: [
      { x: 280, y: 1275, top: 1196, bottom: 1354, height: 158 },
      { x: 280, y: 1433, top: 1354, bottom: 1512, height: 158 },
    ],
  }) as {
    visualFingerprint?: string;
    proposedRows?: Array<{ x: number; y: number }>;
    note?: string;
    inspectionState?: string;
  };
  assert.equal(result.inspectionState, "unavailable");
  assert.equal(result.visualFingerprint, "aaaaaaaaaaaaaaaa");
  assert.deepEqual(
    result.proposedRows?.map((row) => ({ x: row.x, y: row.y })),
    [
      { x: 280, y: 1275 },
      { x: 280, y: 1433 },
    ],
  );
  assert.match(result.note ?? "", /proposedRows|Names unavailable/i);
  assert.match(result.note ?? "", /device recover/i);
});

test("uninspectable snapshots preserve a bounded, safe inspection error", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    inspectable: false,
    source: "pixels-only",
    nodes: [],
    inspectionError:
      "iPad automation is unavailable because the developer disk image is not mounted. Keep the iPad unlocked and reconnect after Xcode finishes preparing it.",
  }) as { inspectionError?: string; note?: string };

  assert.match(result.inspectionError ?? "", /developer disk image/i);
  assert.equal(result.note, result.inspectionError);
});

test("target summaries preserve split-plane readiness without treating stale semantics as current", () => {
  const readiness = {
    previewPixels: {
      mode: "pixels",
      state: "proven",
      freshness: "current",
      proof: { at: 100, durationMs: 10 },
    },
    semanticControl: {
      mode: "accessibility",
      state: "proven",
      freshness: "stale",
      proof: { at: 98, observedNodeCount: 12, durationMs: 240 },
      invalidated: { at: 101, reason: "input-changed" },
    },
    evidenceCapture: {
      mode: "evidence",
      state: "proven",
      freshness: "current",
      proof: { at: 100, durationMs: 10 },
    },
  };
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    inspectable: false,
    source: "pixels-only",
    nodes: [],
    readiness,
  }) as { readiness?: unknown };
  assert.deepEqual(result.readiness, readiness);
});

test("target summaries drop impossible capability combinations instead of inventing ready control", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    inspectable: false,
    source: "pixels-only",
    nodes: [],
    readiness: {
      previewPixels: { mode: "pixels", state: "proven", freshness: "current" },
      semanticControl: { mode: "accessibility", state: "proven", freshness: "current" },
      evidenceCapture: { mode: "evidence", state: "proven", freshness: "current" },
    },
  }) as { readiness?: unknown };
  assert.equal(result.readiness, undefined);
});

test("snapshot summaries bound an inspection error", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    inspectable: false,
    source: "pixels-only",
    nodes: [],
    inspectionError: "x".repeat(600),
  }) as { inspectionError?: string };
  assert.equal(result.inspectionError?.length, 480);
});

test("non-device and malformed results remain unchanged", () => {
  const value = { devices: [{ id: "bad" }] };
  assert.equal(summarizeTargetOperationResult("target.devices.list", value), value);
  assert.equal(summarizeTargetOperationResult("target.list", value), value);
});

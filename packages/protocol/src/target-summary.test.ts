import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeLaunchedForeground,
  summarizeTargetOperationResult,
  wantsFullSnapshotTree,
} from "./target-summary.js";

test("full snapshot presentation is opt-in", () => {
  assert.equal(wantsFullSnapshotTree({ serial: "ipad" }), false);
  assert.equal(wantsFullSnapshotTree({ serial: "ipad", full: true }), true);
  assert.equal(wantsFullSnapshotTree({ serial: "ipad", full: "true" }), true);
  assert.equal(wantsFullSnapshotTree({ serial: "ipad", full: false }), false);
});

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

test("uninspectable snapshots still surface app and visual fingerprint", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    inspectable: false,
    source: "pixels-only",
    nodes: [],
    foregroundApp: "ai.x.GrokApp",
    visualFingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  }) as { app?: string; header?: string; fingerprint?: string; visualFingerprint?: string };
  assert.equal(result.app, "ai.x.GrokApp");
  assert.equal(result.header, "Grok");
  assert.equal(result.fingerprint, "bbbbbbbbbbbbbbbb");
  assert.equal(result.visualFingerprint, "bbbbbbbbbbbbbbbb");
});

test("uninspectable snapshots keep payload app and header when already named", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    inspectable: false,
    source: "pixels-only",
    nodes: [],
    app: "ai.x.GrokApp",
    header: "Grok",
    visualFingerprint: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  }) as { app?: string; header?: string };
  assert.equal(result.app, "ai.x.GrokApp");
  assert.equal(result.header, "Grok");
});

test("uninspectable snapshots do not invent a Grok header without visual identity", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    inspectable: false,
    source: "pixels-only",
    nodes: [],
    foregroundApp: "ai.x.GrokApp",
  }) as { app?: string; header?: string };
  assert.equal(result.app, "ai.x.GrokApp");
  assert.equal(result.header, undefined);
});

test("interact preview summaries drop inlined PNG base64", () => {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const result = summarizeTargetOperationResult("target.interact", {
    ok: true,
    result: {
      ok: true,
      preview: true,
      mime: "image/png",
      base64,
      bytes: 68,
      inspectable: false,
    },
  }) as { preview?: boolean; base64?: string; bytes?: number; nextHint?: string };
  assert.equal(result.preview, true);
  assert.equal(result.base64, undefined);
  assert.equal(result.bytes, 68);
  assert.match(result.nextHint ?? "", /preview:false/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(base64));
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

test("uninspectable empty AX observations never relabel semantic absence as pixel evidence", () => {
  const result = summarizeTargetOperationResult("target.snapshot.capture", {
    serial: "ipad",
    inspectable: false,
    source: "pixels-only",
    nodes: [],
    // `observeScreenIdentity([])` is deterministic but has no semantic or
    // raster value. A failed pixels-first fallback must remain unproven.
    screenIdentity: { fingerprint: "f".repeat(64), nodes: [], volatileSignals: [] },
  }) as { fingerprint?: string; visualFingerprint?: string; inspectable?: boolean };

  assert.equal(result.inspectable, false);
  assert.equal(result.fingerprint, undefined);
  assert.equal(result.visualFingerprint, undefined);
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

test("an in-flight iOS accessibility read keeps the pixel path actionable without suggesting reconnect", () => {
  const readiness = {
    previewPixels: {
      mode: "pixels",
      state: "proven",
      freshness: "current",
      proof: { at: 100, durationMs: 10 },
    },
    semanticControl: {
      mode: "accessibility",
      state: "unavailable",
      freshness: "unproven",
      reason: "probe-in-flight",
      lastError: {
        at: 101,
        reason: "probe-in-flight",
        durationMs: 8_000,
        message:
          "iOS accessibility is still reading this screen after 8000ms. Pixels remain usable; wait for the current query to settle before refreshing names.",
      },
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
    inspectionError: readiness.semanticControl.lastError.message,
    iosSessionLifecycle: {
      operation: "snapshot",
      outcome: "in-flight",
      code: "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT",
      attempts: 1,
      repairAttempted: false,
      durationMs: 8_000,
      stages: [
        { stage: "preview", outcome: "skipped" },
        { stage: "xctest-availability", outcome: "skipped" },
        { stage: "accessibility-query", outcome: "in-flight" },
        { stage: "repair", outcome: "skipped" },
      ],
    },
  }) as {
    readiness?: unknown;
    note?: string;
    iosSessionLifecycle?: { code?: string; outcome?: string };
  };

  assert.deepEqual(result.readiness, readiness);
  assert.equal(result.iosSessionLifecycle?.code, "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT");
  assert.equal(result.iosSessionLifecycle?.outcome, "in-flight");
  assert.match(result.note ?? "", /pixels remain usable/i);
  assert.doesNotMatch(result.note ?? "", /reconnect/i);
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

test("scroll survey summaries drop PNG payloads and keep a review digest", () => {
  const result = summarizeTargetOperationResult("target.scroll-survey.capture", {
    status: "completed",
    reason: "end-of-content",
    message: "Captured the complete visible list and restored the original viewport.",
    restoredStartViewport: true,
    frames: [
      {
        index: 0,
        offsetY: 0,
        appendedHeight: 0,
        screenshot: { base64: "QUFB", width: 1080, height: 2340, capturedAt: 1 },
        snapshot: {
          nodes: [
            {
              label: "Network & internet",
              type: "TextView",
              rect: { x: 80, y: 605, width: 800, height: 50 },
            },
            {
              label: "Wallpaper & style",
              type: "TextView",
              rect: { x: 80, y: 2089, width: 800, height: 50 },
            },
          ],
        },
      },
      {
        index: 1,
        offsetY: 1420,
        appendedHeight: 1420,
        screenshot: { base64: "QkJC", width: 1080, height: 2340, capturedAt: 2 },
        snapshot: {
          nodes: [
            {
              label: "Tips & support",
              type: "TextView",
              rect: { x: 80, y: 2131, width: 800, height: 50 },
            },
          ],
        },
      },
    ],
    diagnosticFrames: [],
    stitched: { base64: "Q0ND", width: 1080, height: 3760, mime: "image/png" },
    mergedNodes: [{ label: "Network & internet" }, { label: "Tips & support" }],
    persist: {
      dir: "/tmp/settings",
      full: { png: "/tmp/settings/full.png", json: "/tmp/settings/full.json" },
    },
  });
  const text = JSON.stringify(result);
  assert.equal(text.includes("QUFB"), false);
  assert.equal(text.includes("base64"), false);
  assert.deepEqual(result, {
    status: "completed",
    reason: "end-of-content",
    message: "Captured the complete visible list and restored the original viewport.",
    restoredStartViewport: true,
    frameCount: 2,
    frames: [
      {
        index: 0,
        offsetY: 0,
        appendedHeight: 0,
        width: 1080,
        height: 2340,
        labels: ["Network & internet", "Wallpaper & style"],
      },
      {
        index: 1,
        offsetY: 1420,
        appendedHeight: 1420,
        width: 1080,
        height: 2340,
        labels: ["Tips & support"],
      },
    ],
    full: { width: 1080, height: 3760, nodeCount: 2 },
    persist: {
      dir: "/tmp/settings",
      full: { png: "/tmp/settings/full.png", json: "/tmp/settings/full.json" },
    },
  });
});

test("launch summaries name the observed foreground app so launch is not foreground", () => {
  assert.deepEqual(
    summarizeLaunchedForeground("Grok", {
      nodes: [
        {
          type: "Application",
          label: "Grok",
          hittable: true,
          rect: { x: 0, y: 0, width: 834, height: 1112 },
        },
      ],
    }),
    { app: "Grok", matched: true },
  );
  assert.deepEqual(
    summarizeLaunchedForeground("ai.x.GrokApp", {
      nodes: [
        {
          type: "Application",
          label: "Grok",
          hittable: true,
          rect: { x: 0, y: 0, width: 834, height: 1112 },
        },
      ],
    }),
    { app: "Grok", matched: true },
  );
  assert.deepEqual(
    summarizeLaunchedForeground("com.android.chrome", {
      nodes: [
        {
          type: "Application",
          label: "Settings",
          hittable: true,
          rect: { x: 0, y: 0, width: 1080, height: 2340 },
        },
      ],
      foregroundApp: "com.android.settings",
      treeApp: "com.android.settings",
    }),
    { app: "Settings", matched: false },
  );
  assert.deepEqual(summarizeLaunchedForeground("Chrome", undefined), { matched: false });
});

test("launch match uses the returned app instead of a conflicting lower-priority candidate", () => {
  const settings = { type: "Application", label: "Settings" };
  assert.deepEqual(
    summarizeLaunchedForeground("Grok", {
      nodes: [settings],
      treeApp: "ai.x.GrokApp",
      foregroundApp: "ai.x.GrokApp",
    }),
    { app: "Settings", matched: false },
  );
  assert.deepEqual(
    summarizeLaunchedForeground("ai.x.GrokApp", {
      treeApp: "com.apple.Preferences",
      foregroundApp: "ai.x.GrokApp",
    }),
    { app: "com.apple.Preferences", matched: false },
  );
  assert.deepEqual(
    summarizeLaunchedForeground("com.android.chrome", {
      nodes: [{ type: "Application", label: "Chrome" }],
      treeApp: "com.android.settings",
      foregroundApp: "com.android.settings",
    }),
    { app: "Chrome", matched: true },
  );
  assert.deepEqual(summarizeLaunchedForeground("Grok", { treeApp: "ai.x.GrokApp" }), {
    app: "ai.x.GrokApp",
    matched: true,
  });
  assert.deepEqual(summarizeLaunchedForeground("Grok", { foregroundApp: "ai.x.GrokApp" }), {
    app: "ai.x.GrokApp",
    matched: true,
  });
  assert.deepEqual(summarizeLaunchedForeground("Grok", {}), { matched: false });
});

test("non-device and malformed results remain unchanged", () => {
  const value = { devices: [{ id: "bad" }] };
  assert.equal(summarizeTargetOperationResult("target.devices.list", value), value);
  assert.equal(summarizeTargetOperationResult("target.list", value), value);
});

test("interact preview digest drops base64 and stays small when HTTP has no PNG", () => {
  const withPng = summarizeTargetOperationResult("target.interact", {
    ok: true,
    preview: true,
    mime: "image/png",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    bytes: 70,
    width: 1,
    height: 1,
    inspectable: true,
    path: "/tmp/huge.png",
    nodes: [{ label: "private tree" }],
    resolution: {
      method: "label",
      point: { x: 10, y: 20 },
      bounds: { x: 1, y: 2, width: 3, height: 4 },
    },
  }) as Record<string, unknown>;
  assert.equal(withPng.preview, true);
  assert.equal(withPng.base64, undefined);
  assert.equal(withPng.path, undefined);
  assert.equal(withPng.nodes, undefined);
  assert.deepEqual(withPng.resolution, {
    method: "label",
    point: { x: 10, y: 20 },
    bounds: { x: 1, y: 2, width: 3, height: 4 },
  });

  const noPng = summarizeTargetOperationResult("target.interact", {
    ok: true,
    preview: true,
    mime: "image/png",
    bytes: 700_000,
    inspectable: false,
    path: "/tmp/preview.png",
    nodes: [{ label: "huge leftover tree" }],
  }) as Record<string, unknown>;
  assert.equal(noPng.preview, true);
  assert.equal(noPng.base64, undefined);
  assert.equal(noPng.path, undefined);
  assert.equal(noPng.nodes, undefined);
  assert.match(String(noPng.note), /--preview --file/);
});

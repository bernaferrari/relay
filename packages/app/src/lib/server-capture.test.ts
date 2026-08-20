import assert from "node:assert/strict";
import test from "node:test";
import type { TargetRuntimeReadiness } from "@relay/protocol";
import { createServerCapture, type CaptureServerDeps } from "./server-capture";

function createHarness(
  options: {
    activeDiscoveryId?: string | null;
    collectAccessibility?: boolean;
    inspectionError?: string;
    screenshotReadiness?: Array<TargetRuntimeReadiness | undefined>;
  } = {},
) {
  const calls: string[] = [];
  const requestBodies: unknown[] = [];
  const frames: Array<Record<string, unknown>> = [];
  let snapshot: unknown = null;
  let liveFrame: unknown = null;
  let liveFrameUpdates = 0;
  let busy = false;
  const logs: string[] = [];
  const copied: Array<{ base64: string; mime: string }> = [];
  let screenshotReads = 0;

  const request: CaptureServerDeps["request"] = async <T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    calls.push(path);
    requestBodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    if (path.startsWith("/screenshot")) {
      const readiness = options.screenshotReadiness?.[screenshotReads++];
      return {
        serial: "device-1",
        capturedAt: 123,
        mime: "image/png",
        base64: "encoded",
        bytes: 7,
        framePath: "/tmp/frame.png",
        width: 1668,
        height: 2224,
        ...(readiness ? { readiness } : {}),
      } as T;
    }
    if (path.startsWith("/snapshot")) {
      return {
        serial: "device-1",
        capturedAt: 123,
        nodes: [],
        interactive: [],
        bounds: { width: 100, height: 200 },
        ...(options.inspectionError ? { inspectionError: options.inspectionError } : {}),
      } as T;
    }
    if (path === "/capture/scroll-survey") {
      return {
        status: "completed",
        reason: "end-of-content",
        message: "Captured 2 viewports and returned to the starting position.",
        restoredStartViewport: true,
        frames: [
          {
            index: 0,
            offsetY: 0,
            appendedHeight: 0,
            screenshot: { base64: "first", width: 100, height: 200, capturedAt: 100 },
            snapshot: {
              serial: "device-1",
              capturedAt: 100,
              nodes: [{ label: "Usage", rect: { x: 10, y: 20, width: 60, height: 24 } }],
              interactive: [],
              inspectable: true,
            },
          },
          {
            index: 1,
            offsetY: 140,
            appendedHeight: 140,
            screenshot: { base64: "second", width: 100, height: 200, capturedAt: 200 },
            snapshot: {
              serial: "device-1",
              capturedAt: 200,
              nodes: [{ label: "Buy more", rect: { x: 10, y: 80, width: 60, height: 24 } }],
              interactive: [],
              inspectable: true,
            },
          },
        ],
        stitched: { base64: "stitched", width: 100, height: 340, mime: "image/png" },
        mergedNodes: [{ label: "Buy more", rect: { x: 10, y: 220, width: 60, height: 24 } }],
      } as T;
    }
    if (path === "/step/run") return { ok: true, durationMs: 12, logs: [] } as T;
    return {} as T;
  };

  const capture = createServerCapture({
    request,
    serverUrl: () => "http://localhost:8787",
    selectedDevice: () => "device-1",
    selectedAction: () => "tap",
    activeDiscoverySessionId: () => options.activeDiscoveryId ?? null,
    collectAccessibility: () => options.collectAccessibility ?? true,
    setBusyCapture: (value) => {
      busy = value;
    },
    setSnapshot: (value) => {
      snapshot = value;
    },
    setLiveFrame: (value) => {
      liveFrame = value;
      liveFrameUpdates += 1;
    },
    pushFrame: (frame) => {
      const full = { ...frame, id: "frame-1" };
      frames.push(full);
      return full as never;
    },
    copyImage: async (base64, mime) => {
      copied.push({ base64, mime });
    },
    appendLog: (text) => logs.push(text),
    refreshDiscoverySessions: async () => undefined,
  });

  return {
    capture,
    calls,
    requestBodies,
    frames,
    logs,
    copied,
    getSnapshot: () => snapshot,
    getLiveFrame: () => liveFrame,
    getLiveFrameUpdates: () => liveFrameUpdates,
    isBusy: () => busy,
  };
}

test("capture boundary keeps screenshot and snapshot transport details out of the UI context", async () => {
  const harness = createHarness();

  const frame = await harness.capture.captureUiScreenshot("before tap");
  const snapshot = await harness.capture.captureUiSnapshot();
  await harness.capture.pollLiveFrame();
  await harness.capture.pollLiveSnapshot();

  assert.equal(harness.calls[0], "/screenshot?serial=device-1&caption=before+tap");
  assert.equal(harness.frames.length, 1);
  assert.equal((harness.frames[0] as { caption: string }).caption, "before tap");
  assert.equal(frame.id, "frame-1", "recorders can persist the exact captured frame");
  assert.equal(frame.caption, "before tap");
  assert.deepEqual(snapshot?.bounds, { width: 100, height: 200 });
  assert.deepEqual((harness.getSnapshot() as { bounds: { width: number } }).bounds, {
    width: 100,
    height: 200,
  });
  assert.equal((harness.getLiveFrame() as { id: string }).id, "live-123");
  assert.equal((harness.getLiveFrame() as { width?: number }).width, 1668);
  assert.equal((harness.getLiveFrame() as { height?: number }).height, 2224);
  assert.equal(harness.isBusy(), false);
  assert.ok(harness.logs.some((line) => line.startsWith("snapshot ")));
});

test("accessibility off prevents explicit and background snapshot collection", async () => {
  const harness = createHarness({ collectAccessibility: false });

  assert.equal(await harness.capture.captureUiSnapshot(), null);
  await harness.capture.pollLiveSnapshot();

  assert.deepEqual(harness.calls, []);
  assert.equal(harness.getSnapshot(), null);
});

test("live snapshots retain a safe inspection error alongside usable pixels", async () => {
  const harness = createHarness({
    inspectionError:
      "Relay could not mount Apple’s developer support image for this iPad. Keep it unlocked and cabled, then let Xcode finish preparing the device.",
  });

  await harness.capture.pollLiveSnapshot();

  assert.match(
    (harness.getSnapshot() as { inspectionError?: string }).inspectionError ?? "",
    /developer support image/i,
  );
});

test("live iPad preview requests compact interactive accessibility geometry", async () => {
  const harness = createHarness();

  await harness.capture.pollLiveSnapshot({ interactiveOnly: true });

  assert.deepEqual(harness.calls, ["/snapshot?serial=device-1&interactiveOnly=1"]);
});

test("live capture leaves an identical device frame mounted", async () => {
  const harness = createHarness();

  await harness.capture.pollLiveFrame();
  await harness.capture.pollLiveFrame();

  assert.equal(harness.calls.length, 2, "polling still proves that the device is reachable");
  assert.equal(harness.getLiveFrameUpdates(), 1, "unchanged pixels are not decoded and remounted");
});

test("identical pixels retain newer runtime readiness without replacing the mounted bitmap", async () => {
  const readiness = (
    at: number,
    semanticFreshness: "current" | "stale",
  ): TargetRuntimeReadiness => ({
    previewPixels: {
      mode: "pixels",
      state: "proven",
      freshness: "current",
      proof: { at },
    },
    semanticControl: {
      mode: "accessibility",
      state: "proven",
      freshness: semanticFreshness,
      proof: { at: at - 1, observedNodeCount: 12 },
      ...(semanticFreshness === "stale"
        ? { invalidated: { at, reason: "visual-changed" as const } }
        : {}),
    },
    evidenceCapture: {
      mode: "evidence",
      state: "proven",
      freshness: "current",
      proof: { at },
    },
  });
  const harness = createHarness({
    screenshotReadiness: [readiness(100, "current"), readiness(200, "stale")],
  });

  await harness.capture.pollLiveFrame();
  const initialFrame = harness.getLiveFrame();
  await harness.capture.pollLiveFrame();

  assert.equal(harness.getLiveFrameUpdates(), 2, "proof metadata advances without a bitmap decode");
  assert.notEqual(harness.getLiveFrame(), initialFrame, "frame metadata is immutable");
  assert.equal((harness.getLiveFrame() as { capturedAt: number }).capturedAt, 123);
  assert.equal(
    (harness.getLiveFrame() as { readiness?: TargetRuntimeReadiness }).readiness?.semanticControl
      .freshness,
    "stale",
  );
});

test("a new live preview clears stale pixels and remounts an unchanged fresh frame", async () => {
  const harness = createHarness();

  await harness.capture.pollLiveFrame();
  harness.capture.resetLivePreview();

  assert.equal(harness.getLiveFrame(), null, "initialization never presents the previous frame");
  await harness.capture.pollLiveFrame();
  assert.equal((harness.getLiveFrame() as { id: string }).id, "live-123");
  assert.equal(harness.getLiveFrameUpdates(), 3, "clear and fresh mount are both observable");
});

test("copy screenshot is ephemeral and does not create a Relay frame or log", async () => {
  const harness = createHarness();

  await harness.capture.copyUiScreenshot();

  assert.equal(harness.calls[0], "/screenshot?ephemeral=1&serial=device-1");
  assert.deepEqual(harness.copied, [{ base64: "encoded", mime: "image/png" }]);
  assert.deepEqual(harness.frames, []);
  assert.deepEqual(harness.logs, []);
  assert.equal(harness.isBusy(), false);
});

test("scroll survey keeps every viewport's accessibility tree and the stitched coordinate map", async () => {
  const harness = createHarness();

  const survey = await harness.capture.captureScrollablePage();

  assert.equal(harness.calls[0], "/capture/scroll-survey");
  assert.deepEqual(harness.requestBodies[0], { serial: "device-1", maxScrolls: 4 });
  assert.equal(survey?.frames.length, 2);
  assert.equal(harness.frames.length, 3, "two original viewports plus a convenience preview");
  const first = harness.frames[0] as {
    caption: string;
    scrollSurvey: { kind: string; snapshot?: { nodes: Array<{ label?: string }> } };
  };
  assert.equal(first.caption, "full page · viewport 1");
  assert.equal(first.scrollSurvey.kind, "viewport");
  assert.equal(first.scrollSurvey.snapshot?.nodes[0]?.label, "Usage");
  const stitched = harness.frames[2] as {
    scrollSurvey: { kind: string; mergedNodes?: Array<{ label?: string }> };
  };
  assert.equal(stitched.scrollSurvey.kind, "stitched-preview");
  assert.equal(stitched.scrollSurvey.mergedNodes?.[0]?.label, "Buy more");
});

test("live capture exposes a setup failure without throwing from the polling loop", async () => {
  let issue: string | null = null;
  const capture = createServerCapture({
    request: async () => {
      throw new Error("Finish iPad setup in Relay Settings before capturing.");
    },
    serverUrl: () => "http://localhost:8787",
    selectedDevice: () => "ipad-1",
    selectedAction: () => null,
    activeDiscoverySessionId: () => null,
    collectAccessibility: () => true,
    setBusyCapture: () => undefined,
    setSnapshot: () => undefined,
    setLiveFrame: () => undefined,
    setLiveCaptureIssue: (value) => {
      issue = value;
    },
    pushFrame: (frame) => ({ ...frame, id: "frame" }) as never,
    appendLog: () => undefined,
    refreshDiscoverySessions: async () => undefined,
  });

  await capture.pollLiveFrame();

  assert.match(issue ?? "", /Finish iPad setup/i);
});

test("step execution returns the typed backend result and includes the selected device", async () => {
  const harness = createHarness();
  const result = await harness.capture.runStep({ kind: "sleep", ms: 50 });

  assert.deepEqual(result, { ok: true, durationMs: 12, logs: [] });
  assert.equal(harness.calls.at(-1), "/step/run");
});

test("interaction boundary routes an explicitly active discovery session", async () => {
  const harness = createHarness({ activeDiscoveryId: "map-1" });

  await harness.capture.interactStep({ kind: "type", text: "Paris" });

  assert.equal(harness.calls[0], "/discovery/map-1/interact");
  assert.equal(harness.calls.includes("/screenshot?serial=device-1"), false);
});

test("interaction boundary keeps ordinary interactions outside discovery", async () => {
  const harness = createHarness();
  await harness.capture.interactStep({ kind: "point", x: 12, y: 18 });

  assert.equal(harness.calls[0], "/interact");
});

test("live touch sends the pointer lifecycle to the selected H.264 session", async () => {
  const harness = createHarness();

  const ok = await harness.capture.touchDevice("move", 0.25, 0.75);

  assert.equal(ok, true);
  assert.equal(harness.calls[0], "/device/touch");
  assert.deepEqual(harness.requestBodies[0], {
    serial: "device-1",
    action: "move",
    x: 0.25,
    y: 0.75,
  });
});

test("live keyboard preserves key order on the selected H.264 session", async () => {
  const harness = createHarness();

  await Promise.all([
    harness.capture.keyDevice({ kind: "text", text: "a" }),
    harness.capture.keyDevice({ kind: "text", text: "b" }),
    harness.capture.keyDevice({ kind: "key", key: "enter" }),
  ]);

  assert.deepEqual(harness.calls, ["/device/key", "/device/key", "/device/key"]);
  assert.deepEqual(harness.requestBodies, [
    { serial: "device-1", kind: "text", text: "a" },
    { serial: "device-1", kind: "text", text: "b" },
    { serial: "device-1", kind: "key", key: "enter" },
  ]);
});

test("live scroll sends coalesced wheel deltas to the selected H.264 session", async () => {
  const harness = createHarness();

  const ok = await harness.capture.scrollDevice(0.5, 0.4, -0.1, 0.75);

  assert.equal(ok, true);
  assert.equal(harness.calls[0], "/device/scroll");
  assert.deepEqual(harness.requestBodies[0], {
    serial: "device-1",
    x: 0.5,
    y: 0.4,
    scrollX: -0.1,
    scrollY: 0.75,
  });
});

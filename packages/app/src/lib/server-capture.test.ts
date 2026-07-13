import assert from "node:assert/strict";
import test from "node:test";
import { createServerCapture, type CaptureServerDeps } from "./server-capture";

function createHarness(options: { activeDiscoveryId?: string | null } = {}) {
  const calls: string[] = [];
  const frames: Array<Record<string, unknown>> = [];
  let snapshot: unknown = null;
  let liveFrame: unknown = null;
  let busy = false;
  const logs: string[] = [];

  const request: CaptureServerDeps["request"] = async <T>(path: string): Promise<T> => {
    calls.push(path);
    if (path.startsWith("/screenshot")) {
      return {
        serial: "device-1",
        capturedAt: 123,
        mime: "image/png",
        base64: "encoded",
        bytes: 7,
        framePath: "/tmp/frame.png",
      } as T;
    }
    if (path.startsWith("/snapshot")) {
      return {
        serial: "device-1",
        capturedAt: 123,
        nodes: [],
        interactive: [],
        bounds: { width: 100, height: 200 },
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
    setBusyCapture: (value) => {
      busy = value;
    },
    setSnapshot: (value) => {
      snapshot = value;
    },
    setShowOverlays: () => undefined,
    setLiveFrame: (value) => {
      liveFrame = value;
    },
    pushFrame: (frame) => {
      const full = { ...frame, id: "frame-1" };
      frames.push(full);
      return full as never;
    },
    appendLog: (text) => logs.push(text),
    refreshDiscoverySessions: async () => undefined,
  });

  return {
    capture,
    calls,
    frames,
    logs,
    getSnapshot: () => snapshot,
    getLiveFrame: () => liveFrame,
    isBusy: () => busy,
  };
}

test("capture boundary keeps screenshot and snapshot transport details out of the UI context", async () => {
  const harness = createHarness();

  await harness.capture.captureUiScreenshot("before tap");
  await harness.capture.captureUiSnapshot();
  await harness.capture.pollLiveFrame();
  await harness.capture.pollLiveSnapshot();

  assert.equal(harness.calls[0], "/screenshot?serial=device-1&caption=before+tap");
  assert.equal(harness.frames.length, 1);
  assert.equal((harness.frames[0] as { caption: string }).caption, "before tap");
  assert.deepEqual((harness.getSnapshot() as { bounds: { width: number } }).bounds, {
    width: 100,
    height: 200,
  });
  assert.equal((harness.getLiveFrame() as { id: string }).id, "live-123");
  assert.equal(harness.isBusy(), false);
  assert.ok(harness.logs.some((line) => line.startsWith("snapshot ")));
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

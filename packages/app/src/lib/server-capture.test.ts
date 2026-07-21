import assert from "node:assert/strict";
import test from "node:test";
import { createServerCapture, type CaptureServerDeps } from "./server-capture";

function createHarness(options: { activeDiscoveryId?: string | null } = {}) {
  const calls: string[] = [];
  const requestBodies: unknown[] = [];
  const frames: Array<Record<string, unknown>> = [];
  let snapshot: unknown = null;
  let liveFrame: unknown = null;
  let busy = false;
  const logs: string[] = [];

  const request: CaptureServerDeps["request"] = async <T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    calls.push(path);
    requestBodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
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
    requestBodies,
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

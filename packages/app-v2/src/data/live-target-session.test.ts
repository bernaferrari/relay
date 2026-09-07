import { dispatchRecordingInput } from "./recording-input-outcome";
import { ApiError } from "@relay/client";
import type { BrowserDeviceSession } from "@relay/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveTargetSession } from "./live-target-session";

const target = { kind: "browser", platform: "browser", targetId: "browser-1" } as const;

function session(): BrowserDeviceSession {
  return {
    schemaVersion: 1,
    sessionId: "session-1",
    targetId: target.targetId,
    status: "streaming",
    ownership: "controlled",
    sequence: 1,
    activePageId: "page-1",
    pages: [
      {
        id: "page-1",
        kind: "page",
        title: "Relay",
        url: "https://relay.test",
        active: true,
        closed: false,
      },
    ],
    profile: {
      schemaVersion: 1,
      engine: "chromium",
      viewport: { width: 320, height: 240 },
      deviceScaleFactor: 1,
      mobile: false,
      touch: false,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "no-preference",
      reducedMotion: "no-preference",
      permissions: [],
      offline: false,
      environmentRevision: "test",
    },
    startedAt: 1,
    frameCapturedAt: 2,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("live target session", () => {
  it("keeps frame delivery out of subscribed snapshots and paints through the imperative mount", async () => {
    const currentSession = session();
    const frame = {
      sessionId: currentSession.sessionId,
      sequence: 1,
      pageId: "page-1",
      pageUrl: "https://relay.test",
      visualFingerprint: "fingerprint-1",
      capturedAt: 2,
      mime: "image/jpeg" as const,
      base64: "AQI=",
      bytes: 2,
      width: 320,
      height: 240,
    };
    let binaryRequests = 0;
    let frameRequests = 0;
    const invoke = vi.fn(async (id: string) => {
      if (id === "target.browser-device.open") return { session: currentSession };
      if (id === "target.browser-device.frame") {
        frameRequests++;
        if (frameRequests === 3) {
          currentSession.profile.locale = "pt-BR";
          currentSession.profile.authenticationFixtureId = "account-checkout";
        }
        return { session: currentSession, frame: { ...frame, sequence: frameRequests } };
      }
      throw new Error(`unexpected operation ${id}`);
    });
    const client = {
      connection: { url: "http://relay.test" },
      invoke,
      binaryResource: vi.fn(async () => {
        binaryRequests += 1;
        throw new ApiError(404, "binary unavailable");
      }),
      openStream: vi.fn(),
    } as never;
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 320,
      height: 240,
      close() {},
    }));
    const context = { drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    const sessionController = createLiveTargetSession({
      client,
      target,
      identity: { signedOut: true, sessionId: "session-1" },
    });
    const snapshots: ReturnType<typeof sessionController.snapshot>[] = [];
    const unsubscribe = sessionController.subscribe((snapshot) => {
      snapshots.push(snapshot);
      if (snapshot.status === "streaming" && snapshot.frameSequence === 3)
        sessionController.close();
    });
    sessionController.mount(canvas);
    await vi.waitFor(() => expect(sessionController.snapshot().status).toBe("closed"));
    unsubscribe();

    expect(binaryRequests).toBe(3);
    expect(context.drawImage).toHaveBeenCalledTimes(3);
    expect(sessionController.snapshot()).not.toHaveProperty("frame");
    expect(snapshots.some((snapshot) => snapshot.status === "streaming")).toBe(true);
    expect(snapshots.find((snapshot) => snapshot.status === "streaming")?.browserContext).toEqual({
      engine: "chromium",
      viewport: { width: 320, height: 240 },
      locale: "en-US",
    });
    const streaming = snapshots.filter((snapshot) => snapshot.status === "streaming");
    expect(streaming[0]?.browserContext).toBe(streaming[1]?.browserContext);
    expect(streaming[2]?.browserContext).not.toBe(streaming[1]?.browserContext);
    expect(streaming[2]?.browserContext?.locale).toBe("pt-BR");
    expect(streaming[2]?.browserContext?.authenticationFixtureId).toBe("account-checkout");
    expect(streaming[0]?.browserContext?.locale).toBe("en-US");
    expect(sessionController.snapshot().browserContext).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("target.browser-device.open", {
      targetId: target.targetId,
      signedOut: true,
      sessionId: "session-1",
    });
    expect(invoke).toHaveBeenCalledWith("target.browser-device.frame", {
      targetId: target.targetId,
    });
  });

  it("binds browser input to the current frame and never acquires a lease", async () => {
    const currentSession = session();
    const frame = {
      sessionId: currentSession.sessionId,
      sequence: 1,
      pageId: "page-1",
      pageUrl: "https://relay.test",
      visualFingerprint: "fingerprint-1",
      capturedAt: 2,
      mime: "image/jpeg" as const,
      base64: "AQI=",
      bytes: 2,
      width: 320,
      height: 240,
    };
    const calls: unknown[][] = [];
    const client = {
      connection: { url: "http://relay.test" },
      invoke: vi.fn(async (id: string, value: unknown) => {
        calls.push([id, value]);
        if (id === "target.browser-device.open") return { session: currentSession };
        if (id === "target.browser-device.frame") return { session: currentSession, frame };
        if (id === "target.browser-device.control") return { ok: true, session: currentSession };
        throw new Error(`unexpected operation ${id}`);
      }),
      binaryResource: vi.fn(async () => {
        throw new ApiError(404, "binary unavailable");
      }),
      openStream: vi.fn(),
    } as never;
    vi.stubGlobal("createImageBitmap", async () => ({ width: 320, height: 240, close() {} }));
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
    } as unknown as HTMLCanvasElement;
    const interactions: unknown[] = [];
    const sessionController = createLiveTargetSession({
      client,
      target,
      onInteraction: (interaction) => void interactions.push(interaction),
    });
    const stop = sessionController.mount(canvas);
    await vi.waitFor(() => expect(sessionController.snapshot().status).toBe("streaming"));
    await sessionController.input({
      kind: "click",
      sessionId: currentSession.sessionId,
      pageId: "page-1",
      expectedSequence: 1,
      x: 20,
      y: 30,
    });
    stop();
    sessionController.close();

    expect(calls.some(([id]) => id === "lease.create")).toBe(false);
    expect(calls.some(([id]) => id === "target.browser-device.control")).toBe(false);
    expect(interactions).toEqual([
      {
        kind: "tap",
        target: {
          point: {
            x: 20,
            y: 30,
            referenceBounds: { width: 320, height: 240 },
            anchor: { horizontal: "left", vertical: "top" },
          },
        },
      },
    ]);
  });

  it("routes keyboard Enter through recording authority without direct dispatch", async () => {
    const invoke = vi.fn();
    const onInteraction = vi.fn();
    const sessionController = createLiveTargetSession({
      client: {
        connection: { url: "http://relay.test" },
        invoke,
        binaryResource: vi.fn(),
        openStream: vi.fn(),
      } as never,
      target: { kind: "device", platform: "android", targetId: "emulator-5554" },
      onInteraction,
    });

    await sessionController.input({ kind: "key", key: "enter" });

    expect(onInteraction).toHaveBeenCalledWith({ kind: "device", action: "keyboard-enter" });
    expect(invoke).not.toHaveBeenCalled();
    sessionController.close();
  });

  it("routes Android Back through recording authority without direct dispatch", async () => {
    const invoke = vi.fn();
    const onInteraction = vi.fn();
    const sessionController = createLiveTargetSession({
      client: {
        connection: { url: "http://relay.test" },
        invoke,
        binaryResource: vi.fn(),
        openStream: vi.fn(),
      } as never,
      target: { kind: "device", platform: "android", targetId: "emulator-5554" },
      onInteraction,
    });

    await sessionController.input({ kind: "key", key: "back" });

    expect(onInteraction).toHaveBeenCalledWith({ kind: "key", key: "back" });
    expect(invoke).not.toHaveBeenCalled();
    sessionController.close();
  });

  it("sends Android system Back in preview without a recording", async () => {
    const invoke = vi.fn();
    const onInteraction = vi.fn();
    const sessionController = createLiveTargetSession({
      client: {
        connection: { url: "http://relay.test" },
        invoke,
        binaryResource: vi.fn(),
        openStream: vi.fn(),
      } as never,
      target: { kind: "device", platform: "android", targetId: "emulator-5554" },
    });

    await sessionController.input({ kind: "key", key: "back" });

    expect(onInteraction).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("target.interact", {
      serial: "emulator-5554",
      kind: "key",
      key: "back",
    });
    sessionController.close();
  });

  it("never bypasses recording authority for an unsupported input", async () => {
    const invoke = vi.fn();
    const client = {
      connection: { url: "http://relay.test" },
      invoke,
      binaryResource: vi.fn(),
      openStream: vi.fn(),
    } as never;
    const onInteraction = vi.fn();
    const sessionController = createLiveTargetSession({
      client,
      target: { kind: "device", platform: "android", targetId: "emulator-5554" },
      onInteraction,
    });

    await expect(
      sessionController.input({
        kind: "key",
        key: "backspace",
      }),
    ).rejects.toThrow("does not support recording");

    expect(onInteraction).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    sessionController.close();
  });
});

it("converts scaled Android video points into observed device pixels before recording", async () => {
  const onInteraction = vi.fn();
  const invoke = vi.fn(async () => ({ bounds: { width: 1080, height: 2400 } }));
  const live = createLiveTargetSession({
    client: {
      connection: { url: "http://relay.test" },
      invoke,
      openStream: () => new Promise(() => {}),
      binaryResource: vi.fn(),
    } as never,
    target: { kind: "device", platform: "android", targetId: "emulator-5554" },
    onInteraction,
  });
  live.mount({ width: 488, height: 1080 } as HTMLCanvasElement);
  await live.input({ kind: "touch", action: "up", x: 244, y: 540 });
  expect(onInteraction).toHaveBeenCalledWith({
    kind: "tap",
    target: { point: { x: 540, y: 1200, anchor: { horizontal: "left", vertical: "top" } } },
  });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("target.snapshot.capture", {
    serial: "emulator-5554",
  });
  live.close();
});

it("sends a complete normalized Android tap from the non-recording canvas", async () => {
  const invoke = vi.fn();
  const live = createLiveTargetSession({
    client: {
      connection: { url: "http://relay.test" },
      invoke,
      openStream: () => new Promise(() => {}),
      binaryResource: vi.fn(),
    } as never,
    target: { kind: "device", platform: "android", targetId: "emulator-5554" },
  });
  live.mount({ width: 488, height: 1080 } as HTMLCanvasElement);
  await live.input({ kind: "touch", action: "up", x: 244, y: 540 });
  expect(invoke.mock.calls).toEqual([
    ["target.touch", { serial: "emulator-5554", action: "down", x: 0.5, y: 0.5 }],
    ["target.touch", { serial: "emulator-5554", action: "up", x: 0.5, y: 0.5 }],
  ]);
  live.close();
});

it("uses pixel dimensions without accessibility and refuses input if both are unavailable", async () => {
  const onInteraction = vi.fn();
  let pixelsAvailable = true;
  const invoke = vi.fn(async (id: string) =>
    id === "target.snapshot.capture" ? {} : pixelsAvailable ? { width: 1080, height: 2400 } : {},
  );
  const live = createLiveTargetSession({
    client: {
      connection: { url: "http://relay.test" },
      invoke,
      openStream: () => new Promise(() => {}),
    } as never,
    target: { kind: "device", platform: "android", targetId: "emulator-5554" },
    onInteraction,
  });
  live.mount({ width: 488, height: 1080 } as HTMLCanvasElement);
  await live.input({ kind: "touch", action: "up", x: 244, y: 540 });
  expect(onInteraction).toHaveBeenCalledExactlyOnceWith({
    kind: "tap",
    target: { point: { x: 540, y: 1200, anchor: { horizontal: "left", vertical: "top" } } },
  });
  pixelsAvailable = false;
  const refresh = vi.fn();
  const outcome = await dispatchRecordingInput({
    send: () => live.input({ kind: "touch", action: "up", x: 244, y: 540 }),
    refresh,
  });
  expect(outcome.kind).toBe("not-dispatched");
  expect(onInteraction).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  live.close();
});

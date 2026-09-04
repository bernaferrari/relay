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
    const invoke = vi.fn(async (id: string) => {
      if (id === "target.browser-device.open") return { session: currentSession };
      if (id === "target.browser-device.frame") return { session: currentSession, frame };
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
    const sessionController = createLiveTargetSession({ client, target });
    const snapshots: ReturnType<typeof sessionController.snapshot>[] = [];
    const unsubscribe = sessionController.subscribe((snapshot) => {
      snapshots.push(snapshot);
      if (snapshot.status === "streaming") sessionController.close();
    });
    sessionController.mount(canvas);
    await vi.waitFor(() => expect(sessionController.snapshot().status).toBe("closed"));
    unsubscribe();

    expect(binaryRequests).toBe(1);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
    expect(sessionController.snapshot()).not.toHaveProperty("frame");
    expect(snapshots.some((snapshot) => snapshot.status === "streaming")).toBe(true);
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
    ).rejects.toThrow("cannot be recorded");

    expect(onInteraction).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    sessionController.close();
  });
});

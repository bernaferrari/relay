import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IOS_PREVIEW_FRAME_MAX_AGE_MS, IOS_PREVIEW_STALLED_MESSAGE } from "./ios-preview-freshness";
import { createLiveTargetSession, type LiveTargetSession } from "./live-target-session";

const sessions: LiveTargetSession[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
});
afterEach(() => {
  for (const live of sessions.splice(0)) live.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function flush() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}
function fixture(
  platform: "ios" | "android" = "ios",
  onInteraction?: Parameters<typeof createLiveTargetSession>[0]["onInteraction"],
) {
  const packet = new Uint8Array(17);
  packet[0] = 2;
  new DataView(packet.buffer).setUint32(12, 1);
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let signal!: AbortSignal;
  const bitmap = { width: 2224, height: 1668, close: vi.fn() };
  const decode = vi.fn(async () => bitmap);
  vi.stubGlobal("createImageBitmap", decode);
  const drawImage = vi.fn();
  const invoke = vi.fn(async (_operation: string, _input: unknown): Promise<unknown> => ({}));
  const openStream = vi.fn(async (_path: string, options: { signal: AbortSignal }) => {
    signal = options.signal;
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
          signal.addEventListener("abort", () => controller.close(), { once: true });
        },
      }),
    };
  });
  const live = createLiveTargetSession({
    target: { kind: "device", platform, targetId: "ipad" },
    client: { connection: { url: "http://relay.test" }, invoke, openStream } as never,
    ...(onInteraction ? { onInteraction } : {}),
  });
  sessions.push(live);
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
  } as unknown as HTMLCanvasElement;
  live.mount(canvas);
  async function frame() {
    await flush();
    stream.enqueue(packet);
    await flush();
  }
  return {
    live,
    frame,
    invoke,
    openStream,
    decode,
    bitmap,
    drawImage,
    canvas,
    signal: () => signal,
  };
}

describe("iOS continuous preview freshness", () => {
  it("waits for a decoded frame before admitting native input", async () => {
    const view = fixture();
    await flush();
    await expect(view.live.input({ kind: "key", key: "enter" })).rejects.toThrow(
      "current iOS preview frame",
    );
    expect(view.invoke).not.toHaveBeenCalled();
    await view.frame();
    await view.live.input({ kind: "key", key: "enter" });
    expect(view.invoke).toHaveBeenCalledExactlyOnceWith("target.interact", {
      serial: "ipad",
      kind: "key",
      key: "enter",
    });
  });

  it("degrades and aborts a silent open stream with an actionable issue and no retry or resend", async () => {
    const view = fixture();
    await view.frame();
    expect(view.live.snapshot().status).toBe("streaming");
    await vi.advanceTimersByTimeAsync(IOS_PREVIEW_FRAME_MAX_AGE_MS);
    await flush();
    expect(view.live.snapshot()).toMatchObject({
      status: "degraded",
      issue: IOS_PREVIEW_STALLED_MESSAGE,
    });
    expect(view.signal().aborted).toBe(true);
    await expect(view.live.input({ kind: "touch", action: "up", x: 100, y: 100 })).rejects.toThrow(
      "current iOS preview frame",
    );
    expect(view.invoke).not.toHaveBeenCalled();
    expect(view.openStream).toHaveBeenCalledOnce();
    expect(view.drawImage).toHaveBeenCalledOnce();
  });

  it("checks elapsed paint time synchronously even when the timer callback has not run", async () => {
    const view = fixture();
    await view.frame();
    vi.setSystemTime(Date.now() + IOS_PREVIEW_FRAME_MAX_AGE_MS);
    await expect(
      view.live.input({ kind: "key", key: "enter", text: "Never resend" }),
    ).rejects.toThrow("current iOS preview frame");
    expect(view.invoke).not.toHaveBeenCalled();
    expect(view.live.snapshot().issue).toBe(IOS_PREVIEW_STALLED_MESSAGE);
    expect(view.signal().aborted).toBe(true);
  });

  it.each([false, true])(
    "rechecks freshness after delayed dimensions before mutation (recording=%s)",
    async (recording) => {
      const onInteraction = vi.fn();
      const view = fixture("ios", recording ? onInteraction : undefined);
      await view.frame();
      let finish!: (value: unknown) => void;
      view.invoke.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = view.live.input({ kind: "touch", action: "up", x: 100, y: 100 });
      const rejected = expect(pending).rejects.toThrow("current iOS preview frame");
      await flush();
      await vi.advanceTimersByTimeAsync(IOS_PREVIEW_FRAME_MAX_AGE_MS);
      finish({ bounds: { width: 1112, height: 834 } });
      await rejected;
      expect(view.invoke).toHaveBeenCalledExactlyOnceWith("target.snapshot.capture", {
        serial: "ipad",
      });
      expect(onInteraction).not.toHaveBeenCalled();
    },
  );

  it.each(["expire", "close"] as const)(
    "disposes a late decode without repaint or revival after %s",
    async (end) => {
      const view = fixture();
      await view.frame();
      let finish!: (value: typeof view.bitmap) => void;
      view.decode.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await view.frame();
      expect(view.decode).toHaveBeenCalledTimes(2);
      if (end === "close") view.live.close();
      else await vi.advanceTimersByTimeAsync(IOS_PREVIEW_FRAME_MAX_AGE_MS);
      const late = { width: 640, height: 480, close: vi.fn() };
      finish(late);
      await flush();
      expect(late.close).toHaveBeenCalledOnce();
      expect(view.drawImage).toHaveBeenCalledOnce();
      expect(view.canvas.width).toBe(2224);
      expect(view.live.snapshot().status).toBe(end === "close" ? "closed" : "degraded");
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(IOS_PREVIEW_FRAME_MAX_AGE_MS * 2);
      expect(view.live.snapshot().status).toBe(end === "close" ? "closed" : "degraded");
    },
  );

  it("renews from an unchanged successfully painted iOS frame", async () => {
    const view = fixture();
    await view.frame();
    await vi.advanceTimersByTimeAsync(IOS_PREVIEW_FRAME_MAX_AGE_MS - 1);
    await view.frame();
    await vi.advanceTimersByTimeAsync(2);
    expect(view.live.snapshot().status).toBe("streaming");
    expect(view.drawImage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(IOS_PREVIEW_FRAME_MAX_AGE_MS - 2);
    expect(view.live.snapshot().status).toBe("degraded");
  });

  it("preserves stationary Android preview and input semantics beyond the iOS deadline", async () => {
    const view = fixture("android");
    await view.frame();
    await vi.advanceTimersByTimeAsync(IOS_PREVIEW_FRAME_MAX_AGE_MS * 2);
    expect(view.live.snapshot().status).toBe("streaming");
    expect(view.signal().aborted).toBe(false);
    await view.live.input({ kind: "key", key: "enter" });
    expect(view.invoke).toHaveBeenCalledExactlyOnceWith("target.key", {
      serial: "ipad",
      kind: "key",
      key: "enter",
    });
  });
});

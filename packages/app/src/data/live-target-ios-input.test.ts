import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveTargetSession, type LiveTargetInput } from "./live-target-session";

const target = { kind: "device", platform: "ios", targetId: "ipad" } as const;
afterEach(() => vi.unstubAllGlobals());
async function preview(
  invoke: (operation: string, input: unknown) => Promise<unknown> = vi.fn(async () => ({})),
  onInteraction?: Parameters<typeof createLiveTargetSession>[0]["onInteraction"],
) {
  const packet = new Uint8Array(17);
  packet[0] = 2;
  new DataView(packet.buffer).setUint32(12, 1);
  vi.stubGlobal("createImageBitmap", async () => ({ width: 2732, height: 2048, close() {} }));
  const live = createLiveTargetSession({
    client: {
      connection: { url: "http://relay.test" },
      invoke,
      openStream: async (_path: string, options: { signal: AbortSignal }) => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(packet);
            options.signal.addEventListener("abort", () => controller.close(), { once: true });
          },
        }),
      }),
      binaryResource: vi.fn(),
    } as never,
    target,
    ...(onInteraction ? { onInteraction } : {}),
  });
  live.mount({
    width: 2732,
    height: 2048,
    getContext: () => ({ drawImage() {} }),
  } as unknown as HTMLCanvasElement);
  await vi.waitFor(() => expect(live.snapshot().status).toBe("streaming"));
  return live;
}
describe("canonical iOS preview input", () => {
  it("rejects Android-only Recents locally before invoking an endpoint", async () => {
    const invoke = vi.fn(async () => ({}));
    const live = await preview(invoke);
    try {
      await expect(live.input({ kind: "key", key: "recents" })).rejects.toThrow(
        "iOS preview does not support recents",
      );
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      live.close();
    }
  });
  it.each([undefined, {}, { width: 0, height: 1024 }, { width: 1366, height: Number.NaN }])(
    "rejects missing logical geometry before dispatch without treating PNG pixels as proof (%j)",
    async (bounds) => {
      const invoke = vi.fn(async () => ({ bounds }));
      const live = await preview(invoke);
      try {
        await expect(live.input({ kind: "touch", action: "up", x: 1366, y: 512 })).rejects.toThrow(
          "iOS logical screen dimensions",
        );
        expect(invoke).toHaveBeenCalledExactlyOnceWith("target.snapshot.capture", {
          serial: "ipad",
        });
      } finally {
        live.close();
      }
    },
  );
  it("does not mutate or capture PNG dimensions when the logical capture request fails", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("AX unavailable");
    });
    const live = await preview(invoke);
    try {
      await expect(live.input({ kind: "touch", action: "up", x: 1366, y: 512 })).rejects.toThrow(
        "iOS logical screen dimensions",
      );
      expect(invoke).toHaveBeenCalledExactlyOnceWith("target.snapshot.capture", { serial: "ipad" });
    } finally {
      live.close();
    }
  });
  it("sends one point interaction using logical viewport coordinates rather than Android down/up", async () => {
    const invoke = vi.fn(async (operation: string) =>
      operation === "target.snapshot.capture" ? { bounds: { width: 1366, height: 1024 } } : {},
    );
    const live = await preview(invoke);
    try {
      await live.input({ kind: "touch", action: "up", x: 1366, y: 512 });
      expect(invoke.mock.calls).toEqual([
        ["target.snapshot.capture", { serial: "ipad" }],
        ["target.interact", { serial: "ipad", kind: "point", x: 683, y: 256 }],
      ]);
    } finally {
      live.close();
    }
  });
  it.each([
    [
      { kind: "key", key: "enter", text: "Hello iPad" },
      { kind: "type", text: "Hello iPad" },
    ],
    [
      { kind: "text", text: "Pasted input" },
      { kind: "type", text: "Pasted input" },
    ],
    [
      { kind: "key", key: "enter" },
      { kind: "key", key: "enter" },
    ],
    [
      { kind: "key", key: "Enter" },
      { kind: "key", key: "enter" },
    ],
    [
      { kind: "key", key: "backspace" },
      { kind: "key", key: "backspace" },
    ],
    [
      { kind: "key", key: "Backspace" },
      { kind: "key", key: "backspace" },
    ],
  ] as const)("uses one canonical interaction for %j", async (value, command) => {
    const invoke = vi.fn(async () => ({}));
    const live = await preview(invoke);
    try {
      await live.input(value as LiveTargetInput);
      expect(invoke).toHaveBeenCalledExactlyOnceWith("target.interact", {
        serial: "ipad",
        ...command,
      });
    } finally {
      live.close();
    }
  });
  it("keeps iOS authored taps and Enter under recording authority without direct native mutation", async () => {
    const invoke = vi.fn(async () => ({ bounds: { width: 1366, height: 1024 } }));
    const onInteraction = vi.fn();
    const live = await preview(invoke, onInteraction);
    try {
      await live.input({ kind: "touch", action: "up", x: 1366, y: 512 });
      await live.input({ kind: "key", key: "enter" });
      expect(onInteraction.mock.calls).toEqual([
        [
          {
            kind: "tap",
            target: { point: { x: 683, y: 256, anchor: { horizontal: "left", vertical: "top" } } },
          },
        ],
        [{ kind: "device", action: "keyboard-enter" }],
      ]);
      expect(invoke).toHaveBeenCalledExactlyOnceWith("target.snapshot.capture", { serial: "ipad" });
    } finally {
      live.close();
    }
  });
  it("does not retry or fall back to Android after an uncertain canonical dispatch", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("Lost canonical acknowledgement");
    });
    const live = await preview(invoke);
    try {
      await expect(live.input({ kind: "key", key: "enter", text: "One value" })).rejects.toThrow(
        "Lost canonical acknowledgement",
      );
      expect(invoke).toHaveBeenCalledExactlyOnceWith("target.interact", {
        serial: "ipad",
        kind: "type",
        text: "One value",
      });
    } finally {
      live.close();
    }
  });
});

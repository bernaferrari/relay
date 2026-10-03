import { afterEach, expect, it, vi } from "vitest";
import type { VideoFrameRenderer } from "@yume-chan/scrcpy-decoder-webcodecs";
import { createLiveTargetSession } from "./live-target-session";

const decoder = vi.hoisted(() => ({
  renderer: undefined as VideoFrameRenderer | undefined,
  received: 0,
  draws: 0,
}));
vi.mock("@yume-chan/scrcpy-decoder-webcodecs", () => ({
  WebCodecsVideoDecoder: class {
    static isSupported = true;
    writable: WritableStream;
    onSize?: (size: { width: number; height: number }) => void;
    constructor({ renderer }: { renderer: VideoFrameRenderer }) {
      decoder.renderer = renderer;
      this.writable = new WritableStream({
        write: () => {
          decoder.received++;
          this.onSize?.({ width: 320, height: 640 });
        },
      });
    }
    sizeChanged(callback: (size: { width: number; height: number }) => void) {
      this.onSize = callback;
    }
    dispose() {}
  },
  WebGLVideoFrameRenderer: class {
    static isSupported = false;
  },
  BitmapVideoFrameRenderer: class {
    setSize() {}
    draw() {
      decoder.draws++;
    }
  },
}));
afterEach(() => {
  decoder.renderer = undefined;
  decoder.received = 0;
  decoder.draws = 0;
});

it("native preview becomes streaming only after an actual decoded frame paints", async () => {
  const packet = new Uint8Array(17);
  packet[0] = 1;
  new DataView(packet.buffer).setUint32(12, 1);
  const live = createLiveTargetSession({
    target: { kind: "device", platform: "android", targetId: "phone" },
    client: {
      connection: { url: "http://relay.test" },
      invoke: vi.fn(),
      binaryResource: vi.fn(),
      openStream: async (_path: string, options: { signal: AbortSignal }) => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(packet);
            options.signal.addEventListener("abort", () => controller.close(), { once: true });
          },
        }),
      }),
    } as never,
  });
  live.mount({ width: 0, height: 0 } as HTMLCanvasElement);
  await vi.waitFor(() => expect(decoder.received).toBe(1));
  try {
    expect(live.snapshot().status).toBe("connecting");
    expect(live.snapshot().lastFrameAt).toBeUndefined();
    await decoder.renderer!.draw({} as VideoFrame);
    expect(decoder.draws).toBe(1);
    expect(live.snapshot().status).toBe("streaming");
    expect(live.snapshot().frameSequence).toBe(1);
    expect(live.snapshot().lastFrameAt).toBeTypeOf("number");
  } finally {
    live.close();
  }
  await decoder.renderer!.draw({} as VideoFrame);
  expect(live.snapshot().status).toBe("closed");
  expect(decoder.draws).toBe(1);
});

import { once } from "node:events";
import { randomInt } from "node:crypto";
import type http from "node:http";
import { AdbServerClient } from "@yume-chan/adb";
import { AdbServerNodeTcpConnector } from "@yume-chan/adb-server-node-tcp";
import { AdbScrcpyClient, AdbScrcpyOptions2_1 } from "@yume-chan/adb-scrcpy";
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  DefaultServerPath,
  ScrcpyPointerId,
  type ScrcpyControlMessageWriter,
  type ScrcpyMediaStreamPacket,
  ScrcpyVideoCodecId,
} from "@yume-chan/scrcpy";
import { ReadableStream, WritableStream } from "@yume-chan/stream-extra";
import { CORS_HEADERS, HttpError } from "./http.js";
import { readAndroidVideoServer } from "./android-live-video-assets.js";

const PACKET_HEADER_BYTES = 16;

/** One encoder per Android target. A reconnect replaces a stale response
 * before another scrcpy process starts, so renderer refreshes and multiple
 * Relay windows cannot accumulate producers. */
export class AndroidVideoStreamRegistry {
  readonly #active = new Map<string, { token: symbol; close: () => void }>();

  replace(serial: string, close: () => void): () => void {
    this.#active.get(serial)?.close();
    const token = Symbol(serial);
    this.#active.set(serial, { token, close });
    return () => {
      if (this.#active.get(serial)?.token === token) this.#active.delete(serial);
    };
  }

  count(): number {
    return this.#active.size;
  }
}

const activeVideoStreams = new AndroidVideoStreamRegistry();

export type AndroidTouchAction = "down" | "move" | "up" | "cancel";
export type AndroidKeyboardInput =
  | { kind: "text"; text: string }
  | { kind: "key"; key: "enter" | "backspace" };

type AndroidControlWriter = Pick<
  ScrcpyControlMessageWriter,
  "injectKeyCode" | "injectText" | "injectTouch" | "injectScroll"
>;

/** Serialize writes and retire control before its scrcpy socket is closed. */
export class AndroidControlChannel {
  #closed = false;
  #pending: Promise<void> = Promise.resolve();

  constructor(readonly controller: AndroidControlWriter) {}

  write(operation: (controller: AndroidControlWriter) => Promise<void>): Promise<void> {
    const result = this.#pending.then(async () => {
      if (this.#closed) throw new HttpError(409, "Live device control is reconnecting");
      try {
        await operation(this.controller);
      } catch {
        this.#closed = true;
        throw new HttpError(409, "Live device control is reconnecting");
      }
    });
    // Keep an observed tail for close() even when the request-facing promise
    // rejects. This prevents an EPIPE from becoming an unhandled rejection.
    this.#pending = result.catch(() => undefined);
    return result;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#pending;
  }
}

type ActiveAndroidControl = {
  channel: AndroidControlChannel;
  width: number;
  height: number;
};

const activeControls = new Map<string, ActiveAndroidControl>();

const TOUCH_ACTIONS = {
  down: AndroidMotionEventAction.Down,
  move: AndroidMotionEventAction.Move,
  up: AndroidMotionEventAction.Up,
  cancel: AndroidMotionEventAction.Cancel,
} as const;

/** Inject text or a discrete key through the same persistent scrcpy channel. */
export async function injectAndroidKey(serial: string, input: AndroidKeyboardInput): Promise<void> {
  const active = activeControls.get(serial);
  if (!active) {
    throw new HttpError(409, "Live device control is not ready");
  }
  if (input.kind === "text") {
    if (input.text) {
      await active.channel.write((controller) => controller.injectText(input.text));
    }
    return;
  }

  const keyCode = input.key === "enter" ? AndroidKeyCode.Enter : AndroidKeyCode.Backspace;
  const message = {
    keyCode,
    repeat: 0,
    metaState: AndroidKeyEventMeta.None,
  };
  await active.channel.write(async (controller) => {
    await controller.injectKeyCode({ ...message, action: AndroidKeyEventAction.Down });
    await controller.injectKeyCode({ ...message, action: AndroidKeyEventAction.Up });
  });
}

/** Inject one event into the control channel belonging to the live H.264 stream. */
export async function injectAndroidTouch(
  serial: string,
  action: AndroidTouchAction,
  x: number,
  y: number,
): Promise<void> {
  const active = activeControls.get(serial);
  if (!active) {
    throw new HttpError(409, "Live device control is not ready");
  }
  const releasing = action === "up" || action === "cancel";
  await active.channel.write((controller) =>
    controller.injectTouch({
      action: TOUCH_ACTIONS[action],
      pointerId: ScrcpyPointerId.Finger,
      pointerX: Math.round(Math.max(0, Math.min(1, x)) * active.width),
      pointerY: Math.round(Math.max(0, Math.min(1, y)) * active.height),
      videoWidth: active.width,
      videoHeight: active.height,
      pressure: releasing ? 0 : 1,
      actionButton: AndroidMotionEventButton.None,
      buttons: AndroidMotionEventButton.None,
    }),
  );
}

/** Forward a mouse-wheel/trackpad delta through scrcpy's native scroll event. */
export async function injectAndroidScroll(
  serial: string,
  x: number,
  y: number,
  scrollX: number,
  scrollY: number,
): Promise<void> {
  const active = activeControls.get(serial);
  if (!active) {
    throw new HttpError(409, "Live device control is not ready");
  }
  await active.channel.write((controller) =>
    controller.injectScroll({
      pointerX: Math.round(Math.max(0, Math.min(1, x)) * active.width),
      pointerY: Math.round(Math.max(0, Math.min(1, y)) * active.height),
      videoWidth: active.width,
      videoHeight: active.height,
      scrollX: Math.max(-1, Math.min(1, scrollX)),
      scrollY: Math.max(-1, Math.min(1, scrollY)),
      buttons: AndroidMotionEventButton.None,
    }),
  );
}

/** Relay framing: kind + keyframe + reserved + PTS(ns) + payload length. */
export function encodeRelayVideoPacket(packet: ScrcpyMediaStreamPacket): Uint8Array {
  const header = Buffer.allocUnsafe(PACKET_HEADER_BYTES);
  header.writeUInt8(packet.type === "configuration" ? 0 : 1, 0);
  header.writeUInt8(packet.type === "data" && packet.keyframe ? 1 : 0, 1);
  header.writeUInt16BE(0, 2);
  header.writeBigUInt64BE(packet.type === "data" ? (packet.pts ?? 0n) : 0n, 4);
  header.writeUInt32BE(packet.data.byteLength, 12);
  return header;
}

async function writeChunk(res: http.ServerResponse, chunk: Uint8Array): Promise<void> {
  if (res.destroyed || res.writableEnded) throw new Error("Video client disconnected");
  if (!res.write(chunk)) await once(res, "drain");
}

/**
 * Start scrcpy's Android-side MediaCodec capture and relay its timestamped
 * H.264 packets. The browser decodes them directly with WebCodecs, so there is
 * no image polling, host transcoding, or playback buffer in the live path.
 */
export async function streamAndroidVideo(res: http.ServerResponse, serial: string): Promise<void> {
  const { binary: serverBinary, version } = await readAndroidVideoServer();
  const connector = new AdbServerNodeTcpConnector({ host: "127.0.0.1", port: 5037 });
  const server = new AdbServerClient(connector);
  const device = (await server.getDevices(["device"])).find((item) => item.serial === serial);
  if (!device) throw new HttpError(404, `Android device not available: ${serial}`);

  const adb = await server.createAdb(device);
  const releaseStream = activeVideoStreams.replace(serial, () => {
    if (!res.destroyed && !res.writableEnded) res.destroy();
  });
  let scrcpy: AdbScrcpyClient<AdbScrcpyOptions2_1<true>> | undefined;
  let cancelReader: (() => Promise<void>) | undefined;
  let disconnected = false;
  let streamStartedAt: number | undefined;
  let streamedFrames = 0;
  let streamedBytes = 0;
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      disconnected = true;
      const active = activeControls.get(serial);
      if (active && active.channel.controller === scrcpy?.controller) {
        activeControls.delete(serial);
        await active.channel.close();
      }
      await cancelReader?.().catch(() => undefined);
      await scrcpy?.close().catch(() => undefined);
      await adb.close().catch(() => undefined);
    })();
    return shutdownPromise;
  };
  res.once("close", () => {
    void shutdown().catch(() => undefined);
  });

  try {
    await AdbScrcpyClient.pushServer(
      adb,
      new ReadableStream({
        start(controller) {
          controller.enqueue(serverBinary);
          controller.close();
        },
      }),
    );

    const options = new AdbScrcpyOptions2_1(
      {
        audio: false,
        control: true,
        cleanup: false,
        logLevel: "error",
        // Mouse-driven authoring exposes 30 fps immediately: the cursor races
        // ahead of the phone. Modern physical Android devices can encode the
        // bounded 1080px stream at display cadence, while scrcpy still emits
        // fewer frames when the screen is idle.
        maxFps: 60,
        // The preview is ~540 physical pixels wide in the companion panel.
        // 1080px preserves Retina detail while bounding decoded textures.
        maxSize: 1080,
        // scrcpy's default socket name is global on the device. A unique SCID
        // prevents a reconnect (or a second Relay window) from attaching to a
        // previous capture process and waiting forever for its video socket.
        scid: randomInt(0x80000000).toString(16),
        videoBitRate: 8_000_000,
        tunnelForward: false,
      },
      { version },
    );
    scrcpy = await AdbScrcpyClient.start(adb, DefaultServerPath, options);
    void scrcpy.output.pipeTo(new WritableStream<string>({ write() {} })).catch(() => undefined);

    const video = await scrcpy.videoStream;
    if (!video || video.metadata.codec !== ScrcpyVideoCodecId.H264) {
      throw new HttpError(503, "The device did not provide an H.264 video stream");
    }

    const controller = scrcpy.controller;
    const width = video.metadata.width ?? 0;
    const height = video.metadata.height ?? 0;
    if (controller && width > 0 && height > 0) {
      activeControls.set(serial, {
        channel: new AndroidControlChannel(controller),
        width,
        height,
      });
    }

    streamStartedAt = Date.now();
    console.log(
      `[video] H.264 started serial=${serial} size=${video.metadata.width ?? 0}x${video.metadata.height ?? 0}`,
    );

    res.writeHead(200, {
      ...CORS_HEADERS,
      "Content-Type": "application/x-relay-h264",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "X-Relay-Video-Width": String(video.metadata.width ?? 0),
      "X-Relay-Video-Height": String(video.metadata.height ?? 0),
    });

    const reader = video.stream.getReader();
    cancelReader = () => reader.cancel().then(() => undefined);
    try {
      while (!disconnected) {
        const result = await reader.read();
        if (result.done) break;
        streamedBytes += result.value.data.byteLength;
        if (result.value.type === "data") streamedFrames += 1;
        await writeChunk(res, encodeRelayVideoPacket(result.value));
        await writeChunk(res, result.value.data);
      }
    } catch (error) {
      // Closing or replacing a live preview is normal browser lifecycle, not a
      // server error. Genuine device/encoder failures still reach the route
      // boundary and terminate the stream without taking down the process.
      if (!disconnected && !res.destroyed && !res.writableEnded) throw error;
    }
  } finally {
    releaseStream();
    await shutdown().catch(() => undefined);
    if (!res.destroyed && !res.writableEnded) res.end();
    if (streamStartedAt !== undefined) {
      console.log(
        `[video] H.264 stopped serial=${serial} frames=${streamedFrames} bytes=${streamedBytes} durationMs=${Date.now() - streamStartedAt}`,
      );
    }
  }
}

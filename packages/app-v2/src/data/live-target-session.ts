import type { TalkBackCaptureResult } from "./talkback-overlay";
import { reviewAndroidTalkBack } from "@relay/protocol";
import { RecordingInputNotSentError } from "./recording-input-outcome";
import type { BinaryResource, RelayClient } from "@relay/client";
import type {
  AuthoringInteraction,
  AuthoringTarget,
  BrowserDeviceFrame,
  BrowserDeviceInput,
  BrowserDeviceSession,
  ServerConnection,
} from "@relay/protocol";
import type { StepTarget } from "@relay/protocol";
import {
  BROWSER_DEVICE_BINARY_FRAME_CONTENT_TYPE,
  MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES,
  MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES,
  browserDeviceBinaryFrameMetadataSchema,
} from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import { ScrcpyVideoCodecId, type ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
  type VideoFrameRenderer,
} from "@yume-chan/scrcpy-decoder-webcodecs";

/** State that is safe for a framework adapter to subscribe to. Pixel data is
 * deliberately absent: a frame can arrive at device cadence without causing
 * a product tree render. */
export type LiveTargetStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "degraded"
  | "offline"
  | "closed";

export type LiveTargetSnapshot = {
  readonly status: LiveTargetStatus;
  readonly target: AuthoringTarget;
  readonly issue?: string;
  readonly lastFrameAt?: number;
  readonly frameSequence?: number;
  /** Safe metadata from the current live browser session. Credentials are never included. */
  readonly browserContext?: LiveTargetBrowserContext;
  readonly accessibility?: TalkBackCaptureResult;
};

export type LiveTargetBrowserContext = {
  readonly engine: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly locale: string;
  readonly authenticationFixtureId?: string;
};

export type LiveTargetMount = HTMLCanvasElement;

export type LiveTargetInput =
  | BrowserDeviceInput
  | { kind: "tap"; target: { identifier?: string; label?: string; text?: string } }
  | { kind: "touch"; action: "down" | "move" | "up" | "cancel"; x: number; y: number }
  | { kind: "key"; key: "enter" | "backspace" | "back" | "home" | "recents"; text?: string }
  | { kind: "scroll"; x: number; y: number; scrollX: number; scrollY: number };

export type LiveTargetInteraction = Extract<
  AuthoringInteraction,
  { kind: "tap" | "type" | "swipe" | "key" | "device" }
>;

export type LiveTargetSession = {
  snapshot(): LiveTargetSnapshot;
  subscribe(listener: (snapshot: LiveTargetSnapshot) => void): () => void;
  /** Start transport and paint the newest frames into the supplied canvas. */
  mount(canvas: LiveTargetMount): () => void;
  input(input: LiveTargetInput): Promise<void>;
  setAccessibilityInspection?(enabled: boolean): void;
  close(): void;
};

type Client = Pick<RelayClient, "invoke" | "binaryResource" | "openStream"> & {
  readonly connection: ServerConnection;
};

type BinaryFrameMetadata = {
  session: BrowserDeviceSession;
  frame: Omit<BrowserDeviceFrame, "base64">;
  gap?: { afterSequence: number; currentSequence: number; dropped: number };
};

const FRAME_MAX_BYTES = 18 * 1024 * 1024;
const STREAM_CONNECT_ATTEMPTS = 3;

function transientStreamError(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  }
  const message = errorText(error);
  return /network|fetch|socket|connection|stream.*(?:ended|closed|reset)|timed? out/iu.test(
    message,
  );
}

async function waitForStreamRetry(
  signal: AbortSignal | undefined,
  delayMs: number,
): Promise<boolean> {
  if (signal?.aborted) return true;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (aborted: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(aborted);
    };
    const onAbort = () => {
      clearTimeout(timer);
      finish(true);
    };
    const timer = setTimeout(() => finish(false), delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 8192, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeBinaryFrame(resource: BinaryResource): {
  metadata: BinaryFrameMetadata;
  bytes: Uint8Array;
} {
  if (resource.headers.get("x-relay-browser-device-transport") !== "binary") {
    throw new Error("Live browser frame omitted its transport marker");
  }
  if (
    resource.headers.get("content-type")?.split(";", 1)[0] !==
    BROWSER_DEVICE_BINARY_FRAME_CONTENT_TYPE
  ) {
    throw new Error("Live browser frame has an unsupported content type");
  }
  if (resource.bytes.byteLength < 4) throw new Error("Live browser frame envelope is truncated");
  const metadataLength = new DataView(
    resource.bytes.buffer,
    resource.bytes.byteOffset,
    4,
  ).getUint32(0);
  if (metadataLength > MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES) {
    throw new Error("Live browser frame metadata exceeds its bounded size");
  }
  const frameOffset = 4 + metadataLength;
  if (frameOffset > resource.bytes.byteLength) {
    throw new Error("Live browser frame metadata length exceeds its body");
  }
  const metadata = browserDeviceBinaryFrameMetadataSchema.parse(
    JSON.parse(new TextDecoder().decode(resource.bytes.subarray(4, frameOffset))),
  );
  const bytes = resource.bytes.subarray(frameOffset);
  if (bytes.byteLength > MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES) {
    throw new Error("Live browser frame exceeds its bounded size");
  }
  if (bytes.byteLength !== metadata.frame.bytes) {
    throw new Error("Live browser frame length does not match its metadata");
  }
  return { metadata, bytes };
}

async function drawJpeg(
  canvas: HTMLCanvasElement,
  bytes: Uint8Array,
): Promise<{ width: number; height: number }> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const image = await createImageBitmap(new Blob([owned.buffer], { type: "image/jpeg" }));
  try {
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Live target canvas context is unavailable");
    context.drawImage(image, 0, 0);
    return { width: image.width, height: image.height };
  } finally {
    image.close();
  }
}

/** The 16-byte Relay video packet envelope used by the existing target stream. */
async function* videoPackets(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  let chunk = new Uint8Array(0);
  let offset = 0;
  async function readExactly(length: number): Promise<Uint8Array | undefined> {
    const result = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      if (offset === chunk.byteLength) {
        const next = await reader.read();
        if (next.done)
          return written === 0
            ? undefined
            : Promise.reject(new Error("Truncated live target packet"));
        chunk = new Uint8Array(next.value);
        offset = 0;
      }
      const count = Math.min(length - written, chunk.byteLength - offset);
      result.set(chunk.subarray(offset, offset + count), written);
      written += count;
      offset += count;
    }
    return result;
  }
  try {
    while (true) {
      const header = await readExactly(16);
      if (!header) return;
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const kind = view.getUint8(0);
      const keyframe = view.getUint8(1) === 1;
      const pts = view.getBigUint64(4);
      const length = view.getUint32(12);
      if (length > FRAME_MAX_BYTES) throw new Error("Live target packet exceeds its bounded size");
      const data = await readExactly(length);
      if (!data) throw new Error("Live target packet payload is missing");
      if (kind === 2) yield { type: "jpeg" as const, pts, data };
      else if (kind === 0) yield { type: "configuration" as const, data };
      else if (kind === 1) yield { type: "data" as const, keyframe, pts, data };
      else if (kind === 3) yield { type: "annexb" as const, keyframe, pts, data };
      else throw new Error(`Unknown live target packet kind: ${kind}`);
    }
  } finally {
    reader.releaseLock();
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function framePath(targetId: string, sequence?: number): string {
  const suffix = sequence === undefined ? "" : `?afterSequence=${sequence}`;
  return `/targets/${encodeURIComponent(targetId)}/browser-device/frame.bin${suffix}`;
}

function supportsJsonFrameFallback(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    [404, 405, 406, 415, 501].includes((error as { status?: unknown }).status as number)
  );
}

/**
 * Owns one target's high-frequency observation transport. This is intentionally
 * framework-neutral; React/Solid adapters subscribe only to connection status
 * and hand it a canvas. Lease acquisition and recording transitions remain
 * server-owned operations in the Product workflow.
 */
export type LiveBrowserOpenIdentity = {
  signedOut?: true;
  sessionId?: string;
  configurationDigest?: string;
  authenticationFixtureId?: string;
};

export function createLiveTargetSession(input: {
  client: Client;
  target: AuthoringTarget;
  /** Last target.open identity so the canvas attaches to that live session. */
  identity?: LiveBrowserOpenIdentity;
  /** When recording, hand the normalized intent to ProductRecordingJourney.
   * The callback is the only mutation authority; the session does not also
   * dispatch a target operation. */
  onInteraction?: (interaction: LiveTargetInteraction) => Promise<void> | void;
}): LiveTargetSession {
  const listeners = new Set<(snapshot: LiveTargetSnapshot) => void>();
  const target = { ...input.target };
  let current: LiveTargetSnapshot = { status: "idle", target };
  let canvas: HTMLCanvasElement | undefined;
  let controller: AbortController | undefined;
  let browserSession: BrowserDeviceSession | undefined;
  let browserFrame: BrowserDeviceFrame | undefined;
  let inspectAccessibility = false;
  let streamTask: Promise<void> | undefined;
  let closed = false;
  let firstFrameTimer: ReturnType<typeof setTimeout> | undefined;

  function browserContext(session: BrowserDeviceSession): LiveTargetBrowserContext {
    const previous = current.browserContext;
    const profile = session.profile;
    if (
      previous?.engine === profile.engine &&
      previous.locale === profile.locale &&
      previous.authenticationFixtureId === profile.authenticationFixtureId &&
      previous.viewport.width === profile.viewport.width &&
      previous.viewport.height === profile.viewport.height
    )
      return previous;
    return {
      engine: profile.engine,
      viewport: { ...profile.viewport },
      locale: session.profile.locale,
      ...(session.profile.authenticationFixtureId
        ? { authenticationFixtureId: session.profile.authenticationFixtureId }
        : {}),
    };
  }

  function publish(next: Omit<LiveTargetSnapshot, "target">): void {
    if (next.status === "streaming" || next.status === "closed" || next.status === "offline")
      clearTimeout(firstFrameTimer);
    const previous = current;
    current = { target, ...next };
    const previousContext = previous.browserContext;
    const nextContext = current.browserContext;
    if (
      previous.status === current.status &&
      previous.issue === current.issue &&
      previous.frameSequence === current.frameSequence &&
      previous.lastFrameAt === current.lastFrameAt &&
      previousContext?.engine === nextContext?.engine &&
      previousContext?.locale === nextContext?.locale &&
      previousContext?.authenticationFixtureId === nextContext?.authenticationFixtureId &&
      previousContext?.viewport.width === nextContext?.viewport.width &&
      previousContext?.viewport.height === nextContext?.viewport.height
    )
      return;
    for (const listener of listeners) listener(current);
  }

  function fail(error: unknown): void {
    if (closed) return;
    publish({ status: "degraded", issue: errorText(error) });
  }

  async function pollBrowser(): Promise<void> {
    const targetId = target.targetId;
    const identity = input.identity;
    const opened =
      browserSession ??
      (
        await input.client.invoke("target.browser-device.open", {
          targetId,
          ...(identity?.authenticationFixtureId
            ? { authenticationFixtureId: identity.authenticationFixtureId }
            : {}),
          ...(identity?.signedOut ? { signedOut: true as const } : {}),
          ...(identity?.sessionId ? { sessionId: identity.sessionId } : {}),
          ...(identity?.configurationDigest
            ? { configurationDigest: identity.configurationDigest }
            : {}),
        })
      ).session;
    browserSession = opened;
    publish({
      status: "connecting",
      issue: opened.issue,
      browserContext: browserContext(opened),
    });
    while (!closed && controller && !controller.signal.aborted) {
      const afterSequence = browserFrame?.sequence;
      try {
        let session: BrowserDeviceSession;
        let frame: BrowserDeviceFrame;
        let bytes: Uint8Array;
        try {
          const resource = await input.client.binaryResource(
            framePath(targetId, afterSequence),
            { signal: controller.signal },
            4 + MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES + MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES,
          );
          const decoded = decodeBinaryFrame(resource);
          session = decoded.metadata.session;
          frame = { ...decoded.metadata.frame, base64: bytesToBase64(decoded.bytes) };
          bytes = decoded.bytes;
        } catch (error) {
          if (!supportsJsonFrameFallback(error)) throw error;
          const fallback = await input.client.invoke("target.browser-device.frame", {
            targetId,
            ...(afterSequence === undefined ? {} : { afterSequence }),
          });
          session = fallback.session;
          frame = fallback.frame;
          bytes = base64ToBytes(frame.base64);
        }
        browserSession = session;
        let accessibility: TalkBackCaptureResult | undefined;
        if (inspectAccessibility) {
          try {
            const { overlay } = await input.client.invoke("target.browser-device.inspect", {
              targetId,
              sessionId: frame.sessionId,
              pageId: frame.pageId,
              expectedSequence: frame.sequence,
            });
            if (
              overlay.sessionId === frame.sessionId &&
              overlay.pageId === frame.pageId &&
              overlay.sequence === frame.sequence &&
              overlay.visualFingerprint === frame.visualFingerprint
            ) {
              accessibility = {
                inspectable: true,
                bounds: { width: frame.width, height: frame.height },
                review: reviewAndroidTalkBack(overlay.candidates),
              };
            }
          } catch {
            // A navigating page can reject inspection; show pixels without old labels.
          }
        }
        if (canvas) await drawJpeg(canvas, bytes);
        browserFrame = frame;
        publish({
          status: "streaming",
          issue: session.issue,
          lastFrameAt: frame.capturedAt,
          frameSequence: frame.sequence,
          browserContext: browserContext(session),
          accessibility,
        });
        // The binary endpoint normally waits for a newer sequence. Keep the
        // compatibility JSON path bounded as well when an older server returns
        // immediately with the same frame.
        if (!controller.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        if (controller.signal.aborted) return;
        fail(error);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  async function streamTarget(): Promise<void> {
    let response: Response;
    for (let attempt = 1; ; attempt += 1) {
      try {
        response = await input.client.openStream(
          `/device/stream?serial=${encodeURIComponent(target.targetId)}`,
          { signal: controller?.signal },
        );
        break;
      } catch (error) {
        if (
          controller?.signal.aborted ||
          !transientStreamError(error) ||
          attempt >= STREAM_CONNECT_ATTEMPTS
        )
          throw error;
        publish({ status: "connecting" });
        if (await waitForStreamRetry(controller?.signal, 250 * attempt)) return;
      }
    }
    if (!response.body) throw new Error("Live target stream has no response body");
    publish({ status: "connecting" });
    let sequence = 0;
    let decoder: WebCodecsVideoDecoder | undefined;
    let writer: WritableStreamDefaultWriter<ScrcpyMediaStreamPacket> | undefined;
    const ensureDecoder = () => {
      if (writer) return writer;
      if (!canvas || !WebCodecsVideoDecoder.isSupported) {
        throw new Error("This browser does not support live Android video decoding");
      }
      const renderer: VideoFrameRenderer = WebGLVideoFrameRenderer.isSupported
        ? new WebGLVideoFrameRenderer(canvas)
        : new BitmapVideoFrameRenderer(canvas);
      decoder = new WebCodecsVideoDecoder({ codec: ScrcpyVideoCodecId.H264, renderer });
      decoder.sizeChanged(({ width, height }) => {
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
        }
        publish({ status: "streaming", lastFrameAt: Date.now(), frameSequence: sequence });
      });
      writer = decoder.writable.getWriter();
      return writer;
    };
    for await (const packet of videoPackets(response.body)) {
      if (closed || controller?.signal.aborted) return;
      if (packet.type === "jpeg") {
        if (!canvas) continue;
        await drawJpeg(canvas, packet.data);
        sequence += 1;
        publish({ status: "streaming", lastFrameAt: Date.now(), frameSequence: sequence });
      } else if (packet.type === "configuration" || packet.type === "data") {
        await ensureDecoder().write(packet);
        if (packet.type === "data") {
          sequence += 1;
          publish({ status: "streaming", lastFrameAt: Date.now(), frameSequence: sequence });
        }
      }
    }
    await writer?.close().catch(() => undefined);
    decoder?.dispose();
    if (!closed) publish({ status: "offline", issue: "The live target stream ended." });
  }

  function start(canvasElement: HTMLCanvasElement): void {
    if (closed) return;
    canvas = canvasElement;
    if (streamTask) return;
    controller = new AbortController();
    publish({ status: "connecting" });
    firstFrameTimer = setTimeout(() => {
      if (!closed && current.status === "connecting")
        publish({
          status: "degraded",
          issue: "The device has not sent a preview yet. Connect again to reopen the live view.",
        });
    }, 20_000);
    streamTask = (target.kind === "browser" ? pollBrowser() : streamTarget()).catch(fail);
  }

  async function send(value: LiveTargetInput): Promise<void> {
    if (closed) throw new RecordingInputNotSentError("The live preview is disconnected.");
    if (target.kind === "browser" && (!browserSession || !browserFrame)) {
      throw new RecordingInputNotSentError("Wait for the browser preview to connect.");
    }
    let authoredValue = value;
    if (
      (input.onInteraction || value.kind === "scroll") &&
      target.kind !== "browser" &&
      (value.kind === "touch" || value.kind === "scroll")
    ) {
      if (!canvas?.width || !canvas.height)
        throw new RecordingInputNotSentError("Wait for the live preview to connect.");
      const frameWidth = canvas.width;
      const frameHeight = canvas.height;
      let size: { width?: number; height?: number } | undefined;
      try {
        const snapshot = await input.client.invoke("target.snapshot.capture", {
          serial: target.targetId,
        });
        size = snapshot.bounds;
        // Accessibility can be temporarily unavailable while pixels remain usable.
        if (!size?.width || !size.height) {
          size = await input.client.invoke("target.screenshot.capture", {
            serial: target.targetId,
          });
        }
      } catch {
        throw new RecordingInputNotSentError("Relay couldn’t read the device screen size.");
      }
      if (!size?.width || !size.height) {
        throw new RecordingInputNotSentError("Relay couldn’t read the device screen size.");
      }
      const sx = size.width / frameWidth;
      const sy = size.height / frameHeight;
      authoredValue = {
        ...value,
        x: Math.round(value.x * sx),
        y: Math.round(value.y * sy),
        ...(value.kind === "scroll"
          ? { scrollX: Math.round(value.scrollX * sx), scrollY: Math.round(value.scrollY * sy) }
          : {}),
      };
    }
    const interaction = normalizeInteraction(authoredValue, browserFrame);
    if (input.onInteraction) {
      if (!interaction) {
        throw new RecordingInputNotSentError("Relay does not support recording this input yet.");
      }
      await input.onInteraction(interaction);
      return;
    }
    if (value.kind === "tap") {
      const binding = value.target;
      if (target.kind === "browser") {
        throw new Error("Browser Try must record the semantic binding, not a coordinate click.");
      }
      if (binding.identifier) {
        await input.client.invoke("target.interact", {
          serial: target.targetId,
          kind: "identifier",
          identifier: binding.identifier,
        });
        return;
      }
      if (binding.label) {
        await input.client.invoke("target.interact", {
          serial: target.targetId,
          kind: "label",
          label: binding.label,
        });
        return;
      }
      if (binding.text) {
        await input.client.invoke("target.interact", {
          serial: target.targetId,
          kind: "text-match",
          match: binding.text,
        });
        return;
      }
      throw new Error("This control has no semantic binding to try.");
    }
    if (target.kind === "browser") {
      await input.client.invoke("target.browser-device.control", {
        targetId: target.targetId,
        input: browserPreviewInput(value, browserFrame!),
      });
      return;
    }
    if (value.kind === "touch") {
      if (!canvas?.width || !canvas.height)
        throw new RecordingInputNotSentError("Wait for the live preview to connect.");
      const x = value.x / canvas.width;
      const y = value.y / canvas.height;
      if (value.action === "up") {
        await input.client.invoke("target.touch", {
          serial: target.targetId,
          action: "down",
          x,
          y,
        });
      }
      await input.client.invoke("target.touch", {
        serial: target.targetId,
        action: value.action,
        x,
        y,
      });
    } else if (value.kind === "key" && "text" in value && typeof value.text === "string") {
      await input.client.invoke("target.key", {
        serial: target.targetId,
        kind: "text",
        text: value.text,
      });
    } else if (
      value.kind === "key" &&
      (value.key === "back" || value.key === "home" || value.key === "recents")
    ) {
      await input.client.invoke("target.interact", {
        serial: target.targetId,
        kind: "key",
        key: value.key,
      });
    } else if (value.kind === "key") {
      const key = value.key;
      const mobileKey = key === "Enter" ? "enter" : key === "Backspace" ? "backspace" : key;
      if (mobileKey !== "enter" && mobileKey !== "backspace") {
        throw new Error(`The mobile target does not support ${key}`);
      }
      await input.client.invoke("target.key", {
        serial: target.targetId,
        kind: "key",
        key: mobileKey,
      });
    } else if (value.kind === "scroll") {
      if (!canvas?.width || !canvas.height)
        throw new RecordingInputNotSentError("Wait for the live preview to connect.");
      if (authoredValue.kind !== "scroll") return;
      await input.client.invoke("target.interact", {
        serial: target.targetId,
        kind: "swipe",
        from: { x: authoredValue.x, y: authoredValue.y },
        to: {
          x: authoredValue.x + authoredValue.scrollX,
          y: authoredValue.y + authoredValue.scrollY,
        },
        durationMs: 300,
      });
    }
  }

  return {
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    mount(canvasElement) {
      start(canvasElement);
      return () => {
        if (canvas === canvasElement) canvas = undefined;
      };
    },
    input: send,
    setAccessibilityInspection(enabled) {
      inspectAccessibility = enabled;
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(firstFrameTimer);
      controller?.abort();
      canvas = undefined;
      publish({ status: "closed" });
      listeners.clear();
    },
  };
}

function normalizeInteraction(
  value: LiveTargetInput,
  frame: BrowserDeviceFrame | undefined,
): LiveTargetInteraction | undefined {
  if (value.kind === "tap") {
    return { kind: "tap", target: value.target };
  }
  if (value.kind === "touch") {
    if (value.action !== "up") return undefined;
    return {
      kind: "tap",
      target: pointTarget(value.x, value.y, frame?.width, frame?.height),
    };
  }
  if (value.kind === "scroll") {
    return {
      kind: "swipe",
      from: { x: value.x, y: value.y },
      to: { x: value.x + value.scrollX, y: value.y + value.scrollY },
    };
  }
  if (value.kind === "wheel") {
    return {
      kind: "swipe",
      from: { x: value.x, y: value.y },
      to: { x: value.x + value.deltaX, y: value.y + value.deltaY },
    };
  }
  if (value.kind === "key" && "text" in value && typeof value.text === "string") {
    return { kind: "type", text: value.text };
  }
  if (
    value.kind === "key" &&
    (value.key === "back" || value.key === "home" || value.key === "recents")
  )
    return { kind: "key", key: value.key };
  if (value.kind === "key" && value.key === "enter") {
    return { kind: "device", action: "keyboard-enter" };
  }
  if (value.kind === "key" && (value.key === "Enter" || value.key === "Backspace")) {
    // Enter/backspace are target mutations, not durable authoring key steps.
    // Product recording can still represent them as a typed interaction when
    // a caller supplies the exact intent through its own input adapter.
    return undefined;
  }
  if (value.kind === "click") {
    return {
      kind: "tap",
      target: pointTarget(value.x, value.y, frame?.width, frame?.height),
    };
  }
  if (value.kind === "text") return { kind: "type", text: value.text };
  return undefined;
}

function pointTarget(
  x: number,
  y: number,
  width: number | undefined,
  height: number | undefined,
): StepTarget {
  return {
    point: {
      x: Math.round(x),
      y: Math.round(y),
      ...(width && height ? { referenceBounds: { width, height } } : {}),
      anchor: { horizontal: "left", vertical: "top" },
    },
  };
}

/** Build the same authenticated client used by Product recording from a
 * platform adapter. Kept separate so tests and desktop hosts can inject their
 * existing client without constructing a second authority. */
export async function createLiveTargetSessionFromPlatform(input: {
  platform: Platform;
  target: AuthoringTarget;
  identity?: LiveBrowserOpenIdentity;
}): Promise<LiveTargetSession> {
  const { client } = await productClientForPlatform(input.platform);
  return createLiveTargetSession({
    client,
    target: input.target,
    ...(input.identity ? { identity: input.identity } : {}),
  });
}

/** Translate canvas gestures using the frame the user actually saw. */
export function browserPreviewInput(
  value: LiveTargetInput,
  frame: Pick<BrowserDeviceFrame, "sessionId" | "pageId" | "sequence">,
): BrowserDeviceInput {
  if ("sessionId" in value) return value;
  const binding = {
    sessionId: frame.sessionId,
    pageId: frame.pageId,
    expectedSequence: frame.sequence,
  };
  if (value.kind === "touch" && value.action === "up") {
    return { ...binding, kind: "click", x: value.x, y: value.y };
  }
  if (value.kind === "scroll") {
    return {
      ...binding,
      kind: "wheel",
      x: value.x,
      y: value.y,
      deltaX: -value.scrollX,
      deltaY: -value.scrollY,
    };
  }
  if (value.kind === "key") {
    if (value.text) return { ...binding, kind: "text", text: value.text };
    if (value.key === "enter") return { ...binding, kind: "key", key: "Enter" };
    if (value.key === "backspace") return { ...binding, kind: "key", key: "Backspace" };
    if (value.key === "back") return { ...binding, kind: "history", direction: "back" };
  }
  throw new RecordingInputNotSentError("This gesture is not supported in the browser preview.");
}

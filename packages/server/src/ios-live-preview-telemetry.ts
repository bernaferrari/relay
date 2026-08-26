/**
 * Observability for the iOS Instruments screenshot relay.
 *
 * This module intentionally measures only what Relay sees locally. It never
 * turns an observed packet rate into a device, display, or browser-paint FPS
 * promise, and it never owns a process or touches a target.
 */

/**
 * A screenshot source is useful only while it keeps producing recent pixels.
 * This is a freshness bound, not a target-frame-rate promise.
 */
import type { IosSafePreviewProducerProvenance } from "./ios-preview-producer.js";

export const IOS_PREVIEW_STALE_AFTER_MS = 8_000;

/**
 * Cheap content identity for one observed frame (FNV-1a 32). Relay compares
 * successive fingerprints to tell a stream that is alive but showing an
 * unchanged screen apart from a stream whose frames actually advance. It is
 * deliberately a content hash, not a frame counter: a re-encoded duplicate
 * screen hashes the same, which is exactly the fact consumers need.
 */
export function iosPreviewFrameFingerprint(frame: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < frame.length; index += 1) {
    hash ^= frame[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The small part of ServerResponse needed for bounded latest-frame fanout. */
export type IosFrameSink = {
  write: (chunk: Uint8Array) => boolean;
  once: (event: "drain", listener: () => void) => unknown;
  off?: (event: "drain", listener: () => void) => unknown;
  destroyed?: boolean;
  writableEnded?: boolean;
};

/**
 * Measured from two observed frames, never inferred from an Instruments or
 * device capability. A single frame deliberately has no rate.
 */
export function iosPreviewObservedFramesPerSecond(
  frames: number,
  firstFrameAt: number | undefined,
  lastFrameAt: number | undefined,
): number | undefined {
  if (
    frames < 2 ||
    firstFrameAt === undefined ||
    lastFrameAt === undefined ||
    lastFrameAt <= firstFrameAt
  ) {
    return undefined;
  }
  return ((frames - 1) * 1_000) / (lastFrameAt - firstFrameAt);
}

/** Clock changes must not make an observed frame look younger than zero. */
export function iosPreviewFrameAgeMs(
  lastFrameAt: number | undefined,
  now = Date.now(),
): number | undefined {
  return lastFrameAt === undefined ? undefined : Math.max(0, now - lastFrameAt);
}

export function iosPreviewFrameIsFresh(
  lastFrameAt: number | undefined,
  now = Date.now(),
  staleAfterMs = IOS_PREVIEW_STALE_AFTER_MS,
): boolean {
  return lastFrameAt !== undefined && now - lastFrameAt >= 0 && now - lastFrameAt <= staleAfterMs;
}

/** Values in headers/logs are observations. `unmeasured` is more honest than
 * converting an early single frame into an invented zero-FPS result. */
export function iosPreviewObservedMetric(
  value: number | undefined,
  fallback = "unmeasured",
): string {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return String(Math.round(value * 1_000) / 1_000);
}

export type IosFrameDeliveryDiagnostics = {
  attachedAt: number;
  releasedAt?: number;
  offeredFrames: number;
  /** Frames Relay handed to Node's response buffer. This does not assert that
   * a browser decoded or painted them. */
  writtenFrames: number;
  /** Frames superseded before Relay could write them to this response. */
  droppedFrames: number;
  /** The one newest frame waiting behind Node backpressure, if any. */
  pendingFrames: number;
  /** Measured Relay-response write rate, not a device/source FPS. */
  writtenFramesPerSecond?: number;
  /** Settled drop ratio. A pending latest frame is intentionally excluded. */
  dropRate?: number;
};

export type IosFrameFanoutDiagnostics = {
  subscribers: number;
  publishedFrames: number;
  /** Sum of source-frame offers to every attached Relay response. */
  offeredFrames: number;
  /** Relay response writes, not browser paint acknowledgements. */
  writtenFrames: number;
  /** Frames superseded while a Relay response was backpressured. */
  droppedFrames: number;
  pendingFrames: number;
  /** Measured across Relay response writes, never advertised as source FPS. */
  writtenFramesPerSecond?: number;
  dropRate?: number;
  /**
   * Content fingerprint of the newest published frame. Identical values
   * across observations mean the stream is alive but the screen has not
   * advanced; a changing value proves new pixels reached Relay.
   */
  lastFrameFingerprint?: string;
};

type IosFrameSubscriber = {
  sink: IosFrameSink;
  attachedAt: number;
  releasedAt?: number;
  blocked: boolean;
  pending?: Buffer;
  offeredFrames: number;
  writtenFrames: number;
  droppedFrames: number;
  firstWrittenAt?: number;
  lastWrittenAt?: number;
  onDrain: () => void;
};

export type IosFrameSubscription = {
  release: () => void;
  readonly diagnostics: IosFrameDeliveryDiagnostics;
};

/**
 * Fan a single device source out to Relay clients without allowing one slow
 * HTTP response to queue the capture behind old frames. Node owns at most its
 * current buffered write; Relay retains only the newest frame after that.
 */
export class IosLatestFrameFanout {
  readonly #subscribers = new Map<symbol, IosFrameSubscriber>();
  readonly #now: () => number;
  #publishedFrames = 0;
  #lastFrameFingerprint: string | undefined;
  #latestPacket: Buffer | undefined;
  #offeredFrames = 0;
  #writtenFrames = 0;
  #droppedFrames = 0;
  #firstWrittenAt: number | undefined;
  #lastWrittenAt: number | undefined;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  get diagnostics(): IosFrameFanoutDiagnostics {
    return this.diagnosticsAt();
  }

  diagnosticsAt(): IosFrameFanoutDiagnostics {
    const pendingFrames = [...this.#subscribers.values()].reduce(
      (total, subscriber) => total + (subscriber.pending ? 1 : 0),
      0,
    );
    const rate = this.#rate(this.#writtenFrames, this.#firstWrittenAt, this.#lastWrittenAt);
    const dropRate = this.#dropRate(this.#writtenFrames, this.#droppedFrames);
    return {
      subscribers: this.subscriberCount,
      publishedFrames: this.#publishedFrames,
      offeredFrames: this.#offeredFrames,
      writtenFrames: this.#writtenFrames,
      droppedFrames: this.#droppedFrames,
      pendingFrames,
      ...(rate === undefined ? {} : { writtenFramesPerSecond: rate }),
      ...(dropRate === undefined ? {} : { dropRate }),
      ...(this.#lastFrameFingerprint === undefined
        ? {}
        : { lastFrameFingerprint: this.#lastFrameFingerprint }),
    };
  }

  subscribe(sink: IosFrameSink): () => void {
    return this.subscribeWithDiagnostics(sink).release;
  }

  subscribeWithDiagnostics(sink: IosFrameSink): IosFrameSubscription {
    const token = Symbol("ios-preview-subscriber");
    const subscriber: IosFrameSubscriber = {
      sink,
      attachedAt: this.#now(),
      blocked: false,
      offeredFrames: 0,
      writtenFrames: 0,
      droppedFrames: 0,
      onDrain: () => this.#flush(token),
    };
    this.#subscribers.set(token, subscriber);
    if (this.#latestPacket) this.#offer(token, subscriber, this.#latestPacket);
    const diagnostics = () => this.#subscriberDiagnostics(subscriber);
    return {
      release: () => this.#remove(token, subscriber),
      get diagnostics() {
        return diagnostics();
      },
    };
  }

  /** Packet ownership remains with the source and it must not mutate it after publishing. */
  publish(packet: Buffer): void {
    this.#latestPacket = packet;
    this.#publishedFrames += 1;
    this.#lastFrameFingerprint = iosPreviewFrameFingerprint(packet);
    for (const [token, subscriber] of this.#subscribers) {
      this.#offer(token, subscriber, packet);
    }
  }

  #offer(token: symbol, subscriber: IosFrameSubscriber, packet: Buffer, countOffer = true): void {
    if (this.#subscribers.get(token) !== subscriber) return;
    if (subscriber.sink.destroyed || subscriber.sink.writableEnded) {
      this.#remove(token, subscriber);
      return;
    }
    if (countOffer) {
      subscriber.offeredFrames += 1;
      this.#offeredFrames += 1;
    }
    if (subscriber.blocked) {
      if (subscriber.pending) this.#drop(subscriber);
      subscriber.pending = packet;
      return;
    }
    try {
      const writable = subscriber.sink.write(packet);
      this.#written(subscriber);
      if (!writable) {
        subscriber.blocked = true;
        subscriber.sink.once("drain", subscriber.onDrain);
      }
    } catch {
      this.#drop(subscriber);
      this.#remove(token, subscriber);
    }
  }

  #flush(token: symbol): void {
    const subscriber = this.#subscribers.get(token);
    if (!subscriber) return;
    subscriber.blocked = false;
    const pending = subscriber.pending;
    subscriber.pending = undefined;
    if (pending) this.#offer(token, subscriber, pending, false);
  }

  #remove(token: symbol, subscriber: IosFrameSubscriber): void {
    if (this.#subscribers.get(token) !== subscriber) return;
    this.#subscribers.delete(token);
    if (subscriber.pending) this.#drop(subscriber);
    subscriber.pending = undefined;
    subscriber.releasedAt = this.#now();
    subscriber.sink.off?.("drain", subscriber.onDrain);
  }

  #written(subscriber: IosFrameSubscriber): void {
    const at = this.#now();
    subscriber.writtenFrames += 1;
    subscriber.firstWrittenAt ??= at;
    subscriber.lastWrittenAt = at;
    this.#writtenFrames += 1;
    this.#firstWrittenAt ??= at;
    this.#lastWrittenAt = at;
  }

  #drop(subscriber: IosFrameSubscriber): void {
    subscriber.droppedFrames += 1;
    this.#droppedFrames += 1;
  }

  #subscriberDiagnostics(subscriber: IosFrameSubscriber): IosFrameDeliveryDiagnostics {
    const rate = this.#rate(
      subscriber.writtenFrames,
      subscriber.firstWrittenAt,
      subscriber.lastWrittenAt,
    );
    const dropRate = this.#dropRate(subscriber.writtenFrames, subscriber.droppedFrames);
    return {
      attachedAt: subscriber.attachedAt,
      ...(subscriber.releasedAt === undefined ? {} : { releasedAt: subscriber.releasedAt }),
      offeredFrames: subscriber.offeredFrames,
      writtenFrames: subscriber.writtenFrames,
      droppedFrames: subscriber.droppedFrames,
      pendingFrames: subscriber.pending ? 1 : 0,
      ...(rate === undefined ? {} : { writtenFramesPerSecond: rate }),
      ...(dropRate === undefined ? {} : { dropRate }),
    };
  }

  #rate(
    frames: number,
    firstFrameAt: number | undefined,
    lastFrameAt: number | undefined,
  ): number | undefined {
    return iosPreviewObservedFramesPerSecond(frames, firstFrameAt, lastFrameAt);
  }

  #dropRate(writtenFrames: number, droppedFrames: number): number | undefined {
    const settledFrames = writtenFrames + droppedFrames;
    return settledFrames === 0 ? undefined : droppedFrames / settledFrames;
  }
}

export type IosPreviewSourceState = "starting" | "streaming" | "stopped" | "failed";

export type IosPreviewSourceDiagnostics = {
  state: IosPreviewSourceState;
  startedAt: number;
  readyAt?: number;
  lastFrameAt?: number;
  frames: number;
  bytes: number;
  /** Source-frame rate measured from observed packet intervals. */
  observedFramesPerSecond?: number;
  /** Wall-clock age of the latest observed frame. */
  frameAgeMs?: number;
  /** A source is stale when it cannot currently provide a fresh frame. */
  stale: boolean;
  staleAfterMs: number;
  contentType?: string;
  fanout: IosFrameFanoutDiagnostics;
};

/**
 * Safe diagnostic projection for future MCP/HTTP consumers. It contains no
 * device pixels, tree, process id, local address, command output, or client
 * identity. `targetFramesPerSecond` is deliberately null: Instruments
 * screenshot polling has no target FPS contract Relay can honestly expose.
 */
export type IosLivePreviewDiagnostics = {
  provider: "go-ios-instruments-screenshot";
  deliveryStrategy: "latest-frame";
  targetFramesPerSecond: null;
  active: boolean;
  observedAt: number;
  /** Version proof for the producer currently attached to the Relay source. */
  producer?: IosSafePreviewProducerProvenance;
  source: {
    state: "not-running" | IosPreviewSourceState;
    encoding: "jpeg" | "annex-b" | "unknown";
    observedFrames: number;
    bytes: number;
    observedFramesPerSecond?: number;
    frameAgeMs?: number;
    stale: boolean;
    staleAfterMs: number;
  };
  relay: IosFrameFanoutDiagnostics;
};

export function iosPreviewEncoding(
  contentType: string | undefined,
): "jpeg" | "annex-b" | "unknown" {
  if (!contentType) return "unknown";
  if (/h264|video\/avc|octet-stream/i.test(contentType)) return "annex-b";
  if (/image\/jpe?g|multipart\/x-mixed-replace/i.test(contentType)) return "jpeg";
  return "unknown";
}

/**
 * Stream-start metadata is intentionally small and truthful. A client can
 * tell whether it attached to fresh pixels without mistaking an observed rate
 * for a promised display rate or browser-delivery acknowledgement.
 */
export function iosLivePreviewMetricHeaders(
  mode: "instruments-mjpeg",
  diagnostics: IosPreviewSourceDiagnostics,
): Record<string, string> {
  return {
    "X-Relay-Ios-Preview": mode,
    "X-Relay-Ios-Upstream-Type": (diagnostics.contentType ?? "").slice(0, 80),
    "X-Relay-Ios-Source-Startup-Ms": String(
      (diagnostics.readyAt ?? Date.now()) - diagnostics.startedAt,
    ),
    // Instruments gives Relay frames when it happens to capture them; it does
    // not provide a target FPS. These headers make that distinction visible
    // even to a lightweight raw HTTP client that cannot call the typed reader.
    "X-Relay-Ios-Observed-Source-Fps": iosPreviewObservedMetric(
      diagnostics.observedFramesPerSecond,
    ),
    "X-Relay-Ios-Source-Frame-Age-Ms": iosPreviewObservedMetric(
      diagnostics.frameAgeMs,
      "unavailable",
    ),
    "X-Relay-Ios-Source-Stale": String(diagnostics.stale),
    "X-Relay-Ios-Source-Stale-After-Ms": String(diagnostics.staleAfterMs),
    "X-Relay-Ios-Target-Fps": "unadvertised",
    "X-Relay-Ios-Delivery-Strategy": "latest-frame",
    "X-Relay-Ios-Last-Frame-Fingerprint": diagnostics.fanout.lastFrameFingerprint ?? "unavailable",
  };
}

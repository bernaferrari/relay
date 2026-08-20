import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
import type http from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  goIosTunnelInfoArgs,
  iosLivePreviewUsesStream,
  rememberGoIosTunnelInfoPort,
  readDeviceSetup,
  resolveIosLivePreview,
  type IosLivePreviewBackend,
} from "@relay/core";
import { CORS_HEADERS, HttpError } from "./http.js";
import {
  IOS_PREVIEW_STALE_AFTER_MS,
  IosLatestFrameFanout,
  iosLivePreviewMetricHeaders,
  iosPreviewEncoding,
  iosPreviewFrameAgeMs,
  iosPreviewFrameIsFresh,
  iosPreviewObservedFramesPerSecond,
  iosPreviewObservedMetric,
  type IosFrameSubscription,
  type IosLivePreviewDiagnostics,
  type IosPreviewSourceDiagnostics,
  type IosPreviewSourceState,
} from "./ios-live-preview-telemetry.js";
import { encodeRelayJpegPacket, readMjpegJpegs } from "./ios-live-preview-packets.js";
import {
  resolveSafeIosPreviewProducer,
  safeIosPreviewProducerArgs,
} from "./ios-preview-producer.js";
import {
  IosPreviewOwnerRegistry,
  type IosPreviewOwner,
  type IosPreviewStopReason,
} from "./ios-live-preview-owner-registry.js";

export {
  IOS_PREVIEW_STALE_AFTER_MS,
  IosLatestFrameFanout,
  iosLivePreviewMetricHeaders,
  iosPreviewEncoding,
  iosPreviewFrameAgeMs,
  iosPreviewFrameIsFresh,
  iosPreviewObservedFramesPerSecond,
  iosPreviewObservedMetric,
  type IosFrameDeliveryDiagnostics,
  type IosFrameFanoutDiagnostics,
  type IosFrameSink,
  type IosFrameSubscription,
  type IosLivePreviewDiagnostics,
  type IosPreviewSourceDiagnostics,
  type IosPreviewSourceState,
} from "./ios-live-preview-telemetry.js";
export {
  encodeRelayAnnexBPacket,
  encodeRelayJpegPacket,
  readMjpegJpegs,
} from "./ios-live-preview-packets.js";
export {
  IosPreviewOwnerRegistry,
  type IosPreviewOwner,
  type IosPreviewStopReason,
} from "./ios-live-preview-owner-registry.js";

function defer<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const GO_IOS_TUNNEL_COMMAND_TIMEOUT_MS = 2_000;
const GO_IOS_TUNNEL_READY_TIMEOUT_MS = 12_000;
const GO_IOS_STREAM_START_TIMEOUT_MS = 12_000;
const GO_IOS_START_POLL_MS = 200;
const GO_IOS_PROCESS_STOP_TIMEOUT_MS = 2_000;
const SAFE_IOS_PREVIEW_PROCESS_KILL_TIMEOUT_MS = 2_000;
const IOS_PREVIEW_RESTART_COOLDOWN_MS = 2_000;
const IOS_PREVIEW_IDLE_STOP_MS = 15_000;
const MAX_GO_IOS_COMMAND_OUTPUT_CHARS = 16_000;
const SAFE_IOS_PREVIEW_CONTENT_TYPE = "multipart/x-mixed-replace; boundary=RelayFrame";
const DEFAULT_RELAY_TUNNEL_INFO_PORT = "28100";

type StreamMode = "instruments-mjpeg";

type IosPreviewSourceEnd = {
  state: Extract<IosPreviewSourceState, "stopped" | "failed">;
  error?: Error;
};

/** The safe sidecar has exactly one bounded stdout pipe into Relay. */
type IosPreviewPipe = AsyncIterable<Buffer> & {
  destroy?: (error?: Error) => unknown;
};

class IosPreviewSource {
  readonly fanout = new IosLatestFrameFanout();
  readonly #ready = defer<void>();
  readonly #endedListeners = new Set<(outcome: IosPreviewSourceEnd) => void>();
  readonly #startedAt = Date.now();
  #state: IosPreviewSourceState = "starting";
  #readyAt: number | undefined;
  #lastFrameAt: number | undefined;
  #frames = 0;
  #bytes = 0;
  #contentType: string | undefined;
  #upstream: IosPreviewPipe | undefined;
  #ended: IosPreviewSourceEnd | undefined;
  #stopped = false;
  #staleTimer: ReturnType<typeof setInterval> | undefined;

  get diagnostics(): IosPreviewSourceDiagnostics {
    return this.diagnosticsAt();
  }

  diagnosticsAt(now = Date.now()): IosPreviewSourceDiagnostics {
    const frameAgeMs = iosPreviewFrameAgeMs(this.#lastFrameAt, now);
    const observedFramesPerSecond = iosPreviewObservedFramesPerSecond(
      this.#frames,
      this.#readyAt,
      this.#lastFrameAt,
    );
    return {
      state: this.#state,
      startedAt: this.#startedAt,
      ...(this.#readyAt === undefined ? {} : { readyAt: this.#readyAt }),
      ...(this.#lastFrameAt === undefined ? {} : { lastFrameAt: this.#lastFrameAt }),
      frames: this.#frames,
      bytes: this.#bytes,
      ...(observedFramesPerSecond === undefined ? {} : { observedFramesPerSecond }),
      ...(frameAgeMs === undefined ? {} : { frameAgeMs }),
      stale: !this.isFresh(now),
      staleAfterMs: IOS_PREVIEW_STALE_AFTER_MS,
      ...(this.#contentType ? { contentType: this.#contentType } : {}),
      fanout: this.fanout.diagnostics,
    };
  }

  isFresh(now = Date.now()): boolean {
    return this.#state === "streaming" && iosPreviewFrameIsFresh(this.#lastFrameAt, now);
  }

  onEnded(listener: (outcome: IosPreviewSourceEnd) => void): () => void {
    if (this.#ended) {
      queueMicrotask(() => {
        try {
          listener(this.#ended!);
        } catch {
          // A disconnected client cannot take down the source owner.
        }
      });
      return () => undefined;
    }
    this.#endedListeners.add(listener);
    return () => this.#endedListeners.delete(listener);
  }

  async start(upstream: IosPreviewPipe): Promise<void> {
    void this.#pump(upstream).then(
      () => this.#finish(this.#stopped ? undefined : new Error("safe iOS preview producer ended")),
      (error) => this.#finish(this.#stopped ? undefined : error),
    );
    const timeout = defer<never>();
    const timer = setTimeout(
      () =>
        timeout.reject(
          new Error(
            `safe iOS preview producer did not deliver a frame after ${GO_IOS_STREAM_START_TIMEOUT_MS}ms`,
          ),
        ),
      GO_IOS_STREAM_START_TIMEOUT_MS,
    );
    try {
      await Promise.race([this.#ready.promise, timeout.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#upstream?.destroy?.();
    this.#finish();
  }

  fail(error: unknown): void {
    if (this.#stopped) return;
    this.#upstream?.destroy?.();
    this.#finish(error);
  }

  #accept(packet: Buffer): void {
    const now = Date.now();
    this.#state = "streaming";
    this.#lastFrameAt = now;
    this.#frames += 1;
    this.#bytes += packet.byteLength;
    if (this.#readyAt === undefined) {
      this.#readyAt = now;
      this.#ready.resolve();
      this.#staleTimer = setInterval(
        () => {
          if (!this.#stopped && !this.isFresh()) {
            this.fail(
              new Error(`go-ios MJPEG source became stale after ${IOS_PREVIEW_STALE_AFTER_MS}ms`),
            );
          }
        },
        Math.min(1_000, Math.max(250, Math.floor(IOS_PREVIEW_STALE_AFTER_MS / 4))),
      );
      this.#staleTimer.unref?.();
    }
    this.fanout.publish(packet);
  }

  async #pump(upstream: IosPreviewPipe): Promise<void> {
    this.#upstream = upstream;
    try {
      this.#contentType = SAFE_IOS_PREVIEW_CONTENT_TYPE;
      for await (const jpeg of readMjpegJpegs(upstream)) {
        if (this.#stopped) return;
        const elapsedNs = BigInt(Date.now() - this.#startedAt) * 1_000_000n;
        this.#accept(encodeRelayJpegPacket(jpeg, elapsedNs));
      }
    } finally {
      if (this.#upstream === upstream) this.#upstream = undefined;
      upstream.destroy?.();
    }
  }

  #finish(error?: unknown): void {
    if (this.#ended) return;
    if (this.#staleTimer) {
      clearInterval(this.#staleTimer);
      this.#staleTimer = undefined;
    }
    const normalized = error === undefined ? undefined : new Error(errorMessage(error));
    this.#state = normalized ? "failed" : "stopped";
    this.#ended = normalized ? { state: "failed", error: normalized } : { state: "stopped" };
    if (this.#readyAt === undefined) {
      this.#ready.reject(
        normalized ?? new Error("iOS preview stopped before its first frame arrived"),
      );
    }
    for (const listener of this.#endedListeners) {
      try {
        listener(this.#ended);
      } catch {
        // A disconnected client cannot take down the source owner.
      }
    }
    this.#endedListeners.clear();
  }
}

type ActiveIosPreview = IosPreviewOwner & {
  serial: string;
  mode: StreamMode;
  child: ChildProcess;
  source: IosPreviewSource;
  stop: (reason?: IosPreviewStopReason) => Promise<boolean>;
  idleTimer?: ReturnType<typeof setTimeout>;
};

type ActiveGoIosTunnel = {
  child: ChildProcess;
  stop: () => Promise<boolean>;
};

const activePreviews = new IosPreviewOwnerRegistry<ActiveIosPreview>();
const stoppingPreviews = new Map<string, ActiveIosPreview>();
const failedPreviews = new Map<string, { failedAt: number; message: string }>();
let activeTunnel: ActiveGoIosTunnel | null = null;
let tunnelStartup: Promise<void> | null = null;

function repoRootFromHere(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..");
}

export async function resolveGoIosBinary(): Promise<string> {
  const fromEnv = process.env.RELAY_GO_IOS_BIN?.trim() || process.env.GO_IOS_BIN?.trim();
  const candidates = [
    ...(fromEnv ? [fromEnv] : []),
    join(repoRootFromHere(), "vendor", "go-ios", "bin", "ios"),
    "ios",
    "go-ios",
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === "ios" || candidate === "go-ios") continue;
    const path = isAbsolute(candidate) ? candidate : join(process.cwd(), candidate);
    try {
      await access(path);
      return path;
    } catch {
      // Try the next configured candidate.
    }
  }
  return fromEnv || join(repoRootFromHere(), "vendor", "go-ios", "bin", "ios");
}

export async function readIosLivePreviewBackend(): Promise<IosLivePreviewBackend> {
  const setup = await readDeviceSetup();
  return resolveIosLivePreview(setup).backend;
}

function appendCommandOutput(current: string, chunk: unknown): string {
  const next = current + String(chunk);
  return next.length <= MAX_GO_IOS_COMMAND_OUTPUT_CHARS
    ? next
    : next.slice(-MAX_GO_IOS_COMMAND_OUTPUT_CHARS);
}

async function runGoIos(
  bin: string,
  args: string[],
  options?: { timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout = appendCommandOutput(stdout, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendCommandOutput(stderr, chunk);
  });
  const done = defer<number | null>();
  child.once("error", (error) => done.reject(error));
  child.once("exit", (code) => done.resolve(code));
  const timeoutMs = options?.timeoutMs ?? 12_000;
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    done.reject(new Error(`go-ios ${args.join(" ")} timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    const code = await done.promise;
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

function tunnelListingLooksReady(listed: string): boolean {
  return /"udid"\s*:/.test(listed) || /userspaceTun/.test(listed) || /rsdPort/.test(listed);
}

async function hasGoIosTunnel(bin: string, tunnelInfoArgs: readonly string[]): Promise<boolean> {
  const result = await runGoIos(bin, ["tunnel", "ls", ...tunnelInfoArgs], {
    timeoutMs: GO_IOS_TUNNEL_COMMAND_TIMEOUT_MS,
  });
  return tunnelListingLooksReady(`${result.stdout}\n${result.stderr}`);
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return true;
  const done = defer<boolean>();
  const onExit = () => done.resolve(true);
  child.once("exit", onExit);
  const timer = setTimeout(() => done.resolve(false), timeoutMs);
  try {
    return await done.promise;
  } finally {
    clearTimeout(timer);
    child.off("exit", onExit);
  }
}

async function stopChild(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.pid === undefined) return true;
  child.kill("SIGTERM");
  return waitForChildExit(child, GO_IOS_PROCESS_STOP_TIMEOUT_MS);
}

/** The pixel-only sidecar has no shared tunnel state, so a stuck exit can be killed safely. */
async function stopSafePreviewProducer(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.pid === undefined) return true;
  child.kill("SIGTERM");
  if (await waitForChildExit(child, GO_IOS_PROCESS_STOP_TIMEOUT_MS)) return true;
  child.kill("SIGKILL");
  return waitForChildExit(child, SAFE_IOS_PREVIEW_PROCESS_KILL_TIMEOUT_MS);
}

function pipeGoIosLog(
  child: ChildProcess,
  logPath: string,
  options: { includeStdout?: boolean } = {},
): void {
  const log = createWriteStream(logPath, { flags: "a" });
  // A diagnostic-log failure must not crash the stream owner.
  log.on("error", () => undefined);
  if (options.includeStdout !== false) child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const closeLog = () => log.end();
  child.once("exit", closeLog);
  child.once("error", closeLog);
}

async function startGoIosTunnel(bin: string, tunnelInfoArgs: readonly string[]): Promise<void> {
  const child = spawn(bin, ["tunnel", "start", "--userspace", ...tunnelInfoArgs], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ENABLE_GO_IOS_AGENT: process.env.ENABLE_GO_IOS_AGENT || "user" },
  });
  pipeGoIosLog(child, join(tmpdir(), "relay-go-ios-tunnel.log"));
  let tunnel!: ActiveGoIosTunnel;
  tunnel = {
    child,
    async stop() {
      const stopped = await stopChild(child);
      if (stopped && activeTunnel === tunnel) activeTunnel = null;
      return stopped;
    },
  };
  let startupError: Error | undefined;
  child.once("error", (error) => {
    startupError = error;
  });
  child.once("exit", () => {
    if (activeTunnel === tunnel) activeTunnel = null;
  });
  activeTunnel = tunnel;

  const deadline = Date.now() + GO_IOS_TUNNEL_READY_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (startupError) {
      const stopped = await tunnel.stop();
      throw new HttpError(
        502,
        `go-ios tunnel failed to start: ${startupError.message}${stopped ? "" : "; process is still stopping"}`,
      );
    }
    if (child.exitCode !== null) {
      throw new HttpError(
        502,
        "go-ios tunnel exited before ready. On iOS 17+ run: vendor/go-ios/bin/ios tunnel start --userspace",
      );
    }
    try {
      if (await hasGoIosTunnel(bin, tunnelInfoArgs)) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(GO_IOS_START_POLL_MS);
  }
  const stopped = await tunnel.stop();
  throw new HttpError(
    502,
    `go-ios tunnel did not become ready (${errorMessage(lastError)}${stopped ? "" : "; process is still stopping"})`,
  );
}

async function ensureGoIosTunnel(bin: string, tunnelInfoArgs: readonly string[]): Promise<void> {
  if (tunnelStartup) return tunnelStartup;
  try {
    if (await hasGoIosTunnel(bin, tunnelInfoArgs)) return;
  } catch {
    // Start a local userspace tunnel below.
  }
  if (tunnelStartup) return tunnelStartup;

  const previous = activeTunnel;
  if (previous) {
    const stopped = await previous.stop();
    if (!stopped) {
      throw new HttpError(
        503,
        "The previous go-ios tunnel is still stopping; retry once it exits.",
      );
    }
  }
  if (tunnelStartup) return tunnelStartup;

  const startup = startGoIosTunnel(bin, tunnelInfoArgs);
  tunnelStartup = startup;
  void startup.then(
    () => {
      if (tunnelStartup === startup) tunnelStartup = null;
    },
    () => {
      if (tunnelStartup === startup) tunnelStartup = null;
    },
  );
  return startup;
}

async function relayTunnelInfoArgs(): Promise<string[]> {
  await rememberGoIosTunnelInfoPort();
  const remembered = goIosTunnelInfoArgs();
  return remembered.length > 0
    ? remembered
    : ["--tunnel-info-port", DEFAULT_RELAY_TUNNEL_INFO_PORT];
}

function previewStillLive(preview: ActiveIosPreview, now = Date.now()): boolean {
  return preview.child.exitCode === null && preview.source.isFresh(now);
}

/**
 * Read the current iOS relay state without starting, stopping, probing, or
 * otherwise touching the device. The projection is deliberately metadata
 * only, so an agent can distinguish a slow source from a slow viewer without
 * acquiring the exclusive input lease or receiving another consumer's data.
 */
export function readIosLivePreviewDiagnostics(
  serial: string,
  observedAt = Date.now(),
): IosLivePreviewDiagnostics {
  const active = activePreviews.get(serial);
  const preview = active ?? stoppingPreviews.get(serial);
  if (!preview) {
    return {
      provider: "go-ios-instruments-screenshot",
      deliveryStrategy: "latest-frame",
      targetFramesPerSecond: null,
      active: false,
      observedAt,
      source: {
        state: "not-running",
        encoding: "unknown",
        observedFrames: 0,
        bytes: 0,
        stale: true,
        staleAfterMs: IOS_PREVIEW_STALE_AFTER_MS,
      },
      relay: {
        subscribers: 0,
        publishedFrames: 0,
        offeredFrames: 0,
        writtenFrames: 0,
        droppedFrames: 0,
        pendingFrames: 0,
      },
    };
  }

  const source = preview.source.diagnosticsAt(observedAt);
  return {
    provider: "go-ios-instruments-screenshot",
    deliveryStrategy: "latest-frame",
    targetFramesPerSecond: null,
    active: active === preview && previewStillLive(preview, observedAt),
    observedAt,
    source: {
      state: source.state,
      encoding: iosPreviewEncoding(source.contentType),
      observedFrames: source.frames,
      bytes: source.bytes,
      ...(source.observedFramesPerSecond === undefined
        ? {}
        : { observedFramesPerSecond: source.observedFramesPerSecond }),
      ...(source.frameAgeMs === undefined ? {} : { frameAgeMs: source.frameAgeMs }),
      stale: source.stale,
      staleAfterMs: source.staleAfterMs,
    },
    relay: source.fanout,
  };
}

async function awaitStoppingPreview(serial: string): Promise<void> {
  const preview = stoppingPreviews.get(serial);
  if (!preview) return;
  const stopped = await preview.stop();
  if (!stopped) {
    throw new HttpError(503, "The previous iOS preview is still stopping; retry once it exits.");
  }
}

function throwIfPreviewCoolingDown(serial: string): void {
  const failure = failedPreviews.get(serial);
  if (!failure) return;
  const remaining = failure.failedAt + IOS_PREVIEW_RESTART_COOLDOWN_MS - Date.now();
  if (remaining <= 0) {
    failedPreviews.delete(serial);
    return;
  }
  throw new HttpError(
    503,
    `iOS preview is cooling down after a failed source (${failure.message}); retry once after ${remaining}ms.`,
  );
}

function rememberPreviewFailure(serial: string, error: unknown): void {
  const failure = { failedAt: Date.now(), message: errorMessage(error) };
  failedPreviews.set(serial, failure);
  const cleanup = setTimeout(() => {
    if (failedPreviews.get(serial) === failure) failedPreviews.delete(serial);
  }, IOS_PREVIEW_RESTART_COOLDOWN_MS);
  cleanup.unref?.();
}

function cancelIdleStop(preview: ActiveIosPreview): void {
  if (!preview.idleTimer) return;
  clearTimeout(preview.idleTimer);
  preview.idleTimer = undefined;
}

function scheduleIdleStop(preview: ActiveIosPreview): void {
  if (preview.idleTimer || preview.source.fanout.subscriberCount > 0) return;
  preview.idleTimer = setTimeout(() => {
    preview.idleTimer = undefined;
    if (preview.source.fanout.subscriberCount === 0) void preview.stop("idle");
  }, IOS_PREVIEW_IDLE_STOP_MS);
  preview.idleTimer.unref?.();
}

async function startInstrumentsMjpeg(bin: string, serial: string): Promise<ActiveIosPreview> {
  const startedAt = Date.now();
  // Fail before touching a tunnel or target if this machine has not built the
  // reviewed producer. The missing-binary diagnosis is actionable and must
  // never trigger an unsafe go-ios streaming fallback.
  const producer = await resolveSafeIosPreviewProducer();
  const tunnelInfoArgs = await relayTunnelInfoArgs();
  await ensureGoIosTunnel(bin, tunnelInfoArgs);
  const tunnelReadyMs = Date.now() - startedAt;
  const logPath = join(tmpdir(), `relay-ios-preview-${serial.slice(0, 8)}.log`);
  const child = spawn(producer, safeIosPreviewProducerArgs(serial, tunnelInfoArgs), {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  // stdout is the image pipe. Writing it into diagnostic logs would compete
  // with Relay's only consumer and duplicate private pixels on disk.
  pipeGoIosLog(child, logPath, { includeStdout: false });
  if (!child.stdout) {
    child.kill("SIGTERM");
    throw new HttpError(502, "Safe iOS preview producer did not expose a pixel pipe.");
  }
  const source = new IosPreviewSource();
  let preview!: ActiveIosPreview;
  let stopped = false;
  let stopPromise: Promise<boolean> | undefined;

  const stop = async (reason: IosPreviewStopReason = "shutdown"): Promise<boolean> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    cancelIdleStop(preview);
    source.stop();
    stoppingPreviews.set(serial, preview);
    stopPromise = stopSafePreviewProducer(child).then((exited) => {
      if (exited) {
        activePreviews.release(serial, preview);
        if (stoppingPreviews.get(serial) === preview) stoppingPreviews.delete(serial);
      }
      return exited;
    });
    void stopPromise.then((exited) => {
      const diagnostics = source.diagnostics;
      console.log(
        `[video] iOS source stopped serial=${serial} mode=instruments-mjpeg reason=${reason} exited=${exited} observedFrames=${diagnostics.frames} observedSourceFps=${iosPreviewObservedMetric(diagnostics.observedFramesPerSecond)} frameAgeMs=${iosPreviewObservedMetric(diagnostics.frameAgeMs)} stale=${diagnostics.stale} bytes=${diagnostics.bytes} relayWrittenFrames=${diagnostics.fanout.writtenFrames} relayDroppedFrames=${diagnostics.fanout.droppedFrames} durationMs=${Date.now() - startedAt}`,
      );
    });
    return stopPromise;
  };
  preview = { serial, mode: "instruments-mjpeg", child, source, stop };

  child.once("exit", (code, signal) => {
    activePreviews.release(serial, preview);
    if (stoppingPreviews.get(serial) === preview) stoppingPreviews.delete(serial);
    if (!stopped) {
      source.fail(
        new Error(
          `safe iOS preview producer exited code=${code ?? "null"} signal=${signal ?? "none"}`,
        ),
      );
    }
  });
  child.once("error", (error) => source.fail(error));
  source.onEnded((outcome) => {
    if (!stopped && outcome.error) {
      rememberPreviewFailure(serial, outcome.error);
      console.warn(
        `[video] iOS source failed serial=${serial} mode=instruments-mjpeg producer=safe-sidecar error=${outcome.error.message}`,
      );
    }
    if (!stopped) void stop(outcome.error ? "upstream-ended" : "shutdown");
  });

  try {
    await source.start(child.stdout as IosPreviewPipe);
    const diagnostics = source.diagnostics;
    console.log(
      `[video] iOS source ready serial=${serial} mode=instruments-mjpeg producer=safe-sidecar tunnelReadyMs=${tunnelReadyMs} firstFrameMs=${(diagnostics.readyAt ?? Date.now()) - startedAt} startupMs=${Date.now() - startedAt} sourceEncoding=${iosPreviewEncoding(diagnostics.contentType)} targetFps=unadvertised`,
    );
    return preview;
  } catch (error) {
    rememberPreviewFailure(serial, error);
    const exited = await stop("startup-failed");
    throw new HttpError(
      502,
      `Safe Instruments preview failed (${errorMessage(error)}). Log: ${logPath}${exited ? "" : "; producer is still stopping"}`,
    );
  }
}

async function ensureIosPreview(
  serial: string,
  backend: IosLivePreviewBackend,
): Promise<ActiveIosPreview> {
  if (backend === "agent-device-png") {
    throw new HttpError(400, "PNG preview does not use the live stream route");
  }
  await awaitStoppingPreview(serial);
  return activePreviews.acquire(serial, previewStillLive, async () => {
    throwIfPreviewCoolingDown(serial);
    const bin = await resolveGoIosBinary();
    const preview = await startInstrumentsMjpeg(bin, serial);
    failedPreviews.delete(serial);
    return preview;
  });
}

/**
 * Stream iOS live preview as Relay framed packets on /device/stream.
 * Pixels come from the go-ios source only; this path never initializes or
 * waits for XCTest accessibility control.
 */
export async function streamIosGoIosMjpeg(res: http.ServerResponse, serial: string): Promise<void> {
  const backend = await readIosLivePreviewBackend();
  if (!iosLivePreviewUsesStream(backend)) {
    throw new HttpError(
      409,
      "iOS live stream is disabled. Choose a go-ios preview mode in Device settings.",
    );
  }

  let disconnected = res.destroyed;
  const beforeReadyClose = () => {
    disconnected = true;
  };
  res.once("close", beforeReadyClose);
  const requestStartedAt = Date.now();
  const preview = await ensureIosPreview(serial, backend);
  if (disconnected || res.destroyed || res.writableEnded) return;
  if (!previewStillLive(preview)) {
    void preview.stop("stale");
    throw new HttpError(
      503,
      "iOS preview became stale before the Relay client attached; retry once.",
    );
  }

  cancelIdleStop(preview);
  res.off("close", beforeReadyClose);
  const diagnostics = preview.source.diagnostics;
  res.writeHead(200, {
    ...CORS_HEADERS,
    "Content-Type": "application/x-relay-h264",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
    ...iosLivePreviewMetricHeaders(preview.mode, diagnostics),
  });

  const completion = defer<void>();
  const clientAttachedAt = Date.now();
  let closed = false;
  let frameSubscription: IosFrameSubscription | undefined;
  let removeSourceEndListener: () => void = () => undefined;
  const finish = (reason: "client-closed" | "source-ended") => {
    if (closed) return;
    closed = true;
    res.off("close", onClose);
    frameSubscription?.release();
    removeSourceEndListener();
    if (preview.source.fanout.subscriberCount === 0 && previewStillLive(preview)) {
      scheduleIdleStop(preview);
    }
    const delivery = frameSubscription?.diagnostics;
    console.log(
      `[video] iOS client detached serial=${serial} mode=${preview.mode} reason=${reason} clientDurationMs=${Date.now() - clientAttachedAt} subscribers=${preview.source.fanout.subscriberCount} relayWrittenFrames=${delivery?.writtenFrames ?? 0} relayDroppedFrames=${delivery?.droppedFrames ?? 0} relayPendingFrames=${delivery?.pendingFrames ?? 0} relayWriteFps=${iosPreviewObservedMetric(delivery?.writtenFramesPerSecond)} relayDropRate=${iosPreviewObservedMetric(delivery?.dropRate)}`,
    );
    completion.resolve();
  };
  const onClose = () => finish("client-closed");
  frameSubscription = preview.source.fanout.subscribeWithDiagnostics(res);
  removeSourceEndListener = preview.source.onEnded(() => {
    if (!res.destroyed && !res.writableEnded) res.end();
    finish("source-ended");
  });
  res.once("close", onClose);
  console.log(
    `[video] iOS client attached serial=${serial} mode=${preview.mode} startupWaitMs=${clientAttachedAt - requestStartedAt} subscribers=${preview.source.fanout.subscriberCount}`,
  );
  return completion.promise;
}

export function stopAllIosLivePreviews(): void {
  for (const preview of [...activePreviews.values(), ...stoppingPreviews.values()]) {
    void preview.stop("shutdown");
  }
  if (activeTunnel) void activeTunnel.stop();
}

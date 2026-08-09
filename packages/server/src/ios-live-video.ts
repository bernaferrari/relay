import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  iosLivePreviewUsesStream,
  readDeviceSetup,
  resolveIosLivePreview,
  type IosLivePreviewBackend,
} from "@relay/core";
import { HttpError } from "./http.js";

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

const PACKET_HEADER_BYTES = 16;
const DEFAULT_MJPEG_BASE_PORT = 3333;

type StreamMode = "instruments-mjpeg";

type ActiveIosPreview = {
  serial: string;
  mode: StreamMode;
  child?: ChildProcess;
  port?: number;
  baseUrl?: string;
  stop: () => void;
};

const activePreviews = new Map<string, ActiveIosPreview>();
let activeTunnel: { child: ChildProcess; stop: () => void } | null = null;

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
      // try next
    }
  }
  return fromEnv || join(repoRootFromHere(), "vendor", "go-ios", "bin", "ios");
}

export async function readIosLivePreviewBackend(): Promise<IosLivePreviewBackend> {
  const setup = await readDeviceSetup();
  return resolveIosLivePreview(setup).backend;
}

async function allocateMjpegPort(): Promise<number> {
  const preferred = Number(process.env.RELAY_GO_IOS_MJPEG_PORT || DEFAULT_MJPEG_BASE_PORT);
  const base = Number.isFinite(preferred) ? Math.floor(preferred) : DEFAULT_MJPEG_BASE_PORT;
  const net = await import("node:net");
  for (let offset = 0; offset < 80; offset++) {
    const port = base + offset;
    const freeWait = defer<boolean>();
    const server = net.createServer();
    server.unref();
    server.once("error", () => freeWait.resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => freeWait.resolve(true));
    });
    const free = await freeWait.promise;
    if (free) return port;
  }
  throw new HttpError(500, "No free local port for go-ios MJPEG");
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
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
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

async function ensureGoIosTunnel(bin: string): Promise<void> {
  const listTunnels = async (): Promise<string> => {
    const result = await runGoIos(bin, ["tunnel", "ls"], { timeoutMs: 8_000 });
    return `${result.stdout}\n${result.stderr}`;
  };
  const tunnelReady = (listed: string) =>
    /"udid"\s*:/.test(listed) || /userspaceTun/.test(listed) || /rsdPort/.test(listed);

  try {
    if (tunnelReady(await listTunnels())) return;
  } catch {
    // start below
  }

  if (!activeTunnel || activeTunnel.child.exitCode !== null) {
    const child = spawn(bin, ["tunnel", "start", "--userspace", "--tunnel-info-port", "28100"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ENABLE_GO_IOS_AGENT: process.env.ENABLE_GO_IOS_AGENT || "user" },
    });
    const logPath = join(tmpdir(), "relay-go-ios-tunnel.log");
    const log = createWriteStream(logPath, { flags: "a" });
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    const stop = () => {
      if (activeTunnel?.child === child) activeTunnel = null;
      if (!child.killed) child.kill("SIGTERM");
    };
    child.once("exit", () => {
      if (activeTunnel?.child === child) activeTunnel = null;
    });
    activeTunnel = { child, stop };
  }

  const deadline = Date.now() + 18_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (activeTunnel?.child.exitCode != null) {
      throw new HttpError(
        502,
        "go-ios tunnel exited before ready. On iOS 17+ run: vendor/go-ios/bin/ios tunnel start --userspace",
      );
    }
    try {
      if (tunnelReady(await listTunnels())) {
        const settle = defer<void>();
        setTimeout(settle.resolve, 1_200);
        await settle.promise;
        return;
      }
    } catch (error) {
      lastError = error;
    }
    const delay = defer<void>();
    setTimeout(delay.resolve, 400);
    await delay.promise;
  }
  throw new HttpError(
    502,
    `go-ios tunnel did not become ready (${lastError instanceof Error ? lastError.message : String(lastError)})`,
  );
}

async function httpOk(url: string, timeoutMs = 1_500): Promise<boolean> {
  const wait = defer<boolean>();
  const req = http.get(url, (res) => {
    res.resume();
    wait.resolve((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 500);
  });
  req.setTimeout(timeoutMs, () => {
    req.destroy(new Error("timeout"));
  });
  req.on("error", () => wait.resolve(false));
  return wait.promise;
}

async function waitHttpServer(url: string, child: ChildProcess, logPath: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new HttpError(502, `go-ios stream process exited (see ${logPath})`);
    }
    try {
      if (await httpOk(url, 1_200)) return;
      lastError = new Error("not ready");
    } catch (error) {
      lastError = error;
    }
    const delay = defer<void>();
    setTimeout(delay.resolve, 300);
    await delay.promise;
  }
  throw new HttpError(
    502,
    `go-ios stream did not become ready (${lastError instanceof Error ? lastError.message : String(lastError)}). Log: ${logPath}`,
  );
}

async function startInstrumentsMjpeg(bin: string, serial: string): Promise<ActiveIosPreview> {
  await ensureGoIosTunnel(bin);
  const port = await allocateMjpegPort();
  const logPath = join(tmpdir(), `relay-go-ios-${serial.slice(0, 8)}.log`);
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    const child = spawn(bin, ["screenshot", "--udid", serial, "--stream", "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    const log = createWriteStream(logPath, { flags: "a" });
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    const stop = () => {
      activePreviews.delete(serial);
      if (!child.killed) child.kill("SIGTERM");
    };
    child.once("exit", () => {
      if (activePreviews.get(serial)?.child === child) activePreviews.delete(serial);
    });
    const preview: ActiveIosPreview = {
      serial,
      mode: "instruments-mjpeg",
      child,
      port,
      stop,
    };
    activePreviews.set(serial, preview);
    try {
      await waitHttpServer(`http://127.0.0.1:${port}/`, child, logPath);
      return preview;
    } catch (error) {
      lastError = error;
      stop();
      const backoff = defer<void>();
      setTimeout(backoff.resolve, 900);
      await backoff.promise;
    }
  }
  throw new HttpError(
    502,
    `Instruments MJPEG failed (${lastError instanceof Error ? lastError.message : String(lastError)}). Log: ${logPath}`,
  );
}

async function previewStillLive(preview: ActiveIosPreview): Promise<boolean> {
  if (preview.child && preview.child.exitCode != null) return false;
  if (preview.mode === "instruments-mjpeg" && preview.port) {
    return httpOk(`http://127.0.0.1:${preview.port}/`, 800);
  }
  return false;
}

async function ensureIosPreview(
  serial: string,
  backend: IosLivePreviewBackend,
): Promise<ActiveIosPreview> {
  const existing = activePreviews.get(serial);
  if (existing) {
    if (await previewStillLive(existing)) return existing;
    existing.stop();
    activePreviews.delete(serial);
  }

  const bin = await resolveGoIosBinary();
  if (backend === "agent-device-png") {
    throw new HttpError(400, "PNG preview does not use the live stream route");
  }
  return startInstrumentsMjpeg(bin, serial);
}

/** Encode one JPEG as Relay framed packet (kind 2). */
export function encodeRelayJpegPacket(jpeg: Uint8Array, ptsNs = 0n): Buffer {
  const header = Buffer.allocUnsafe(PACKET_HEADER_BYTES);
  header.writeUInt8(2, 0);
  header.writeUInt8(1, 1);
  header.writeUInt16BE(0, 2);
  header.writeBigUInt64BE(ptsNs, 4);
  header.writeUInt32BE(jpeg.byteLength, 12);
  return Buffer.concat([header, Buffer.from(jpeg)]);
}

/** Encode raw H.264 access unit / annex-B chunk (kind 3). Client may ignore if undecodable. */
export function encodeRelayAnnexBPacket(data: Uint8Array, ptsNs = 0n, keyframe = false): Buffer {
  const header = Buffer.allocUnsafe(PACKET_HEADER_BYTES);
  header.writeUInt8(3, 0);
  header.writeUInt8(keyframe ? 1 : 0, 1);
  header.writeUInt16BE(0, 2);
  header.writeBigUInt64BE(ptsNs, 4);
  header.writeUInt32BE(data.byteLength, 12);
  return Buffer.concat([header, Buffer.from(data)]);
}

export async function* readMjpegJpegs(
  body: AsyncIterable<Buffer>,
): AsyncGenerator<Buffer, void, void> {
  let buffer = Buffer.alloc(0);
  const boundaryMarkers = [
    Buffer.from("--BoundaryString"),
    Buffer.from("--ffmpeg"),
    Buffer.from("--frame"),
  ];
  for await (const chunk of body) {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerSep = buffer.indexOf("\r\n\r\n");
      if (headerSep < 0) break;
      const header = buffer.subarray(0, headerSep).toString("latin1");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        // Some servers use multipart without Content-Length: scan SOI/EOI.
        const soi = buffer.indexOf(Buffer.from([0xff, 0xd8]), headerSep + 4);
        if (soi < 0) {
          buffer = buffer.subarray(Math.max(0, buffer.length - 1));
          break;
        }
        const eoi = buffer.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
        if (eoi < 0) break;
        const jpeg = Buffer.from(buffer.subarray(soi, eoi + 2));
        buffer = buffer.subarray(eoi + 2);
        yield jpeg;
        continue;
      }
      const length = Number(lengthMatch[1]);
      const start = headerSep + 4;
      const end = start + length;
      if (buffer.length < end) break;
      const jpeg = Buffer.from(buffer.subarray(start, end));
      buffer = buffer.subarray(end);
      if (buffer.subarray(0, 2).equals(Buffer.from("\r\n"))) buffer = buffer.subarray(2);
      for (const marker of boundaryMarkers) {
        if (buffer.subarray(0, marker.length).equals(marker)) {
          const nl = buffer.indexOf("\n");
          buffer = nl >= 0 ? buffer.subarray(nl + 1) : Buffer.alloc(0);
          break;
        }
      }
      if (jpeg.length > 2 && jpeg[0] === 0xff && jpeg[1] === 0xd8) yield jpeg;
    }
  }
}

async function openUpstream(url: string): Promise<http.IncomingMessage> {
  const wait = defer<http.IncomingMessage>();
  const req = http.get(url, (response) => wait.resolve(response));
  req.setTimeout(6_000, () => req.destroy(new Error("upstream connect timeout")));
  req.on("error", wait.reject);
  return wait.promise;
}

/**
 * Stream iOS live preview as Relay framed packets on /device/stream.
 * kind 2 = JPEG, kind 3 = annex-B H.264 chunk (best-effort).
 */
export async function streamIosGoIosMjpeg(res: http.ServerResponse, serial: string): Promise<void> {
  const backend = await readIosLivePreviewBackend();
  if (!iosLivePreviewUsesStream(backend)) {
    throw new HttpError(
      409,
      "iOS live stream is disabled. Choose a go-ios preview mode in Device settings.",
    );
  }

  let preview = await ensureIosPreview(serial, backend);
  let disconnected = false;
  res.once("close", () => {
    disconnected = true;
  });

  const resolveUpstreamUrl = (item: ActiveIosPreview) =>
    item.mode === "instruments-mjpeg" ? `http://127.0.0.1:${item.port}/` : item.baseUrl!;

  let upstream: http.IncomingMessage;
  try {
    upstream = await openUpstream(resolveUpstreamUrl(preview));
  } catch {
    preview.stop();
    activePreviews.delete(serial);
    preview = await ensureIosPreview(serial, backend);
    upstream = await openUpstream(resolveUpstreamUrl(preview));
  }
  if ((upstream.statusCode ?? 500) >= 400) {
    upstream.resume();
    throw new HttpError(502, `iOS preview upstream returned ${upstream.statusCode}`);
  }

  const contentType = String(upstream.headers["content-type"] || "");
  res.writeHead(200, {
    "Content-Type": "application/x-relay-h264",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Connection: "keep-alive",
    "X-Relay-Ios-Preview": preview.mode,
    "X-Relay-Ios-Upstream-Type": contentType.slice(0, 80),
  });

  const started = Date.now();
  let frames = 0;
  try {
    if (/h264|video\/avc|octet-stream/i.test(contentType)) {
      // Raw annex-B / length-prefixed stream: forward chunks as kind 3.
      for await (const chunk of upstream as AsyncIterable<Buffer>) {
        if (disconnected || res.destroyed || res.writableEnded) break;
        if (!chunk.length) continue;
        const pts = BigInt(Date.now() - started) * 1_000_000n;
        const keyframe = chunk.includes(Buffer.from([0, 0, 0, 1, 0x67])) || chunk[4] === 0x67;
        const packet = encodeRelayAnnexBPacket(chunk, pts, keyframe);
        if (!res.write(packet)) {
          const drained = defer<void>();
          res.once("drain", drained.resolve);
          await drained.promise;
        }
        frames += 1;
      }
    } else {
      for await (const jpeg of readMjpegJpegs(upstream as AsyncIterable<Buffer>)) {
        if (disconnected || res.destroyed || res.writableEnded) break;
        const pts = BigInt(Date.now() - started) * 1_000_000n;
        const packet = encodeRelayJpegPacket(jpeg, pts);
        if (!res.write(packet)) {
          const drained = defer<void>();
          res.once("drain", drained.resolve);
          await drained.promise;
        }
        frames += 1;
      }
    }
  } finally {
    upstream.destroy();
    if (!res.destroyed && !res.writableEnded) res.end();
    console.log(
      `[video] iOS ${preview.mode} stopped serial=${serial} frames=${frames} durationMs=${Date.now() - started}`,
    );
  }
}

export function stopAllIosLivePreviews(): void {
  for (const preview of activePreviews.values()) preview.stop();
  activePreviews.clear();
  activeTunnel?.stop();
  activeTunnel = null;
}

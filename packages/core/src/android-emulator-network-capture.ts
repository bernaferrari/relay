import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { AndroidNetworkEvidenceSummary } from "@relay/protocol";
import { parseAndroidNetworkEvidenceSummary } from "@relay/protocol";
import { execAndroidAdb } from "./android-adb-host.js";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";

const execFileAsync = promisify(execFile);
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 5_000;
const MAX_PARSED_PACKETS = 100_000;
type CaptureOwnership = {
  runId: string;
  state: "starting" | "running" | "stopping";
};
const activeCaptures = new Map<string, CaptureOwnership>();
const RELAY_CAPTURE_FILE = /^relay-[0-9a-f]{24}\.pcap$/u;

export type AndroidUidNetworkCounters = { uid: number; rxBytes: number; txBytes: number };

export type AndroidEmulatorNetworkCaptureHandle = {
  runId: string;
  serial: string;
  avdName: string;
  fileName: string;
  sourcePath: string;
  startedAt: number;
  appPackage?: string;
  initialCounters?: AndroidUidNetworkCounters;
};

export type AndroidEmulatorNetworkCaptureResult = {
  summary: AndroidNetworkEvidenceSummary;
  rawPath?: string;
};

export type AndroidEmulatorNetworkCaptureRuntime = {
  now?: () => number;
  execAdb?: typeof execAndroidAdb;
  resolveAvdDirectory?: (avdName: string) => Promise<string>;
  readLocalAddresses?: (serial: string) => Promise<string[]>;
  readUidCounters?: (
    serial: string,
    appPackage: string,
  ) => Promise<AndroidUidNetworkCounters | undefined>;
};

function safeCaptureName(runId: string): string {
  return `relay-${createHash("sha256").update(runId).digest("hex").slice(0, 24)}.pcap`;
}

async function removeStaleRelayCaptures(directory: string): Promise<void> {
  const protectedFiles = new Set(
    [...activeCaptures.values()].map(({ runId }) => safeCaptureName(runId)),
  );
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() && RELAY_CAPTURE_FILE.test(entry.name) && !protectedFiles.has(entry.name),
      )
      .map((entry) => rm(join(directory, entry.name), { force: true }).catch(() => undefined)),
  );
}

function avdHome(): string {
  const explicit = process.env.ANDROID_AVD_HOME?.trim();
  if (explicit) return explicit;
  const androidHome = process.env.ANDROID_USER_HOME?.trim();
  return androidHome ? join(androidHome, "avd") : join(homedir(), ".android", "avd");
}

export async function resolveAndroidAvdDirectory(avdName: string): Promise<string> {
  const name = avdName.trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error("Android AVD name is not safe for network capture");
  }
  const home = avdHome();
  const ini = await readFile(join(home, `${name}.ini`), "utf8").catch(() => "");
  const configured = ini
    .split(/\r?\n/gu)
    .map((line) => line.match(/^path=(.+)$/u)?.[1]?.trim())
    .find(Boolean);
  const directory = configured || join(home, `${name}.avd`);
  if (!isAbsolute(directory)) throw new Error("Android AVD capture directory is not absolute");
  const info = await stat(directory).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`Android AVD ${name} content directory is unavailable`);
  return directory;
}

async function defaultReadLocalAddresses(serial: string): Promise<string[]> {
  const result = await execAndroidAdb(
    ["-s", serial, "shell", "ip", "-o", "addr", "show", "scope", "global"],
    { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 64 * 1024 },
  );
  return [...result.stdout.matchAll(/\binet6?\s+([^/\s]+)/gu)].map((match) => match[1]!);
}

function parseUid(output: string, appPackage: string): number | undefined {
  const line = output
    .split(/\r?\n/gu)
    .find((candidate) => candidate.includes(`package:${appPackage} `));
  const value = line?.match(/\buid:(\d+)\b/u)?.[1];
  if (!value) return undefined;
  const uid = Number(value);
  return Number.isSafeInteger(uid) && uid >= 0 ? uid : undefined;
}

function parseQtaguidCounters(output: string, uid: number): AndroidUidNetworkCounters | undefined {
  let rxBytes = 0;
  let txBytes = 0;
  let found = false;
  for (const line of output.split(/\r?\n/gu).slice(1)) {
    const columns = line.trim().split(/\s+/gu);
    if (Number(columns[3]) !== uid) continue;
    const rx = Number(columns[5]);
    const tx = Number(columns[7]);
    if (!Number.isSafeInteger(rx) || rx < 0 || !Number.isSafeInteger(tx) || tx < 0) continue;
    rxBytes += rx;
    txBytes += tx;
    found = true;
  }
  return found ? { uid, rxBytes, txBytes } : undefined;
}

async function defaultReadUidCounters(
  serial: string,
  appPackage: string,
): Promise<AndroidUidNetworkCounters | undefined> {
  const adb = await resolveAndroidSdkTool("adb");
  const packages = await execFileAsync(
    adb,
    ["-s", serial, "shell", "cmd", "package", "list", "packages", "-U", appPackage],
    { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 64 * 1024 },
  ).catch(() => undefined);
  const uid = packages ? parseUid(packages.stdout, appPackage) : undefined;
  if (uid === undefined) return undefined;
  const stats = await execFileAsync(
    adb,
    ["-s", serial, "shell", "cat", "/proc/net/xt_qtaguid/stats"],
    { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
  ).catch(() => undefined);
  return stats ? parseQtaguidCounters(stats.stdout, uid) : undefined;
}

export async function startAndroidEmulatorNetworkCapture(
  input: {
    runId: string;
    serial: string;
    avdName: string;
    appPackage?: string;
  },
  runtime: AndroidEmulatorNetworkCaptureRuntime = {},
): Promise<AndroidEmulatorNetworkCaptureHandle> {
  if (!/^emulator-\d+$/u.test(input.serial)) {
    throw new Error("packet capture requires one Android emulator target");
  }
  if (activeCaptures.has(input.serial)) {
    throw new Error(`Android emulator ${input.serial} already has a Relay packet capture`);
  }
  // Reserve before the first await. Emulator console capture is a singleton;
  // two starts racing past a read-then-write check would silently replace the
  // first Run's evidence window.
  const reservation: CaptureOwnership = { runId: input.runId, state: "starting" };
  activeCaptures.set(input.serial, reservation);
  try {
    const resolveAvdDirectory = runtime.resolveAvdDirectory ?? resolveAndroidAvdDirectory;
    const directory = await resolveAvdDirectory(input.avdName);
    const fileName = safeCaptureName(input.runId);
    const consoleDirectory = join(directory, "console_out");
    const sourcePath = join(consoleDirectory, fileName);
    await mkdir(consoleDirectory, { recursive: true, mode: 0o700 });
    // Relay console captures are transient by design. A process terminated
    // between start and stop cannot run its normal finally block, so the next
    // managed capture removes only Relay-owned stale files before dispatch.
    await removeStaleRelayCaptures(consoleDirectory);
    await rm(sourcePath, { force: true });
    const readUidCounters = runtime.readUidCounters ?? defaultReadUidCounters;
    const initialCounters = input.appPackage
      ? await readUidCounters(input.serial, input.appPackage).catch(() => undefined)
      : undefined;
    const execAdb = runtime.execAdb ?? execAndroidAdb;
    const startedAt = (runtime.now ?? Date.now)();
    await execAdb(["-s", input.serial, "emu", "network", "capture", "start", fileName], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    activeCaptures.set(input.serial, { runId: input.runId, state: "running" });
    return {
      runId: input.runId,
      serial: input.serial,
      avdName: input.avdName,
      fileName,
      sourcePath,
      startedAt,
      ...(input.appPackage ? { appPackage: input.appPackage } : {}),
      ...(initialCounters ? { initialCounters } : {}),
    };
  } catch (error) {
    if (activeCaptures.get(input.serial) === reservation) activeCaptures.delete(input.serial);
    throw error;
  }
}

async function readBoundedCapture(path: string): Promise<{ bytes: Buffer; truncated: boolean }> {
  const info = await stat(path);
  const length = Math.min(info.size, MAX_CAPTURE_BYTES);
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(length);
    const read = await handle.read(bytes, 0, length, 0);
    return { bytes: bytes.subarray(0, read.bytesRead), truncated: info.size > length };
  } finally {
    await handle.close();
  }
}

function addressV4(bytes: Buffer, offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

function addressV6(bytes: Buffer, offset: number): string {
  return Array.from({ length: 8 }, (_, index) =>
    bytes.readUInt16BE(offset + index * 2).toString(16),
  )
    .join(":")
    .replace(/(?:^|:)0(?::0)+(?::|$)/u, "::");
}

function dnsName(bytes: Buffer, offset: number, end: number): string | undefined {
  const labels: string[] = [];
  let cursor = offset;
  while (cursor < end) {
    const length = bytes[cursor++]!;
    if (length === 0) break;
    if ((length & 0xc0) !== 0 || length > 63 || cursor + length > end) return undefined;
    labels.push(bytes.toString("utf8", cursor, cursor + length));
    cursor += length;
  }
  const value = labels.join(".").trim().toLowerCase();
  return value && value.length <= 512 ? value : undefined;
}

type ParsedPacket = {
  at: number;
  capturedBytes: number;
  source: string;
  destination: string;
  protocol: "dns" | "tcp" | "udp" | "tls" | "quic" | "other";
  sourcePort?: number;
  destinationPort?: number;
  outcome: AndroidNetworkEvidenceSummary["flows"][number]["outcome"];
  host?: string;
};

function parseEthernetPacket(frame: Buffer, at: number): ParsedPacket | undefined {
  if (frame.length < 14) return undefined;
  let etherType = frame.readUInt16BE(12);
  let offset = 14;
  if (etherType === 0x8100 && frame.length >= 18) {
    etherType = frame.readUInt16BE(16);
    offset = 18;
  }
  let source: string;
  let destination: string;
  let transport: number;
  if (etherType === 0x0800) {
    if (frame.length < offset + 20) return undefined;
    const headerLength = (frame[offset]! & 0x0f) * 4;
    if (headerLength < 20 || frame.length < offset + headerLength) return undefined;
    transport = frame[offset + 9]!;
    source = addressV4(frame, offset + 12);
    destination = addressV4(frame, offset + 16);
    offset += headerLength;
  } else if (etherType === 0x86dd) {
    if (frame.length < offset + 40) return undefined;
    transport = frame[offset + 6]!;
    source = addressV6(frame, offset + 8);
    destination = addressV6(frame, offset + 24);
    offset += 40;
  } else {
    return undefined;
  }
  if (transport !== 6 && transport !== 17) {
    return {
      at,
      capturedBytes: frame.length,
      source,
      destination,
      protocol: "other",
      outcome: "observed",
    };
  }
  if (frame.length < offset + 4) return undefined;
  const sourcePort = frame.readUInt16BE(offset);
  const destinationPort = frame.readUInt16BE(offset + 2);
  if (transport === 17) {
    const dns = sourcePort === 53 || destinationPort === 53;
    const payload = offset + 8;
    const host =
      dns && frame.length >= payload + 12 ? dnsName(frame, payload + 12, frame.length) : undefined;
    const flags = dns && frame.length >= payload + 4 ? frame.readUInt16BE(payload + 2) : 0;
    const response = Boolean(flags & 0x8000);
    const rcode = flags & 0x000f;
    return {
      at,
      capturedBytes: frame.length,
      source,
      destination,
      protocol: dns ? "dns" : sourcePort === 443 || destinationPort === 443 ? "quic" : "udp",
      sourcePort,
      destinationPort,
      outcome: response && rcode === 3 ? "dns-nxdomain" : "observed",
      ...(host ? { host } : {}),
    };
  }
  if (frame.length < offset + 14) return undefined;
  const flags = frame[offset + 13]!;
  return {
    at,
    capturedBytes: frame.length,
    source,
    destination,
    protocol: sourcePort === 443 || destinationPort === 443 ? "tls" : "tcp",
    sourcePort,
    destinationPort,
    outcome: flags & 0x04 ? "reset" : (flags & 0x12) === 0x12 ? "connected" : "observed",
  };
}

function parsePcap(bytes: Buffer): { packets: ParsedPacket[]; dropped: number } {
  if (bytes.length < 24) throw new Error("emulator packet capture has no PCAP header");
  const littleMagic = bytes.readUInt32LE(0);
  const bigMagic = bytes.readUInt32BE(0);
  const little = littleMagic === 0xa1b2c3d4 || littleMagic === 0xa1b23c4d;
  const big = bigMagic === 0xa1b2c3d4 || bigMagic === 0xa1b23c4d;
  if (!little && !big) throw new Error("emulator packet capture uses an unsupported format");
  const read32 = little ? Buffer.prototype.readUInt32LE : Buffer.prototype.readUInt32BE;
  const linkType = read32.call(bytes, 20);
  if (linkType !== 1)
    throw new Error(`emulator packet capture link type ${linkType} is unsupported`);
  const nanos = little ? littleMagic === 0xa1b23c4d : bigMagic === 0xa1b23c4d;
  const packets: ParsedPacket[] = [];
  let dropped = 0;
  let offset = 24;
  while (offset < bytes.length) {
    if (offset + 16 > bytes.length) {
      dropped += 1;
      break;
    }
    const seconds = read32.call(bytes, offset);
    const fraction = read32.call(bytes, offset + 4);
    const capturedLength = read32.call(bytes, offset + 8);
    if (capturedLength > MAX_CAPTURE_BYTES || offset + 16 + capturedLength > bytes.length) {
      dropped += 1;
      break;
    }
    const frame = bytes.subarray(offset + 16, offset + 16 + capturedLength);
    const packet = parseEthernetPacket(
      frame,
      seconds * 1_000 + fraction / (nanos ? 1_000_000 : 1_000),
    );
    if (!packet || packets.length >= MAX_PARSED_PACKETS) dropped += 1;
    else packets.push(packet);
    offset += 16 + capturedLength;
  }
  return { packets, dropped };
}

function attribution(
  appPackage: string | undefined,
  initial: AndroidUidNetworkCounters | undefined,
  final: AndroidUidNetworkCounters | undefined,
): AndroidNetworkEvidenceSummary["attribution"] {
  if (!appPackage) {
    return {
      confidence: "unavailable",
      reason: "No application package was bound to this Run",
    };
  }
  if (!initial || !final || initial.uid !== final.uid) {
    return {
      package: appPackage,
      confidence: "ambiguous",
      reason: "Android did not expose coherent per-UID counters for the complete Run window",
    };
  }
  return {
    package: appPackage,
    uid: initial.uid,
    rxBytesDelta: Math.max(0, final.rxBytes - initial.rxBytes),
    txBytesDelta: Math.max(0, final.txBytes - initial.txBytes),
    confidence: "mixed",
    reason:
      "Per-UID counters cover the Run window, while packet flows still include the entire emulator",
  };
}

function summarizeCapture(input: {
  bytes: Buffer;
  handle: AndroidEmulatorNetworkCaptureHandle;
  finishedAt: number;
  localAddresses: readonly string[];
  finalCounters?: AndroidUidNetworkCounters;
  interrupted: boolean;
  truncated: boolean;
  rawCapture: AndroidNetworkEvidenceSummary["rawCapture"];
}): AndroidNetworkEvidenceSummary {
  const parsed = parsePcap(input.bytes);
  const locals = new Set(input.localAddresses);
  const domains = new Set<string>();
  let bytesSent = 0;
  let bytesReceived = 0;
  const flows = new Map<string, AndroidNetworkEvidenceSummary["flows"][number]>();
  let flowsTruncated = false;
  const windowMs = Math.max(0, input.finishedAt - input.handle.startedAt);
  for (const packet of parsed.packets) {
    const sent = locals.has(packet.source);
    const received = locals.has(packet.destination);
    if (sent) bytesSent += packet.capturedBytes;
    if (received) bytesReceived += packet.capturedBytes;
    if (packet.host) domains.add(packet.host);
    const remoteAddress = sent ? packet.destination : received ? packet.source : packet.destination;
    const port = sent
      ? packet.destinationPort
      : received
        ? packet.sourcePort
        : packet.destinationPort;
    const key = `${packet.protocol}:${remoteAddress}:${port ?? 0}:${packet.host ?? ""}`;
    const relativeAt = Math.min(windowMs, Math.max(0, packet.at - input.handle.startedAt));
    const existing = flows.get(key);
    if (existing) {
      existing.durationMs = Math.max(existing.durationMs ?? 0, relativeAt - existing.startedAtMs);
      existing.sentBytes += sent ? packet.capturedBytes : 0;
      existing.receivedBytes += received ? packet.capturedBytes : 0;
      if (packet.outcome !== "observed") existing.outcome = packet.outcome;
    } else if (flows.size < 1_000) {
      flows.set(key, {
        protocol: packet.protocol,
        ...(packet.host ? { host: packet.host } : {}),
        remoteAddress,
        ...(port ? { port } : {}),
        startedAtMs: relativeAt,
        sentBytes: sent ? packet.capturedBytes : 0,
        receivedBytes: received ? packet.capturedBytes : 0,
        outcome: packet.outcome,
      });
    } else flowsTruncated = true;
  }
  const dropped = parsed.dropped;
  const limitations = [
    "The emulator console captures only QEMU cellular/WAN traffic on Emulator 36.5 and newer; netsim Wi-Fi traffic may be absent",
    "Encrypted HTTP methods, status codes, headers, and bodies are not visible in packet metadata",
    ...(!locals.size
      ? ["Emulator interface addresses were unavailable; byte direction is unknown"]
      : []),
    ...(input.truncated
      ? ["The transient packet capture exceeded Relay's 16 MiB analysis bound"]
      : []),
    ...(flowsTruncated ? ["The packet summary reached Relay's 1,000-flow presentation bound"] : []),
  ];
  return parseAndroidNetworkEvidenceSummary({
    schemaVersion: 1,
    source: { kind: "emulator-packet", backend: "android-emulator-console" },
    coverage: input.interrupted ? "interrupted" : "partial",
    scope: "entire-emulator",
    startedAt: input.handle.startedAt,
    finishedAt: input.finishedAt,
    packets: parsed.packets.length,
    bytesSent,
    bytesReceived,
    domains: [...domains].slice(0, 256),
    flows: [...flows.values()],
    attribution: attribution(
      input.handle.appPackage,
      input.handle.initialCounters,
      input.finalCounters,
    ),
    rawCapture: input.rawCapture,
    dropped,
    redactions: 0,
    limitations,
  });
}

export async function stopAndroidEmulatorNetworkCapture(
  handle: AndroidEmulatorNetworkCaptureHandle,
  options: { retainRawPath?: string; rawArtifact?: string; rawDeniedReason?: string } = {},
  runtime: AndroidEmulatorNetworkCaptureRuntime = {},
): Promise<AndroidEmulatorNetworkCaptureResult> {
  const owner = activeCaptures.get(handle.serial);
  if (owner?.runId !== handle.runId || owner.state !== "running") {
    throw new Error(
      `Android emulator ${handle.serial} packet capture is no longer owned by Run ${handle.runId}`,
    );
  }
  const stoppingOwner: CaptureOwnership = { runId: handle.runId, state: "stopping" };
  activeCaptures.set(handle.serial, stoppingOwner);
  const now = runtime.now ?? Date.now;
  const execAdb = runtime.execAdb ?? execAndroidAdb;
  let interrupted = false;
  try {
    await execAdb(["-s", handle.serial, "emu", "network", "capture", "stop"], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
  } catch {
    interrupted = true;
  }
  const finishedAt = now();
  try {
    const [{ bytes, truncated }, localAddresses, finalCounters] = await Promise.all([
      readBoundedCapture(handle.sourcePath),
      (runtime.readLocalAddresses ?? defaultReadLocalAddresses)(handle.serial).catch(() => []),
      handle.appPackage
        ? (runtime.readUidCounters ?? defaultReadUidCounters)(
            handle.serial,
            handle.appPackage,
          ).catch(() => undefined)
        : undefined,
    ]);
    let rawCapture: AndroidNetworkEvidenceSummary["rawCapture"] = {
      status: options.rawDeniedReason
        ? "denied"
        : options.retainRawPath
          ? "failed"
          : "not-requested",
      ...(options.rawDeniedReason
        ? { reason: options.rawDeniedReason }
        : options.retainRawPath
          ? { reason: "Raw packet retention did not complete" }
          : {}),
    };
    let rawPath: string | undefined;
    if (options.retainRawPath && options.rawArtifact && !truncated) {
      await mkdir(dirname(options.retainRawPath), { recursive: true, mode: 0o700 });
      await copyFile(handle.sourcePath, options.retainRawPath);
      await chmod(options.retainRawPath, 0o600);
      rawPath = options.retainRawPath;
      rawCapture = {
        status: "captured",
        artifact: { path: options.rawArtifact, bytes: bytes.byteLength },
        bytes: bytes.byteLength,
      };
    } else if (options.retainRawPath && options.rawArtifact && truncated) {
      await mkdir(dirname(options.retainRawPath), { recursive: true, mode: 0o700 });
      await writeFile(options.retainRawPath, bytes, { mode: 0o600 });
      await chmod(options.retainRawPath, 0o600);
      rawPath = options.retainRawPath;
      rawCapture = {
        status: "truncated",
        artifact: { path: options.rawArtifact, bytes: bytes.byteLength },
        bytes: bytes.byteLength,
        reason: "Raw capture exceeded Relay's 16 MiB retention bound",
      };
    }
    return {
      summary: summarizeCapture({
        bytes,
        handle,
        finishedAt,
        localAddresses,
        ...(finalCounters ? { finalCounters } : {}),
        interrupted,
        truncated,
        rawCapture,
      }),
      ...(rawPath ? { rawPath } : {}),
    };
  } finally {
    await rm(handle.sourcePath, { force: true }).catch(() => undefined);
    if (activeCaptures.get(handle.serial) === stoppingOwner) activeCaptures.delete(handle.serial);
  }
}

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { currentTargetContext } from "./target-context.js";

const execFileAsync = promisify(execFile);
const MAX_CRASH_OUTPUT_BYTES = 2 * 1024 * 1024;

export type CrashEvidenceResult = {
  platform: "android" | "ios" | "browser";
  since: number;
  entries: Array<{ at?: number; source: string; message: string }>;
  truncated: boolean;
};

function boundedLines(output: string): { lines: string[]; truncated: boolean } {
  const bytes = Buffer.from(output);
  const truncated = bytes.byteLength > MAX_CRASH_OUTPUT_BYTES;
  const value = truncated
    ? bytes.subarray(bytes.byteLength - MAX_CRASH_OUTPUT_BYTES).toString()
    : output;
  return { lines: value.split("\n").filter(Boolean), truncated };
}

function androidArgs(serial: string | undefined, args: string[]): string[] {
  return [...(serial ? ["-s", serial] : []), ...args];
}

async function crashFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await crashFiles(file)));
    else if (entry.isFile() && /\.(?:ips|crash|diag|log)$/i.test(entry.name)) files.push(file);
  }
  return files;
}

/** A crash-log entry is worth copying when its name looks like a crash report
 * and its listed modification time is not older than the requested window. */
export function crashLogEntryIsCandidate(
  name: string,
  modifiedAtMs: number | undefined,
  since: number,
): boolean {
  if (!/\.(?:ips|crash|diag|log)$/i.test(name)) return false;
  return modifiedAtMs === undefined || modifiedAtMs >= since;
}

/** Parse a devicectl `info files` JSON payload (or its text fallback) into
 * device-side crash-log file entries. */
export function parseDevicectlCrashEntries(
  output: string,
): Array<{ name: string; path?: string; modifiedAt?: number }> {
  const entries: Array<{ name: string; path?: string; modifiedAt?: number }> = [];
  try {
    const data = JSON.parse(output) as unknown;
    collectDevicectlFiles(data, entries);
  } catch {
    for (const line of output.split(/\r?\n/)) {
      // Text rows look like: `-rw-r--r-- 1 mobile 12345 2026-08-01 12:00:00 MyApp-2026-08-01-120000.ips`
      const match =
        /^(\S+\s+){4}(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\s+(\S+\.ips)$/u.exec(line.trim());
      if (match?.[2] && match[3]) {
        const at = Date.parse(match[2].replace(" ", "T") + "Z");
        entries.push({
          name: match[3],
          ...(Number.isFinite(at) ? { modifiedAt: at } : {}),
        });
      }
    }
  }
  return entries;
}

function collectDevicectlFiles(
  value: unknown,
  entries: Array<{ name: string; path?: string; modifiedAt?: number }>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectDevicectlFiles(item, entries);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const name =
    typeof record.fileName === "string"
      ? record.fileName
      : typeof record.name === "string"
        ? record.name
        : undefined;
  if (name) {
    const modifiedAt =
      typeof record.modificationDate === "string" ? Date.parse(record.modificationDate) : undefined;
    entries.push({
      name,
      ...(typeof record.path === "string" ? { path: record.path } : {}),
      ...(modifiedAt !== undefined && Number.isFinite(modifiedAt)
        ? { modifiedAt }
        : {}),
    });
    return;
  }
  for (const child of Object.values(record)) collectDevicectlFiles(child, entries);
}

async function capturePhysicalIosCrashEvidence(
  serial: string,
  since: number,
): Promise<CrashEvidenceResult> {
  const destination = await mkdtemp(path.join(tmpdir(), "relay-ios-crashes-"));
  try {
    // List the crash-log domain first and copy only candidate files. Pulling
    // the whole domain can move hundreds of megabytes of years-old reports
    let listed: Array<{ name: string; path?: string; modifiedAt?: number }>;
    try {
      const result = await execFileAsync(
        "xcrun",
        [
          "devicectl",
          "device",
          "info",
          "files",
          "--device",
          serial,
          "--domain-type",
          "systemCrashLogs",
          "--timeout",
          "30",
        ],
        { maxBuffer: 8 * 1024 * 1024 },
      );
      listed = parseDevicectlCrashEntries(String(result.stdout));
    } catch (error) {
      // A device that cannot even be listed has no crash evidence to offer;
      // surface the transport failure instead of reporting a clean empty run.
      throw new Error(
        `devicectl could not list iOS system crash logs for ${serial}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const candidates = listed.filter((entry) =>
      crashLogEntryIsCandidate(entry.name, entry.modifiedAt, since),
    );

    let copied = 0;
    for (const entry of candidates) {
      const target = path.join(destination, entry.name);
      try {
        await execFileAsync(
          "xcrun",
          [
            "devicectl",
            "device",
            "copy",
            "from",
            "--device",
            serial,
            "--source",
            entry.path ?? entry.name,
            "--destination",
            destination,
            "--domain-type",
            "systemCrashLogs",
            "--timeout",
            "30",
          ],
          { maxBuffer: 256 * 1024 },
        );
        copied += 1;
      } catch {
        // One unreadable entry must not block the remaining candidates.
        continue;
      }
      void target;
    }

    if (copied === 0) {
      return { platform: "ios", since, entries: [], truncated: false };
    }

    const recent: Array<{ file: string; at: number }> = [];
    for (const file of await crashFiles(destination)) {
      const info = await stat(file);
      recent.push({ file, at: info.mtimeMs });
    }
    return buildCrashEntries(recent, since);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}

async function buildCrashEntries(
  recent: Array<{ file: string; at: number }>,
  since: number,
): Promise<CrashEvidenceResult> {
  recent.sort((left, right) => left.at - right.at);
  let remaining = MAX_CRASH_OUTPUT_BYTES;
  let truncated = false;
  const entries: CrashEvidenceResult["entries"] = [];
  for (const item of recent) {
    const contents = await readFile(item.file);
    const selected = contents.byteLength > remaining ? contents.subarray(0, remaining) : contents;
    entries.push({
      at: item.at,
      source: `ios-system-crash:${path.basename(item.file)}`,
      message: selected.toString("utf8"),
    });
    remaining -= selected.byteLength;
    if (selected.byteLength < contents.byteLength || remaining === 0) {
      truncated = true;
      break;
    }
  }
  return { platform: "ios", since, entries, truncated };
}

async function captureSimulatorIosCrashEvidence(
  serial: string,
  since: number,
): Promise<CrashEvidenceResult> {
  const predicate =
    'messageType == fault OR eventMessage CONTAINS[c] "crash" OR eventMessage CONTAINS[c] "exception"';
  const { stdout } = await execFileAsync(
    "xcrun",
    [
      "simctl",
      "spawn",
      serial,
      "log",
      "show",
      "--style",
      "compact",
      "--start",
      new Date(since).toISOString(),
      "--predicate",
      predicate,
    ],
    { maxBuffer: MAX_CRASH_OUTPUT_BYTES * 2 },
  );
  const bounded = boundedLines(String(stdout));
  const entries = bounded.lines.map((message) => ({
    at: attachSimulatorEntryTimestamp(message, since),
    source: "ios-unified-log",
    message,
  }));
  return { platform: "ios", since, entries, truncated: bounded.truncated };
}

/** Simulator unified-log lines start with a wall-clock timestamp. Attach it so
 * consumers can order these entries against physical-device crash evidence. */
function attachSimulatorEntryTimestamp(message: string, fallback: number): number | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/u.exec(message);
  if (!match?.[1]) return undefined;
  const parsed = Date.parse(`${match[1].replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function captureNativeCrashEvidence(since: number): Promise<CrashEvidenceResult> {
  const target = currentTargetContext();
  if (target.kind !== "device")
    throw new Error("crash diagnostics are unavailable for this target");

  if (target.platform === "android") {
    const { stdout } = await execFileAsync(
      "adb",
      androidArgs(target.serial, ["logcat", "-b", "crash", "-d", "-v", "epoch", "-t", "2000"]),
      { maxBuffer: MAX_CRASH_OUTPUT_BYTES * 2 },
    );
    const bounded = boundedLines(String(stdout));
    const entries = bounded.lines
      .map((line) => {
        const seconds = Number(line.match(/^(\d+(?:\.\d+)?)/)?.[1]);
        return {
          ...(Number.isFinite(seconds) ? { at: Math.round(seconds * 1_000) } : {}),
          source: "android-logcat-crash",
          message: line,
        };
      })
      .filter((entry) => entry.at === undefined || entry.at >= since);
    return { platform: "android", since, entries, truncated: bounded.truncated };
  }

  if (!target.serial) throw new Error("iOS crash diagnostics require a selected simulator UDID");
  // Physical targets never had a working simctl spawn; go straight to the
  // devicectl crash-log domain instead of burning one failed simctl round-trip.
  if (isPhysicalIosSerial(target.serial)) {
    return capturePhysicalIosCrashEvidence(target.serial, since);
  }
  return captureSimulatorIosCrashEvidence(target.serial, since).catch(() =>
    capturePhysicalIosCrashEvidence(target.serial, since),
  );
}

/** CoreDevice UDIDs are UUID-shaped or ECID-prefixed; booted simulators use
 * plain hex/UUID too but their serial comes from `simctl` selection. The
 * reliable discriminator available here is the UDID prefix Apple assigns to
 * physical hardware (`00008…` / `0000…-…`). */
function isPhysicalIosSerial(serial: string): boolean {
  return /^0000/i.test(serial) || /^[0-9a-f]{40}$/i.test(serial);
}


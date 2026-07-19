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

async function capturePhysicalIosCrashEvidence(
  serial: string,
  since: number,
): Promise<CrashEvidenceResult> {
  const destination = await mkdtemp(path.join(tmpdir(), "relay-ios-crashes-"));
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
        ".",
        "--destination",
        destination,
        "--domain-type",
        "systemCrashLogs",
        "--timeout",
        "30",
      ],
      { maxBuffer: 256 * 1024 },
    );
    const candidates = await crashFiles(destination);
    const recent: Array<{ file: string; at: number }> = [];
    for (const file of candidates) {
      const info = await stat(file);
      if (info.mtimeMs >= since) recent.push({ file, at: info.mtimeMs });
    }
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
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
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
  const predicate =
    'messageType == fault OR eventMessage CONTAINS[c] "crash" OR eventMessage CONTAINS[c] "exception"';
  let stdout: string | Buffer;
  try {
    ({ stdout } = await execFileAsync(
      "xcrun",
      [
        "simctl",
        "spawn",
        target.serial,
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
    ));
  } catch {
    return capturePhysicalIosCrashEvidence(target.serial, since);
  }
  const bounded = boundedLines(String(stdout));
  return {
    platform: "ios",
    since,
    entries: bounded.lines.map((message) => ({ source: "ios-unified-log", message })),
    truncated: bounded.truncated,
  };
}

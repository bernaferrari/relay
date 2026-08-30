import { chmod, mkdir, open, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  redactSensitiveEvidenceValue,
  redactValue,
} from "./redaction.js";
import { ensureRunDir } from "./runs.js";
import type { TestJob } from "./session.js";

const MAX_PERSISTED_LOG_BYTES = 512 * 1024;
const MAX_PERSISTED_NETWORK_BYTES = 2 * 1024 * 1024;
const OWNED_DIRECTORY_MODE = 0o700;
const OWNED_FILE_MODE = 0o600;

/**
 * Provider observability responses are allowed to point at the agent-device
 * session directory, but that directory is not part of a durable Run. Own the
 * bounded bytes before adding the response to the Run so TracePack never has
 * to dereference an arbitrary external path. Network responses are already
 * bounded by the provider; serializing them here gives them the same portable
 * ownership as the copied app log.
 */
export async function materializeCaptureArtifact(
  job: TestJob,
  kind: string,
  result: unknown,
): Promise<unknown> {
  const redacted = redactSensitiveEvidenceValue(redactValue(result));
  if (kind === "network") {
    return await writeJsonCaptureArtifact(job, "network/network.json", redacted);
  }
  if (kind !== "logs" || !isRecord(redacted) || typeof redacted.path !== "string") {
    return redacted;
  }
  if (!isAbsolutePath(redacted.path)) return redacted;

  const bounded = await readBoundedLog(redacted.path);
  if (!bounded) return redacted;
  const runDir = await ensureRunDir(job);
  const relativePath = "logs/app.log";
  await ensureOwnedDirectory(join(runDir, "logs"));
  await writeOwnedFile(join(runDir, relativePath), bounded.text);
  return { ...redacted, path: relativePath, bytes: Buffer.byteLength(bounded.text) };
}

async function writeJsonCaptureArtifact(
  job: TestJob,
  relativePath: string,
  value: unknown,
): Promise<unknown> {
  const data: Record<string, unknown> = isRecord(value)
    ? { ...value, path: relativePath }
    : { path: relativePath, value };
  let boundedData: Record<string, unknown> = data;
  let serialized = JSON.stringify(boundedData);
  if (Buffer.byteLength(serialized) > MAX_PERSISTED_NETWORK_BYTES) {
    // Provider limits should keep this branch unreachable for normal Android
    // captures. Preserve a valid, bounded artifact if a custom adapter lies
    // about its response bounds rather than writing an oversized Run file.
    boundedData = {
      path: relativePath,
      truncated: true,
      reason: "network evidence exceeded the durable artifact bound",
    };
    serialized = JSON.stringify(boundedData);
  }
  const runDir = await ensureRunDir(job);
  await ensureOwnedDirectory(join(runDir, "network"));
  await writeOwnedFile(join(runDir, relativePath), serialized);
  return { ...boundedData, bytes: Buffer.byteLength(serialized) };
}

async function readBoundedLog(path: string): Promise<{ text: string } | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const info = await stat(path);
    if (!info.isFile()) return undefined;
    const offset = Math.max(0, info.size - MAX_PERSISTED_LOG_BYTES);
    const length = Math.min(info.size, MAX_PERSISTED_LOG_BYTES);
    handle = await open(path, "r");
    const bytes = Buffer.alloc(length);
    const read = await handle.read(bytes, 0, length, offset);
    const text = redactSensitiveEvidenceValue(
      redactValue(bytes.subarray(0, read.bytesRead).toString("utf8")),
    );
    const content = typeof text === "string" ? text : String(text);
    return {
      text: `${offset > 0 ? "[REDACTED: log prefix omitted]\n" : ""}${content}`,
    };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function ensureOwnedDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: OWNED_DIRECTORY_MODE });
  await chmod(path, OWNED_DIRECTORY_MODE);
}

async function writeOwnedFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode: OWNED_FILE_MODE });
  await chmod(path, OWNED_FILE_MODE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value);
}

import { lstat, readFile } from "node:fs/promises";
import { parseTracePack, type ReplayLabAnalysis, type TracePack } from "@relay/protocol";

const maxFiles = 64;
const maxFileBytes = 32 * 1024 * 1024;
const maxTotalBytes = 128 * 1024 * 1024;

export type ReplayLabFileIntent = {
  kind: "replay-lab";
  analysis: ReplayLabAnalysis;
  paths: readonly string[];
};

export type ReplayLabFileErrorCode =
  | "REPLAY_LAB_SOURCE_COUNT"
  | "REPLAY_LAB_DUPLICATE_SOURCE"
  | "REPLAY_LAB_FILE_NOT_REGULAR"
  | "REPLAY_LAB_FILE_TOO_LARGE"
  | "REPLAY_LAB_TOTAL_TOO_LARGE"
  | "REPLAY_LAB_INVALID_JSON"
  | "REPLAY_LAB_INVALID_TRACE_PACK";

export class ReplayLabFileError extends Error {
  constructor(
    readonly code: ReplayLabFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReplayLabFileError";
  }
}

function unwrap(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.kind === "relay-trace-pack") return value;
  if (record.tracePack !== undefined) return record.tracePack;
  if (record.result && typeof record.result === "object" && !Array.isArray(record.result)) {
    const result = record.result as Record<string, unknown>;
    if (result.tracePack !== undefined) return result.tracePack;
  }
  return value;
}

export async function readReplayLabTracePacks(paths: readonly string[]): Promise<TracePack[]> {
  if (paths.length < 2 || paths.length > maxFiles) {
    throw new ReplayLabFileError(
      "REPLAY_LAB_SOURCE_COUNT",
      `Replay Lab requires between 2 and ${maxFiles} ordered TracePack files.`,
    );
  }
  if (new Set(paths).size !== paths.length) {
    throw new ReplayLabFileError(
      "REPLAY_LAB_DUPLICATE_SOURCE",
      "Replay Lab file paths must be unique and ordered oldest to newest.",
    );
  }
  let totalBytes = 0;
  const packs: TracePack[] = [];
  for (const path of paths) {
    const metadata = await lstat(path).catch(() => undefined);
    if (!metadata?.isFile()) {
      throw new ReplayLabFileError(
        "REPLAY_LAB_FILE_NOT_REGULAR",
        `Replay Lab source is not a regular local file: ${path}`,
      );
    }
    if (metadata.size > maxFileBytes) {
      throw new ReplayLabFileError(
        "REPLAY_LAB_FILE_TOO_LARGE",
        `Replay Lab source exceeds ${maxFileBytes} bytes: ${path}`,
      );
    }
    totalBytes += metadata.size;
    if (totalBytes > maxTotalBytes) {
      throw new ReplayLabFileError(
        "REPLAY_LAB_TOTAL_TOO_LARGE",
        `Replay Lab sources exceed ${maxTotalBytes} aggregate bytes.`,
      );
    }
    let document: unknown;
    try {
      document = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new ReplayLabFileError(
        "REPLAY_LAB_INVALID_JSON",
        `Replay Lab source is not valid JSON: ${path} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    try {
      packs.push(parseTracePack(unwrap(document)));
    } catch (error) {
      throw new ReplayLabFileError(
        "REPLAY_LAB_INVALID_TRACE_PACK",
        `${path} is not a valid Relay TracePack: ${error instanceof Error ? error.message : "invalid document"}`,
      );
    }
  }
  return packs;
}

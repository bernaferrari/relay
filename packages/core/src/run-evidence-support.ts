import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceManifest } from "@relay/protocol";
import type { TestJob } from "./session.js";

export function finiteTimestamp(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function finiteOffset(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function resequenceChronologically(manifest: EvidenceManifest): void {
  manifest.events.sort(
    (left, right) => left.monotonicMs - right.monotonicMs || left.sequence - right.sequence,
  );
  for (const [index, item] of manifest.events.entries()) item.sequence = index + 1;
}

export async function videoFiles(job: TestJob): Promise<Array<{ path: string; bytes: number }>> {
  if (!job.runDir) return [];
  const dir = join(job.runDir, "video");
  try {
    const entries = await readdir(dir);
    const files = await Promise.all(
      entries
        .filter((file) => /\.(mp4|webm)$/i.test(file))
        .sort()
        .map(async (file) => {
          const info = await stat(join(dir, file));
          return { path: `video/${file}`, bytes: info.size };
        }),
    );
    return files.filter((file) => file.bytes > 0);
  } catch {
    return [];
  }
}

export function entryCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object" && "entries" in value) {
    const entries = (value as { entries?: unknown }).entries;
    return Array.isArray(entries) ? entries.length : 0;
  }
  return value === undefined || value === null ? 0 : 1;
}

export function byteCount(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null));
}

export function droppedCount(value: unknown): number {
  if (!value || typeof value !== "object" || !("dropped" in value)) return 0;
  const dropped = (value as { dropped?: unknown }).dropped;
  return typeof dropped === "number" && dropped > 0 ? dropped : 0;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

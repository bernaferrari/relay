import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SnapshotNode } from "./device.js";
import { ensureRunDir } from "./runs.js";
import type { TestJob } from "./session-contract.js";

const FRAME_TREE_KIND = "relay.frame-tree";

export type FrameTreeArtifact = {
  schemaVersion: 1;
  kind: typeof FRAME_TREE_KIND;
  nodes: SnapshotNode[];
};

export function frameTreeRelativePath(framePath: string): string {
  return framePath.replace(/\.png$/iu, ".json");
}

export function parseFrameTreeNodes(value: unknown): SnapshotNode[] | undefined {
  if (Array.isArray(value)) return value as SnapshotNode[];
  if (!value || typeof value !== "object") return undefined;
  const nodes = (value as { nodes?: unknown }).nodes;
  return Array.isArray(nodes) ? (nodes as SnapshotNode[]) : undefined;
}

/** Persist the raw snapshot nodes that produced a PNG. Control lists are not a tree. */
export async function writeFrameTree(
  job: TestJob,
  framePath: string,
  nodes: readonly SnapshotNode[],
): Promise<string> {
  if (!nodes.length) throw new Error(`frame tree for ${framePath} has no nodes`);
  const dir = await ensureRunDir(job);
  const relative = frameTreeRelativePath(framePath);
  const artifact: FrameTreeArtifact = {
    schemaVersion: 1,
    kind: FRAME_TREE_KIND,
    nodes: structuredClone([...nodes]),
  };
  await writeFile(join(dir, relative), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return relative;
}

export async function readFrameTreeNodes(
  runDir: string | undefined,
  framePath: string,
): Promise<SnapshotNode[] | undefined> {
  if (!runDir) return undefined;
  const absolute = join(runDir, frameTreeRelativePath(framePath));
  try {
    return parseFrameTreeNodes(JSON.parse(await readFile(absolute, "utf8")));
  } catch {
    return undefined;
  }
}

export function packAccessibilityRelativePath(packPngPath: string): string {
  const file = basename(packPngPath).replace(/\.png$/iu, ".json");
  const parent = dirname(packPngPath);
  const locale = parent.endsWith("/screenshots") ? parent.slice(0, -"/screenshots".length) : parent;
  return `${locale}/accessibility/${file}`;
}

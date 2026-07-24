import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PersistedRun } from "./runs.js";

export type VisualBaseline = {
  schemaVersion: 1;
  recipeId: string;
  targetKey: string;
  runId: string;
  approvedAt: number;
};

const BASELINES_FILE = ".visual-baselines.json";

function baselinePath(root: string): string {
  return join(root, BASELINES_FILE);
}

function isBaseline(value: unknown): value is VisualBaseline {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.schemaVersion === 1 &&
    typeof item.recipeId === "string" &&
    typeof item.targetKey === "string" &&
    typeof item.runId === "string" &&
    typeof item.approvedAt === "number"
  );
}

async function readAll(root: string): Promise<VisualBaseline[]> {
  try {
    const value: unknown = JSON.parse(await readFile(baselinePath(root), "utf8"));
    return Array.isArray(value) ? value.filter(isBaseline) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeAll(root: string, baselines: VisualBaseline[]): Promise<void> {
  await mkdir(root, { recursive: true });
  const target = baselinePath(root);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(baselines, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

/** A baseline only compares like-for-like: the same recipe on the same target profile. */
export function visualTargetKey(
  run: Pick<PersistedRun, "targetProfile" | "serial" | "platform">,
): string {
  return run.targetProfile?.id ?? run.serial ?? run.platform ?? "default";
}

export async function getVisualBaseline(
  root: string,
  recipeId: string,
  targetKey: string,
): Promise<VisualBaseline | null> {
  return (
    (await readAll(root)).find(
      (baseline) => baseline.recipeId === recipeId && baseline.targetKey === targetKey,
    ) ?? null
  );
}

/** Human approval promotes a complete run; it never rewrites the run itself. */
export async function approveVisualBaseline(
  root: string,
  run: Pick<PersistedRun, "id" | "action" | "targetProfile" | "serial" | "platform">,
): Promise<VisualBaseline> {
  const targetKey = visualTargetKey(run);
  const next: VisualBaseline = {
    schemaVersion: 1,
    recipeId: run.action,
    targetKey,
    runId: run.id,
    approvedAt: Date.now(),
  };
  const existing = await readAll(root);
  await writeAll(root, [
    ...existing.filter((item) => item.recipeId !== next.recipeId || item.targetKey !== targetKey),
    next,
  ]);
  return next;
}

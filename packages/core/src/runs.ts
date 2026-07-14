/**
 * Persist runs to disk — mirrors qa-viewer runs/<ts>_<flow>_<device>/ layout.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { TestJob } from "./session.js";
import type { TraceFrameRef, TraceStep } from "./trace.js";
import type { FailureCategory, RunOutcome, TargetProfile } from "@relay/protocol";
import { now } from "./events.js";

export type PersistedRun = {
  schemaVersion: 2 | 3 | 4;
  id: string;
  action: string;
  title?: string;
  serial?: string;
  deviceName?: string;
  platform?: string;
  targetProfile?: TargetProfile;
  status: string;
  healed?: boolean;
  healMessage?: string;
  attempts: number;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  result?: unknown;
  error?: string;
  errorCode?: string;
  outcome?: RunOutcome;
  failureCategory?: FailureCategory;
  appVersion?: string;
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  logs: string[];
  steps: TraceStep[];
  frames: TraceFrameRef[];
  frameCount?: number;
  dir: string;
  writtenAt: number;
  recipeSnapshot?: TestJob["recipeSnapshot"];
  artifacts: TestJob["artifacts"];
  inputDigest: string;
  resolvedInputs: Record<string, string>;
};

export type RunArtifact = TestJob["artifacts"][number];

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function findWorkspaceRoot(start = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, "pnpm-lock.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export function runsRoot(): string {
  const env = (process.env.RELAY_RUNS_DIR ?? process.env.GROK_DEVICE_RUNS_DIR)?.trim();
  if (env) return env;
  return join(findWorkspaceRoot(), "runs");
}

export function formatRunFolder(
  job: Pick<TestJob, "id" | "action" | "serial" | "startedAt" | "queuedAt">,
): string {
  const ts = new Date(job.startedAt ?? job.queuedAt)
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const device = slug(job.serial ?? "nodevice");
  const action = slug(job.action);
  return `${ts}_${action}_${device}_${job.id.slice(0, 8)}`;
}

export async function ensureRunDir(job: TestJob): Promise<string> {
  if (job.runDir) {
    await Promise.all([
      mkdir(join(job.runDir, "frames"), { recursive: true }),
      mkdir(join(job.runDir, "video"), { recursive: true }),
    ]);
    return job.runDir;
  }
  const dir = join(runsRoot(), formatRunFolder(job));
  await Promise.all([
    mkdir(join(dir, "frames"), { recursive: true }),
    mkdir(join(dir, "video"), { recursive: true }),
  ]);
  job.runDir = dir;
  return dir;
}

export async function writeFramePng(
  job: TestJob,
  base64: string,
  caption: string,
): Promise<TraceFrameRef> {
  const dir = await ensureRunDir(job);
  const idx = String(job.frames.length + 1).padStart(3, "0");
  const rel = `frames/${idx}.png`;
  const abs = join(dir, rel);
  const buf = Buffer.from(base64, "base64");
  await writeFile(abs, buf);
  const frame: TraceFrameRef = {
    path: rel,
    caption,
    capturedAt: now(),
    bytes: buf.byteLength,
    base64,
    mime: "image/png",
  };
  job.frames.push({ ...frame, base64: undefined });
  return frame;
}

export async function persistRun(job: TestJob): Promise<PersistedRun> {
  const dir = await ensureRunDir(job);
  const durationMs =
    job.finishedAt && (job.startedAt ?? job.queuedAt)
      ? job.finishedAt - (job.startedAt ?? job.queuedAt)
      : undefined;

  // strip heavy base64 from disk JSON (files already on disk)
  const frames: TraceFrameRef[] = job.frames.map(({ base64: _b, ...rest }) => rest);
  const steps: TraceStep[] = job.steps.map((s) => ({
    ...s,
    frames: s.frames.map(({ base64: _b, ...rest }) => rest),
  }));

  const frozenInput = JSON.stringify({
    action: job.action,
    serial: job.serial,
    recipe: job.recipeSnapshot ?? null,
    variables: job.resolvedInputs,
  });
  const payload: PersistedRun = {
    schemaVersion: 4,
    id: job.id,
    action: job.action,
    title: job.title,
    serial: job.serial,
    deviceName: job.deviceName,
    platform: job.platform ?? "android",
    targetProfile: job.targetProfile,
    status: job.status,
    healed: job.healed,
    healMessage: job.healMessage,
    attempts: job.attempts,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs,
    result: job.result,
    error: job.error,
    errorCode: job.errorCode,
    outcome: job.outcome,
    failureCategory: job.failureCategory,
    appVersion: job.appVersion,
    batchId: job.batchId,
    caseIndex: job.caseIndex,
    caseCount: job.caseCount,
    logs: job.logs,
    steps,
    frames,
    frameCount: frames.length,
    dir,
    writtenAt: now(),
    recipeSnapshot: job.recipeSnapshot,
    artifacts: job.artifacts,
    inputDigest: createHash("sha256").update(frozenInput).digest("hex"),
    resolvedInputs: job.resolvedInputs,
  };

  const json = JSON.stringify(payload, null, 2);
  // A completed report is evidence, not mutable workspace state. Never rewrite
  // an existing manifest if a duplicate finalization path races in.
  try {
    await writeFile(join(dir, "run.json"), json, { encoding: "utf8", flag: "wx" });
    await writeFile(join(dir, "report-manifest.json"), json, { encoding: "utf8", flag: "wx" });
    await writeFile(join(dir, "log.txt"), job.logs.join("\n"), { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if (!(err instanceof Error && "code" in err && err.code === "EEXIST")) throw err;
  }
  job.persisted = true;
  return payload;
}

export async function listPersistedRuns(limit = 40): Promise<PersistedRun[]> {
  const root = runsRoot();
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const runs: PersistedRun[] = [];
  for (const name of entries.sort().reverse()) {
    if (runs.length >= limit) break;
    const dir = join(root, name);
    try {
      const st = await stat(dir);
      if (!st.isDirectory()) continue;
      const raw = await readFile(join(dir, "run.json"), "utf8");
      const parsed = JSON.parse(raw) as PersistedRun;
      parsed.dir = dir;
      runs.push(parsed);
    } catch {
      /* skip incomplete */
    }
  }
  return runs;
}

export async function readPersistedRun(idOrDir: string): Promise<PersistedRun | null> {
  // Match by exact folder name or trailing _<id> segment only — never loose includes().
  const needle = idOrDir.trim();
  if (!needle || needle.includes("/") || needle.includes("\\") || needle.includes("..")) {
    return null;
  }
  const root = runsRoot();
  try {
    const entries = await readdir(root);
    let match =
      entries.find((e) => e === needle || e.endsWith(`_${needle}`) || e.startsWith(`${needle}_`)) ??
      null;
    if (!match) {
      for (const entry of entries) {
        try {
          const raw = await readFile(join(root, entry, "run.json"), "utf8");
          const parsed = JSON.parse(raw) as Pick<PersistedRun, "id">;
          if (parsed.id === needle) {
            match = entry;
            break;
          }
        } catch {
          /* skip incomplete or non-run directories */
        }
      }
    }
    if (!match) return null;
    const dir = join(root, match);
    const raw = await readFile(join(dir, "run.json"), "utf8");
    const parsed = JSON.parse(raw) as PersistedRun;
    parsed.dir = dir;
    return parsed;
  } catch {
    return null;
  }
}

export async function recipeStability(
  recipeId: string,
  limit = 20,
): Promise<{
  total: number;
  passed: number;
  productFailures: number;
  harnessFailures: number;
  uncertain: number;
  passRate: number | null;
}> {
  const runs = (await listPersistedRuns(200))
    .filter((run) => run.action === recipeId)
    .slice(0, Math.max(1, Math.min(limit, 100)));
  const passed = runs.filter(
    (run) => run.outcome === "passed" || run.status === "ok" || run.status === "healed",
  ).length;
  const productFailures = runs.filter((run) => run.outcome === "product-failure").length;
  const harnessFailures = runs.filter((run) => run.outcome === "harness-failure").length;
  const uncertain = runs.filter((run) => run.outcome === "uncertain").length;
  const judged = passed + productFailures;
  return {
    total: runs.length,
    passed,
    productFailures,
    harnessFailures,
    uncertain,
    passRate: judged > 0 ? passed / judged : null,
  };
}

export async function readFrameFile(runDir: string, relPath: string): Promise<Buffer | null> {
  // prevent path escape
  const safe = basename(relPath.includes("/") ? relPath.split("/").pop()! : relPath);
  const abs = join(runDir, "frames", safe);
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}

export function runArtifactFile(runDir: string, area: "video", file: string): string | null {
  const safe = basename(file);
  if (!safe || safe !== file || !safe.toLowerCase().endsWith(".mp4")) return null;
  return join(runDir, area, safe);
}

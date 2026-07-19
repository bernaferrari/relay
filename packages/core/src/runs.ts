/**
 * Persist runs to disk — mirrors qa-viewer runs/<ts>_<flow>_<device>/ layout.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, readdir, stat, rename, unlink, open } from "node:fs/promises";
import { join, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { TestJob } from "./session.js";
import type { TraceFrameRef, TraceStep } from "./trace.js";
import type { EvidenceManifest, FailureCategory, RunOutcome, TargetProfile } from "@relay/protocol";
import { now } from "./events.js";
import { redactResolvedInputs, redactText, redactValue } from "./redaction.js";
import {
  catalogRunDirectory,
  catalogSummaries,
  indexRun,
  rebuildRunCatalog,
} from "./run-catalog.js";
import type { RunSummary } from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";
export { findWorkspaceRoot } from "./workspace-root.js";

export type PersistedRun = {
  schemaVersion: 2 | 3 | 4 | 5;
  id: string;
  projectId?: string;
  ownerId?: string;
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
  evidence?: EvidenceManifest;
};

export type RunArtifact = TestJob["artifacts"][number];

const finalizing = new Map<string, Promise<PersistedRun>>();
const COMPLETE_MARKER = ".complete";

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
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

function terminalStatus(status: TestJob["status"]): boolean {
  return status === "ok" || status === "error" || status === "healed" || status === "cancelled";
}

function buildPersistedRun(job: TestJob, dir: string, writtenAt: number): PersistedRun {
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
  return {
    schemaVersion: 5,
    id: job.id,
    projectId: job.projectId,
    ownerId: job.ownerId,
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
    logs: job.logs.map(redactText),
    steps,
    frames,
    frameCount: frames.length,
    dir,
    writtenAt,
    recipeSnapshot: redactValue(job.recipeSnapshot) as TestJob["recipeSnapshot"],
    artifacts: redactValue(job.artifacts) as TestJob["artifacts"],
    inputDigest: createHash("sha256").update(frozenInput).digest("hex"),
    resolvedInputs: redactResolvedInputs(job.resolvedInputs),
    evidence: redactValue(job.evidence) as EvidenceManifest | undefined,
  };
}

async function readCompletedRun(dir: string): Promise<PersistedRun | null> {
  if (!existsSync(join(dir, COMPLETE_MARKER))) return null;
  try {
    const raw = await readFile(join(dir, "run.json"), "utf8");
    const marker = JSON.parse(await readFile(join(dir, COMPLETE_MARKER), "utf8")) as {
      digest?: string;
    };
    if (marker.digest !== createHash("sha256").update(raw).digest("hex")) return null;
    return JSON.parse(raw) as PersistedRun;
  } catch {
    return null;
  }
}

async function persistRunOnce(job: TestJob): Promise<PersistedRun> {
  if (!terminalStatus(job.status) || !job.finishedAt) {
    throw new Error(`cannot finalize non-terminal run ${job.id} (${job.status})`);
  }
  const dir = await ensureRunDir(job);
  const completed = await readCompletedRun(dir);
  const payload = buildPersistedRun(job, dir, completed?.writtenAt ?? now());
  const json = JSON.stringify(payload, null, 2);

  if (completed) {
    if (JSON.stringify(completed, null, 2) !== json) {
      throw new Error(
        `run integrity conflict: ${job.id} was already finalized with different data`,
      );
    }
    job.persisted = true;
    return completed;
  }

  const token = randomUUID();
  const temporary = {
    run: join(dir, `.run.json.${token}.tmp`),
    manifest: join(dir, `.report-manifest.json.${token}.tmp`),
    log: join(dir, `.log.txt.${token}.tmp`),
    marker: join(dir, `.complete.${token}.tmp`),
  };
  const digest = createHash("sha256").update(json).digest("hex");

  try {
    await Promise.all([
      writeFile(temporary.run, json, { encoding: "utf8", flag: "wx" }),
      writeFile(temporary.manifest, json, { encoding: "utf8", flag: "wx" }),
      writeFile(temporary.log, payload.logs.join("\n"), { encoding: "utf8", flag: "wx" }),
      writeFile(temporary.marker, JSON.stringify({ schemaVersion: 1, id: job.id, digest }), {
        encoding: "utf8",
        flag: "wx",
      }),
    ]);
    await Promise.all(Object.values(temporary).map(syncPath));
    await rename(temporary.run, join(dir, "run.json"));
    await rename(temporary.manifest, join(dir, "report-manifest.json"));
    await rename(temporary.log, join(dir, "log.txt"));
    await syncPath(dir);
    // The marker is the commit point. Readers ignore schema-v5 manifests until
    // this final rename succeeds, so a crash can leave recoverable files but
    // never a report that looks complete.
    await rename(temporary.marker, join(dir, COMPLETE_MARKER));
    await syncPath(dir);
    // The catalog is a rebuildable accelerator. The immutable manifest remains
    // authoritative if indexing is interrupted.
    await indexRun(runsRoot(), payload as unknown as Record<string, unknown>).catch(
      () => undefined,
    );
  } finally {
    await Promise.all(Object.values(temporary).map((path) => unlink(path).catch(() => undefined)));
  }
  job.persisted = true;
  return payload;
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function persistRun(job: TestJob): Promise<PersistedRun> {
  const pending = finalizing.get(job.id);
  if (pending) return pending;
  const next = persistRunOnce(job).finally(() => finalizing.delete(job.id));
  finalizing.set(job.id, next);
  return next;
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
      let parsed = JSON.parse(raw) as PersistedRun;
      if (parsed.schemaVersion >= 5) {
        const committed = await readCompletedRun(dir);
        if (!committed) continue;
        parsed = committed;
      }
      parsed.dir = dir;
      runs.push(parsed);
    } catch {
      /* skip incomplete */
    }
  }
  return runs;
}

export async function listRunSummaries(limit = 40): Promise<RunSummary[]> {
  const root = runsRoot();
  let summaries = await catalogSummaries(root, limit);
  if (summaries.length === 0) {
    await rebuildRunCatalog(root);
    summaries = await catalogSummaries(root, limit);
  }
  return summaries;
}

export async function readPersistedRun(idOrDir: string): Promise<PersistedRun | null> {
  // Match by exact folder name or trailing _<id> segment only — never loose includes().
  const needle = idOrDir.trim();
  if (!needle || needle.includes("/") || needle.includes("\\") || needle.includes("..")) {
    return null;
  }
  const root = runsRoot();
  try {
    const indexed = await catalogRunDirectory(root, needle);
    if (indexed) {
      const raw = await readFile(join(indexed, "run.json"), "utf8");
      let parsed = JSON.parse(raw) as PersistedRun;
      if (parsed.schemaVersion >= 5) {
        const committed = await readCompletedRun(indexed);
        if (!committed) return null;
        parsed = committed;
      }
      parsed.dir = indexed;
      return parsed;
    }
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
    let parsed = JSON.parse(raw) as PersistedRun;
    if (parsed.schemaVersion >= 5) {
      const committed = await readCompletedRun(dir);
      if (!committed) return null;
      parsed = committed;
    }
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
  if (!safe || safe !== file || !/\.(mp4|webm)$/i.test(safe)) return null;
  return join(runDir, area, safe);
}

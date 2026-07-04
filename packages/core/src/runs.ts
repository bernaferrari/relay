/**
 * Persist runs to disk — mirrors qa-viewer runs/<ts>_<flow>_<device>/ layout.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import type { TestJob } from "./session.js";
import type { TraceFrameRef, TraceStep } from "./trace.js";
import { now } from "./events.js";

export type PersistedRun = {
  id: string;
  action: string;
  serial?: string;
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
  logs: string[];
  steps: TraceStep[];
  frames: TraceFrameRef[];
  dir: string;
  writtenAt: number;
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function findWorkspaceRoot(start = process.cwd()): string {
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
  const env = process.env.GROK_DEVICE_RUNS_DIR?.trim();
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
    await mkdir(join(job.runDir, "frames"), { recursive: true });
    return job.runDir;
  }
  const dir = join(runsRoot(), formatRunFolder(job));
  await mkdir(join(dir, "frames"), { recursive: true });
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
  job.frames.push(frame);
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

  const payload: PersistedRun = {
    id: job.id,
    action: job.action,
    serial: job.serial,
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
    logs: job.logs,
    steps,
    frames,
    dir,
    writtenAt: now(),
  };

  await writeFile(join(dir, "run.json"), JSON.stringify(payload, null, 2), "utf8");
  await writeFile(join(dir, "log.txt"), job.logs.join("\n"), "utf8");
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
  // by id prefix or full folder name
  const root = runsRoot();
  try {
    const entries = await readdir(root);
    const match =
      entries.find((e) => e === idOrDir || e.endsWith(`_${idOrDir}`) || e.includes(idOrDir)) ??
      null;
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

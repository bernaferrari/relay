import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { Writable } from "node:stream";
import {
  captureReviewIdentityFramePaths,
  captureReviewLeftoverLastFramePaths,
  destIdentityCheckpointFramePaths,
  isCaptureReviewLeftoverCaption,
  projectCaptureReviewDestIdentity,
} from "@relay/protocol";

const PNG = /\.png$/iu;
const MAX_PNGS = 50;

export function teeWritable(destination: Writable): { writable: Writable; text: () => string } {
  let collected = "";
  const writable = new Writable({
    decodeStrings: false,
    write(chunk, _encoding, callback) {
      collected += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      destination.write(chunk);
      callback();
    },
  });
  return { writable, text: () => collected };
}

export function pngPathsIn(value: unknown, found = new Set<string>()): string[] {
  if (typeof value === "string") {
    if (PNG.test(value)) found.add(value);
    return [...found];
  }
  if (Array.isArray(value)) {
    for (const item of value) pngPathsIn(item, found);
    return [...found];
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) pngPathsIn(item, found);
  }
  return [...found];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function jobsFromEnvelope(envelope: unknown): Record<string, unknown>[] {
  const root = asRecord(envelope);
  const result = asRecord(root?.result) ?? root;
  if (!result) return [];
  if (Array.isArray(result.jobs)) {
    return result.jobs.flatMap((job) => {
      const record = asRecord(job);
      return record ? [record] : [];
    });
  }
  const job = asRecord(result.job);
  return job ? [job] : [];
}

function jobRunDir(job: Record<string, unknown>): string | undefined {
  const resources = asRecord(job.resources);
  const dir = job.runDir ?? resources?.runDir;
  return typeof dir === "string" && dir.trim() ? dir.trim() : undefined;
}

function jobFolderName(job: Record<string, unknown>, used: Set<string>): string {
  const id = typeof job.id === "string" ? job.id.trim() : "";
  if (!id) {
    let name = "run";
    let extra = 1;
    while (used.has(name)) {
      name = `run-${extra}`;
      extra += 1;
    }
    used.add(name);
    return name;
  }
  let width = Math.min(8, id.length);
  let name = id.slice(0, width);
  while (used.has(name) && width < id.length) {
    width += 1;
    name = id.slice(0, width);
  }
  if (used.has(name)) {
    let extra = 1;
    while (used.has(`${name}-${extra}`)) extra += 1;
    name = `${name}-${extra}`;
  }
  used.add(name);
  return name;
}

function runDirsIn(value: unknown, found = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) runDirsIn(item, found);
    return [...found];
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.runDir === "string" && record.runDir.trim()) found.add(record.runDir);
    for (const item of Object.values(record)) runDirsIn(item, found);
  }
  return [...found];
}

async function pngsUnder(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !PNG.test(entry.name)) continue;
      files.push(join(entry.parentPath ?? dir, entry.name));
      if (files.length >= MAX_PNGS) break;
    }
    return files;
  } catch {
    return [];
  }
}

function uniqueDest(dir: string, fileName: string, used: Set<string>): string {
  let name = fileName;
  let n = 1;
  while (used.has(name)) {
    const dot = fileName.lastIndexOf(".");
    name = `${fileName.slice(0, dot)}-${n}${fileName.slice(dot)}`;
    n += 1;
  }
  used.add(name);
  return join(dir, name);
}

function resolveInRunDir(runDir: string, framePath: string): string {
  return isAbsolute(framePath) ? framePath : join(runDir, framePath);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function listedFramePaths(job: Record<string, unknown>): string[] {
  return jobFrames(job).map((frame) => frame.path);
}

function jobArtifacts(job: Record<string, unknown>): { kind?: string; data?: unknown }[] {
  if (!Array.isArray(job.artifacts)) return [];
  return job.artifacts.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function destIdentitySummaryPaths(job: Record<string, unknown>): string[] {
  const frames = (Array.isArray(job.destIdentity) ? job.destIdentity : []).flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [{ path: item.trim() }];
    const record = asRecord(item);
    const path = typeof record?.path === "string" ? record.path.trim() : "";
    if (!path) return [];
    const caption = typeof record?.caption === "string" ? record.caption : undefined;
    return [{ path, ...(caption ? { caption } : {}) }];
  });
  return projectCaptureReviewDestIdentity([], [], frames).map((frame) => frame.path);
}

function jobFrames(job: Record<string, unknown>): { path: string; caption?: string }[] {
  const frames = Array.isArray(job.frames) ? job.frames : [];
  return frames.flatMap((frame) => {
    const record = asRecord(frame);
    const path = typeof frame === "string" ? frame.trim() : record?.path;
    if (typeof path !== "string" || !path.trim()) return [];
    const caption = typeof record?.caption === "string" ? record.caption : undefined;
    return [{ path: path.trim(), ...(caption ? { caption } : {}) }];
  });
}

async function persistedJob(runDir: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(runDir, "run.json"), "utf8")) as unknown;
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function mergeJob(
  job: Record<string, unknown>,
  persisted?: Record<string, unknown>,
): Record<string, unknown> {
  if (!persisted) return job;
  const artifacts = jobArtifacts(job);
  const frames = Array.isArray(job.frames) && job.frames.length ? job.frames : persisted.frames;
  return {
    ...persisted,
    ...job,
    artifacts: artifacts.length ? job.artifacts : persisted.artifacts,
    frames,
  };
}

async function firstExisting(runDir: string, framePaths: string[]): Promise<string | undefined> {
  for (const framePath of framePaths) {
    const abs = resolveInRunDir(runDir, framePath);
    if (await isFile(abs)) return abs;
  }
  return undefined;
}

async function checkpointSource(
  job: Record<string, unknown>,
  runDir: string,
): Promise<string | undefined> {
  const merged = mergeJob(job, await persistedJob(runDir));
  const artifacts = jobArtifacts(merged);
  const frames = jobFrames(merged);
  const dest = [...captureReviewIdentityFramePaths(artifacts), ...destIdentitySummaryPaths(merged)];
  const leftover = new Set(captureReviewLeftoverLastFramePaths(frames, artifacts));
  const destPaths = dest.length ? [...new Set(dest)] : [];
  const found = destPaths.length
    ? await firstExisting(runDir, destPaths)
    : await firstExisting(
        runDir,
        [...destIdentityCheckpointFramePaths(frames, artifacts)].reverse(),
      );
  if (found) return found;
  if (dest.length) return undefined;
  const listed = listedFramePaths(merged).filter((path) => !leftover.has(path));
  const fallback = await firstExisting(
    runDir,
    [...(listed.length ? listed : listedFramePaths(merged))].reverse(),
  );
  if (fallback) return fallback;
  const pngs = await pngsUnder(runDir);
  const usable = leftover.size
    ? pngs.filter((file) => !leftover.has(relativeFromRunDir(runDir, file)))
    : pngs;
  return (usable.length ? usable : pngs).at(-1);
}

async function copyablePngs(job: Record<string, unknown>, runDir: string): Promise<string[]> {
  const pngs = await pngsUnder(runDir);
  const merged = mergeJob(job, await persistedJob(runDir));
  const artifacts = jobArtifacts(merged);
  const frames = jobFrames(merged);
  const dest = [...captureReviewIdentityFramePaths(artifacts), ...destIdentitySummaryPaths(merged)];
  const leftover = new Set(captureReviewLeftoverLastFramePaths(frames, artifacts));
  /** Missing dest-phase is not every PNG: leftover Transition executed /
   * Inspect setup skipped cannot sit beside Observe. Unphased Android dest-wait
   * with no leftover caption still keeps every frame. */
  if (!dest.length) {
    const keep = destIdentityCheckpointFramePaths(frames, artifacts);
    const hasLeftoverCaption = frames.some((frame) =>
      isCaptureReviewLeftoverCaption(frame.caption),
    );
    if (keep.length && hasLeftoverCaption) {
      const keepSet = new Set(keep);
      return pngs.filter((file) => keepSet.has(relativeFromRunDir(runDir, file)));
    }
    return pngs;
  }
  if (!leftover.size) return pngs;
  return pngs.filter((file) => !leftover.has(relativeFromRunDir(runDir, file)));
}

function relativeFromRunDir(runDir: string, file: string): string {
  const rel = relative(runDir, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return basename(file);
  return rel;
}

async function copyNamed(source: string, dest: string, copied: string[]): Promise<void> {
  if (copied.length >= MAX_PNGS) return;
  if (copied.includes(dest)) return;
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(source, dest);
  copied.push(dest);
}

/** Write result.json, stderr.log, and any local PNG paths the job produced. */
export async function writeRunOutDir(input: {
  dir: string;
  envelope: unknown;
  stderr: string;
}): Promise<string[]> {
  await mkdir(input.dir, { recursive: true });
  await writeFile(join(input.dir, "result.json"), `${JSON.stringify(input.envelope)}\n`);
  await writeFile(join(input.dir, "stderr.log"), input.stderr);
  const copied: string[] = [];
  const jobs = jobsFromEnvelope(input.envelope);
  const folderNames = new Set<string>();
  const outs: Array<{
    folder: string;
    runDir: string;
    checkpoint?: string;
    files: string[];
  }> = [];
  for (const job of jobs) {
    const runDir = jobRunDir(job);
    if (!runDir) continue;
    outs.push({
      folder: jobFolderName(job, folderNames),
      runDir,
      checkpoint: await checkpointSource(job, runDir),
      files: await copyablePngs(job, runDir),
    });
  }
  const packCheckpoint = [...outs].reverse().find((job) => job.checkpoint)?.checkpoint;
  if (packCheckpoint) {
    await copyNamed(packCheckpoint, join(input.dir, "checkpoint.png"), copied);
  }
  for (const out of outs) {
    if (out.checkpoint) {
      await copyNamed(out.checkpoint, join(input.dir, out.folder, "checkpoint.png"), copied);
    }
    for (const file of out.files) {
      await copyNamed(
        file,
        join(input.dir, out.folder, relativeFromRunDir(out.runDir, file)),
        copied,
      );
    }
  }
  if (outs.length > 0) return copied;

  const used = new Set(["result.json", "stderr.log"]);
  const candidates = new Set(pngPathsIn(input.envelope));
  for (const dir of runDirsIn(input.envelope)) {
    for (const file of await pngsUnder(dir)) candidates.add(file);
  }
  for (const source of candidates) {
    if (!(await isFile(source))) continue;
    const dest = uniqueDest(input.dir, basename(source), used);
    await copyFile(source, dest);
    copied.push(dest);
    if (copied.length >= MAX_PNGS) break;
  }
  return copied;
}

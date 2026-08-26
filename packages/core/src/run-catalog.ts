import { DatabaseSync } from "node:sqlite";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { RunReview, RunSummary } from "@relay/protocol";
import { parseOptionalSourceRevision } from "@relay/protocol";

type CatalogRecord = RunSummary & { dir: string };

export type CatalogSurfaceComparison = {
  runId: string;
  at: number;
  artifactCapturedAt: number;
};

const SURFACE_COMPARISON_KEY = /^surface-comparison-v1-[a-f0-9]{64}$/;

function database(root: string): DatabaseSync {
  const db = new DatabaseSync(join(root, ".catalog.sqlite"));
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      dir TEXT NOT NULL UNIQUE,
      action TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      outcome TEXT,
      review_json TEXT,
      platform TEXT,
      serial TEXT,
      batch_id TEXT,
      queued_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      duration_ms INTEGER,
      written_at INTEGER NOT NULL,
      frame_count INTEGER NOT NULL,
      artifact_count INTEGER NOT NULL,
      artifact_bytes INTEGER NOT NULL,
      storage_bytes INTEGER NOT NULL DEFAULT 0,
      evidence_complete INTEGER,
      pinned INTEGER NOT NULL DEFAULT 0,
      retention_class TEXT NOT NULL DEFAULT 'standard'
    );
    CREATE INDEX IF NOT EXISTS runs_written_at ON runs(written_at DESC);
    CREATE TABLE IF NOT EXISTS surface_comparisons (
      cache_key TEXT NOT NULL,
      run_id TEXT NOT NULL,
      artifact_captured_at INTEGER NOT NULL,
      run_written_at INTEGER NOT NULL,
      PRIMARY KEY (cache_key, run_id, artifact_captured_at)
    );
    CREATE INDEX IF NOT EXISTS surface_comparisons_exact_key
      ON surface_comparisons(cache_key, run_written_at DESC, artifact_captured_at DESC);
  `);
  const columns = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name?: string }>;
  if (!columns.some((column) => column.name === "review_json")) {
    db.exec("ALTER TABLE runs ADD COLUMN review_json TEXT");
  }
  if (!columns.some((column) => column.name === "source_revision_json")) {
    db.exec("ALTER TABLE runs ADD COLUMN source_revision_json TEXT");
  }
  if (!columns.some((column) => column.name === "storage_bytes")) {
    db.exec("ALTER TABLE runs ADD COLUMN storage_bytes INTEGER NOT NULL DEFAULT 0");
  }
  db.exec("PRAGMA user_version=2");
  return db;
}

function rowToRecord(row: Record<string, unknown>): CatalogRecord {
  return {
    id: String(row.id),
    dir: String(row.dir),
    action: String(row.action),
    ...(row.title ? { title: String(row.title) } : {}),
    status: String(row.status),
    queuedAt: Number(row.queued_at),
    ...(row.started_at == null ? {} : { startedAt: Number(row.started_at) }),
    ...(row.finished_at == null ? {} : { finishedAt: Number(row.finished_at) }),
    ...(row.duration_ms == null ? {} : { durationMs: Number(row.duration_ms) }),
    ...(row.platform ? { platform: String(row.platform) } : {}),
    ...(row.serial ? { serial: String(row.serial) } : {}),
    ...(row.outcome ? { outcome: String(row.outcome) } : {}),
    ...(row.review_json ? { review: JSON.parse(String(row.review_json)) as RunReview } : {}),
    ...(row.source_revision_json
      ? {
          sourceRevision: parseOptionalSourceRevision(JSON.parse(String(row.source_revision_json))),
        }
      : {}),
    ...(row.batch_id ? { batchId: String(row.batch_id) } : {}),
    frameCount: Number(row.frame_count),
    writtenAt: Number(row.written_at),
    artifactCount: Number(row.artifact_count),
    artifactBytes: Number(row.artifact_bytes),
    storageBytes: Number(row.storage_bytes),
    ...(row.evidence_complete == null ? {} : { evidenceComplete: Boolean(row.evidence_complete) }),
    pinned: Boolean(row.pinned),
    retentionClass: row.retention_class === "protected" ? "protected" : "standard",
  };
}

async function committedDirectoryBytes(directory: string): Promise<number> {
  let total = 0;
  const visit = async (path: string): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`run directory contains unsupported entry: ${child}`);
      }
      total += (await stat(child)).size;
      if (!Number.isSafeInteger(total)) throw new Error("run directory byte count is unsafe");
    }
  };
  await visit(directory);
  return total;
}

function indexedSurfaceComparisons(run: Record<string, unknown>): Array<{
  key: string;
  capturedAt: number;
}> {
  if (!Array.isArray(run.artifacts)) return [];
  const indexed: Array<{ key: string; capturedAt: number }> = [];
  for (const artifact of run.artifacts) {
    if (!artifact || typeof artifact !== "object") continue;
    const item = artifact as { kind?: unknown; capturedAt?: unknown; data?: unknown };
    if (
      item.kind !== "logical-scroll-surface-result" ||
      !item.data ||
      typeof item.data !== "object"
    ) {
      continue;
    }
    const cache = (item.data as { cache?: unknown }).cache;
    if (!cache || typeof cache !== "object") continue;
    const key = (cache as { key?: unknown }).key;
    if (typeof key !== "string" || !SURFACE_COMPARISON_KEY.test(key)) continue;
    const capturedAt = typeof item.capturedAt === "number" ? item.capturedAt : 0;
    if (!Number.isFinite(capturedAt)) continue;
    indexed.push({ key, capturedAt });
  }
  return indexed;
}

export async function indexRun(root: string, run: Record<string, unknown>): Promise<void> {
  await mkdir(root, { recursive: true });
  const storageBytes = await committedDirectoryBytes(String(run.dir));
  const db = database(root);
  try {
    const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
    const frames = Array.isArray(run.frames) ? run.frames : [];
    const frameBytes = frames.reduce(
      (total, frame) =>
        total +
        (frame &&
        typeof frame === "object" &&
        typeof (frame as { bytes?: unknown }).bytes === "number"
          ? (frame as { bytes: number }).bytes
          : 0),
      0,
    );
    const artifactBytes =
      frameBytes +
      artifacts.reduce((total, artifact) => {
        if (!artifact || typeof artifact !== "object") return total;
        const data = (artifact as { data?: unknown }).data;
        if (!data || typeof data !== "object") return total;
        const files = (data as { files?: unknown }).files;
        if (!Array.isArray(files)) return total;
        return (
          total +
          files.reduce(
            (sum, file) =>
              sum +
              (file &&
              typeof file === "object" &&
              typeof (file as { bytes?: unknown }).bytes === "number"
                ? (file as { bytes: number }).bytes
                : 0),
            0,
          )
        );
      }, 0);
    const evidence = run.evidence as { finishedAt?: unknown } | undefined;
    db.prepare(`
      INSERT INTO runs (
        id, dir, action, title, status, outcome, review_json, platform, serial, batch_id,
        queued_at, started_at, finished_at, duration_ms, written_at, frame_count,
        artifact_count, artifact_bytes, storage_bytes, evidence_complete, source_revision_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        dir=excluded.dir, action=excluded.action, title=excluded.title, status=excluded.status,
        outcome=excluded.outcome, review_json=excluded.review_json, platform=excluded.platform, serial=excluded.serial,
        batch_id=excluded.batch_id, queued_at=excluded.queued_at, started_at=excluded.started_at,
        finished_at=excluded.finished_at, duration_ms=excluded.duration_ms,
        written_at=excluded.written_at, frame_count=excluded.frame_count,
        artifact_count=excluded.artifact_count, artifact_bytes=excluded.artifact_bytes,
        storage_bytes=excluded.storage_bytes, evidence_complete=excluded.evidence_complete,
        source_revision_json=excluded.source_revision_json
    `).run(
      String(run.id),
      String(run.dir),
      String(run.action),
      run.title == null ? null : String(run.title),
      String(run.status),
      run.outcome == null ? null : String(run.outcome),
      run.review == null ? null : JSON.stringify(run.review),
      run.platform == null ? null : String(run.platform),
      run.serial == null ? null : String(run.serial),
      run.batchId == null ? null : String(run.batchId),
      Number(run.queuedAt),
      run.startedAt == null ? null : Number(run.startedAt),
      run.finishedAt == null ? null : Number(run.finishedAt),
      run.durationMs == null ? null : Number(run.durationMs),
      Number(run.writtenAt),
      Number(run.frameCount ?? frames.length),
      artifacts.length,
      artifactBytes,
      storageBytes,
      evidence?.finishedAt ? 1 : 0,
      run.sourceRevision == null ? null : JSON.stringify(run.sourceRevision),
    );
    db.prepare("DELETE FROM surface_comparisons WHERE run_id=?").run(String(run.id));
    const insertSurfaceComparison = db.prepare(`
      INSERT INTO surface_comparisons(cache_key, run_id, artifact_captured_at, run_written_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const comparison of indexedSurfaceComparisons(run)) {
      insertSurfaceComparison.run(
        comparison.key,
        String(run.id),
        comparison.capturedAt,
        Number(run.writtenAt),
      );
    }
  } finally {
    db.close();
  }
}

/** Exact-key accelerator for reusable immutable surface evidence. The canonical
 * run manifest remains authoritative; callers reload the selected immutable
 * manifest before considering its artifact. */
export async function catalogSurfaceComparisons(
  root: string,
  cacheKey: string,
): Promise<CatalogSurfaceComparison[]> {
  if (!SURFACE_COMPARISON_KEY.test(cacheKey)) return [];
  await mkdir(root, { recursive: true });
  const db = database(root);
  try {
    const rows = db
      .prepare(
        `SELECT run_id, artifact_captured_at, run_written_at
         FROM surface_comparisons WHERE cache_key=?
         ORDER BY run_written_at DESC, artifact_captured_at DESC LIMIT 32`,
      )
      .all(cacheKey) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      runId: String(row.run_id),
      at: Number(row.run_written_at),
      artifactCapturedAt: Number(row.artifact_captured_at),
    }));
  } finally {
    db.close();
  }
}

export async function catalogSummaries(
  root: string,
  limit = 40,
  actionPrefix?: string,
): Promise<RunSummary[]> {
  await mkdir(root, { recursive: true });
  const db = database(root);
  try {
    const rows = (
      actionPrefix
        ? db
            .prepare(
              "SELECT * FROM runs WHERE substr(action, 1, ?) = ? ORDER BY written_at DESC LIMIT ?",
            )
            .all(actionPrefix.length, actionPrefix, limit)
        : db.prepare("SELECT * FROM runs ORDER BY written_at DESC LIMIT ?").all(limit)
    ) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const { dir: _dir, ...summary } = rowToRecord(row);
      return summary;
    });
  } finally {
    db.close();
  }
}

export async function catalogRunDirectory(root: string, id: string): Promise<string | null> {
  await mkdir(root, { recursive: true });
  const db = database(root);
  try {
    const row = db.prepare("SELECT dir FROM runs WHERE id=?").get(id) as
      | { dir?: string }
      | undefined;
    return row?.dir ?? null;
  } finally {
    db.close();
  }
}

export async function setRunPinned(root: string, id: string, pinned: boolean): Promise<boolean> {
  await mkdir(root, { recursive: true });
  const db = database(root);
  try {
    return db.prepare("UPDATE runs SET pinned=? WHERE id=?").run(pinned ? 1 : 0, id).changes > 0;
  } finally {
    db.close();
  }
}

export async function rebuildRunCatalog(
  root: string,
): Promise<{ indexed: number; incomplete: number }> {
  await mkdir(root, { recursive: true });
  const db = database(root);
  db.exec("DELETE FROM runs");
  db.exec("DELETE FROM surface_comparisons");
  db.close();
  let indexed = 0;
  let incomplete = 0;
  for (const entry of await readdir(root)) {
    const dir = join(root, entry);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
      const raw = await readFile(join(dir, "run.json"), "utf8");
      const run = JSON.parse(raw) as Record<string, unknown>;
      if (Number(run.schemaVersion) >= 5) {
        const marker = JSON.parse(await readFile(join(dir, ".complete"), "utf8")) as {
          digest?: string;
        };
        if (marker.digest !== createHash("sha256").update(raw).digest("hex")) {
          throw new Error("run commit marker digest mismatch");
        }
      }
      run.dir = dir;
      await indexRun(root, run);
      indexed += 1;
    } catch {
      if (!entry.startsWith(".")) incomplete += 1;
    }
  }
  const checkedAt = Date.now();
  const metadata = database(root);
  metadata
    .prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES('last_integrity_check',?)")
    .run(String(checkedAt));
  metadata.close();
  return { indexed, incomplete };
}

export type RetentionPolicy = { maxAgeDays?: number; maxBytes?: number; dryRun?: boolean };

export async function applyRunRetention(
  root: string,
  policy: RetentionPolicy,
): Promise<{ disabled: boolean; candidates: RunSummary[]; deleted: string[] }> {
  if (!policy.maxAgeDays && !policy.maxBytes)
    return { disabled: true, candidates: [], deleted: [] };
  const db = database(root);
  const rows = db.prepare("SELECT * FROM runs ORDER BY written_at ASC").all() as Array<
    Record<string, unknown>
  >;
  const records = rows.map(rowToRecord);
  const cutoff = policy.maxAgeDays ? Date.now() - policy.maxAgeDays * 86_400_000 : -Infinity;
  let total = records.reduce((sum, run) => sum + run.storageBytes, 0);
  const candidates: CatalogRecord[] = [];
  for (const run of records) {
    if (run.pinned || run.retentionClass === "protected") continue;
    if (run.writtenAt < cutoff || (policy.maxBytes !== undefined && total > policy.maxBytes)) {
      candidates.push(run);
      total -= run.storageBytes;
    }
  }
  const deleted: string[] = [];
  if (!policy.dryRun) {
    const audit = join(root, "retention-audit.jsonl");
    for (const run of candidates) {
      const directory = resolve(run.dir);
      if (resolve(root, basename(directory)) !== directory) continue;
      await rm(directory, { recursive: true, force: true });
      db.prepare("DELETE FROM surface_comparisons WHERE run_id=?").run(run.id);
      db.prepare("DELETE FROM runs WHERE id=?").run(run.id);
      await writeFile(
        audit,
        `${JSON.stringify({ at: Date.now(), action: "delete", runId: run.id, dir: basename(directory) })}\n`,
        { flag: "a", mode: 0o600 },
      );
      deleted.push(run.id);
    }
  }
  db.close();
  return {
    disabled: false,
    candidates: candidates.map(({ dir: _dir, ...summary }) => summary),
    deleted,
  };
}

export async function runStorageHealth(root: string): Promise<{
  totalRuns: number;
  artifactBytes: number;
  storageBytes: number;
  incomplete: number;
  lastIntegrityCheck?: number;
}> {
  await mkdir(root, { recursive: true });
  const db = database(root);
  const totals = db
    .prepare(
      "SELECT COUNT(*) AS total, COALESCE(SUM(artifact_bytes),0) AS artifact_bytes, COALESCE(SUM(storage_bytes),0) AS storage_bytes FROM runs",
    )
    .get() as { total: number; artifact_bytes: number; storage_bytes: number };
  const checked = db
    .prepare("SELECT value FROM metadata WHERE key='last_integrity_check'")
    .get() as { value: string } | undefined;
  db.close();
  let incomplete = 0;
  for (const entry of await readdir(root)) {
    if (entry.startsWith(".")) continue;
    try {
      const info = await stat(join(root, entry));
      if (info.isDirectory()) await stat(join(root, entry, "run.json"));
    } catch {
      incomplete += 1;
    }
  }
  return {
    totalRuns: Number(totals.total),
    artifactBytes: Number(totals.artifact_bytes),
    storageBytes: Number(totals.storage_bytes),
    incomplete,
    ...(checked ? { lastIntegrityCheck: Number(checked.value) } : {}),
  };
}

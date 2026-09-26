import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AuthoringSession } from "@relay/protocol";
import {
  authoringCaptureProvenance,
  parseAuthoringDebugOrigin,
  serializeAuthoringSession,
} from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";

function sessionsRoot(): string {
  const state = process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
  return join(state, "authoring-sessions");
}

function safeSessionId(value: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) throw new Error("Invalid Authoring Session id");
  return value;
}

export function authoringSessionPath(id: string): string {
  return join(sessionsRoot(), `${safeSessionId(id)}.json`);
}

export async function writeAuthoringSession(session: AuthoringSession): Promise<void> {
  await mkdir(sessionsRoot(), { recursive: true, mode: 0o700 });
  const destination = authoringSessionPath(session.id);
  const staged = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(staged, "wx", 0o600);
    try {
      await file.writeFile(poolObservations(serializeAuthoringSession(session)));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(staged, destination);
    const directory = await open(sessionsRoot(), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(staged).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }
}

function parseAuthoringSession(value: unknown): AuthoringSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<AuthoringSession>;
  if (
    input.schemaVersion !== 1 ||
    typeof input.id !== "string" ||
    typeof input.projectId !== "string" ||
    typeof input.actorId !== "string" ||
    typeof input.state !== "string" ||
    !input.target ||
    typeof input.leaseId !== "string"
  )
    return null;
  return {
    ...(input as AuthoringSession),
    captureProvenance: authoringCaptureProvenance(input.captureProvenance),
    ...(input.debugOrigin ? { debugOrigin: parseAuthoringDebugOrigin(input.debugOrigin) } : {}),
  };
}

/**
 * Each Take revision snapshots every observation so far, so a long recording
 * repeats the same accessibility trees in every revision (~90% of the file).
 * On disk, identical observations (including each revision's before/after
 * screen) are stored once in `observationPool` and revisions/replay attempts
 * reference them by hash. Files without a pool
 * (older ones) read unchanged.
 */
type StoredObservationList = {
  observations?: unknown;
  observationRefs?: string[];
  before?: unknown;
  beforeRef?: string;
  after?: unknown;
  afterRef?: string;
};

function poolObservations(serialized: string): string {
  const stored = JSON.parse(serialized) as {
    take?: { revisions?: StoredObservationList[]; replayAttempts?: StoredObservationList[] };
    observationPool?: Record<string, unknown>;
  };
  const pool: Record<string, unknown> = {};
  const pooled = (observation: unknown) => {
    const hash = createHash("sha256").update(JSON.stringify(observation)).digest("hex");
    pool[hash] = observation;
    return hash;
  };
  const lists = [...(stored.take?.revisions ?? []), ...(stored.take?.replayAttempts ?? [])];
  for (const list of lists) {
    if (Array.isArray(list.observations)) {
      list.observationRefs = list.observations.map(pooled);
      delete list.observations;
    }
    // A revision's before/after screens usually repeat observations too.
    if (list.before && typeof list.before === "object") {
      list.beforeRef = pooled(list.before);
      delete list.before;
    }
    if (list.after && typeof list.after === "object") {
      list.afterRef = pooled(list.after);
      delete list.after;
    }
  }
  if (!Object.keys(pool).length) return serialized;
  stored.observationPool = pool;
  return JSON.stringify(stored);
}

function expandObservations(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("observationPool" in value)) return value;
  const { observationPool: pool, ...stored } = value as {
    observationPool: Record<string, unknown>;
    take?: { revisions?: StoredObservationList[]; replayAttempts?: StoredObservationList[] };
  };
  for (const list of [...(stored.take?.revisions ?? []), ...(stored.take?.replayAttempts ?? [])]) {
    const pooled = (hash: string) => {
      if (!(hash in pool)) throw new Error("Authoring Session observation is missing");
      return structuredClone(pool[hash]);
    };
    if (Array.isArray(list.observationRefs)) {
      list.observations = list.observationRefs.map(pooled);
      delete list.observationRefs;
    }
    if (typeof list.beforeRef === "string") {
      list.before = pooled(list.beforeRef);
      delete list.beforeRef;
    }
    if (typeof list.afterRef === "string") {
      list.after = pooled(list.afterRef);
      delete list.afterRef;
    }
  }
  return stored;
}

export async function readAuthoringSession(id: string): Promise<AuthoringSession | null> {
  try {
    return parseAuthoringSession(
      expandObservations(JSON.parse(await readFile(authoringSessionPath(id), "utf8"))),
    );
  } catch {
    return null;
  }
}

export async function removeAuthoringSession(id: string): Promise<void> {
  await rm(authoringSessionPath(id), { force: true });
}

export async function listAuthoringSessionFiles(): Promise<string[]> {
  try {
    return await readdir(sessionsRoot());
  } catch {
    return [];
  }
}

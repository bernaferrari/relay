import type { CollaborationAwareness } from "@relay/protocol";
import { publish } from "./events.js";
import { currentOperationContext } from "./operation-context.js";

const DEFAULT_TTL_MS = 45_000;
const MAX_ACTORS_PER_PROJECT = 64;

type PresenceKey = string;

const presenceByProject = new Map<string, Map<PresenceKey, CollaborationAwareness>>();

function projectBucket(projectId: string): Map<PresenceKey, CollaborationAwareness> {
  const key = projectId.trim() || "default";
  let bucket = presenceByProject.get(key);
  if (!bucket) {
    bucket = new Map();
    presenceByProject.set(key, bucket);
  }
  return bucket;
}

function prune(bucket: Map<PresenceKey, CollaborationAwareness>, now: number): void {
  for (const [id, actor] of bucket) {
    if (actor.expiresAt <= now) bucket.delete(id);
  }
}

export function listPresence(projectId: string, at = Date.now()): CollaborationAwareness[] {
  const bucket = projectBucket(projectId);
  prune(bucket, at);
  return [...bucket.values()].sort((left, right) => left.actorId.localeCompare(right.actorId));
}

export function upsertPresence(
  input: Omit<CollaborationAwareness, "updatedAt" | "expiresAt"> & {
    projectId?: string;
    ttlMs?: number;
  },
): CollaborationAwareness {
  const operation = currentOperationContext();
  const projectId = input.projectId?.trim() || operation?.projectId?.trim() || "default";
  const actorId = input.actorId.trim();
  if (!actorId) throw new Error("actorId is required");
  const now = Date.now();
  const ttlMs = Math.max(5_000, Math.min(input.ttlMs ?? DEFAULT_TTL_MS, 5 * 60_000));
  const bucket = projectBucket(projectId);
  prune(bucket, now);
  if (!bucket.has(actorId) && bucket.size >= MAX_ACTORS_PER_PROJECT) {
    throw new Error("presence capacity exceeded for this project");
  }
  const next: CollaborationAwareness = {
    actorId,
    actorKind: input.actorKind,
    updatedAt: now,
    expiresAt: now + ttlMs,
    activity: input.activity,
    ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
    ...(input.avatarToken?.trim() ? { avatarToken: input.avatarToken.trim() } : {}),
    ...(input.cursor ? { cursor: { ...input.cursor } } : {}),
    ...(input.selection ? { selection: { ...input.selection } } : {}),
    ...(input.viewport ? { viewport: { ...input.viewport } } : {}),
  };
  bucket.set(actorId, next);
  publish({
    type: "resource.updated",
    at: now,
    projectId,
    resource: "presence",
    resourceId: actorId,
    revision: now,
  });
  return next;
}

export function clearPresence(projectId: string, actorId: string): void {
  const key = projectId.trim() || "default";
  const id = actorId.trim();
  const bucket = projectBucket(key);
  if (!bucket.has(id)) return;
  bucket.delete(id);
  publish({
    type: "resource.deleted",
    at: Date.now(),
    projectId: key,
    resource: "presence",
    resourceId: id,
  });
}

/** Test helper — wipe all presence. */
export function resetPresenceForTests(): void {
  presenceByProject.clear();
}

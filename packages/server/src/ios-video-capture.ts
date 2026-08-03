/**
 * Temporary, local iOS video takes.
 *
 * XCTest can produce review-quality video for a physical iPhone/iPad, but it
 * is not a live transport. Keeping this tiny adapter separate from
 * `live-video.ts` prevents a future Android streaming change from changing
 * Apple capture semantics.
 */
import { access, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { captureDeviceVideo } from "@relay/core";

export type IosVideoTake = {
  id: string;
  serial: string;
  path: string;
  startedAt: number;
  finishedAt?: number;
  state: "recording" | "ready";
  warning?: string;
};

/** A recorder can leave a large `mdat` behind when XCTest disappears without
 * writing the movie index. Browsers render that as a black 0:00 player. Keep
 * the artifact for diagnostics, but never present it as reviewable evidence. */
export function isFinalizedMp4(data: Buffer): boolean {
  return data.subarray(0, 64).includes(Buffer.from("ftyp")) && data.includes(Buffer.from("moov"));
}

const takesById = new Map<string, IosVideoTake>();
const activeTakeBySerial = new Map<string, string>();
const DEFAULT_READY_TAKE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

function id(): string {
  return `ios-take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function iosVideoTakeDirectory(): string {
  const temporaryRoot = process.env.RELAY_TEMP_ROOT?.trim() || tmpdir();
  return join(temporaryRoot, "relay", "ios-takes");
}

function videoPath(takeId: string): string {
  return join(iosVideoTakeDirectory(), `${takeId}.mp4`);
}

function metadataPath(takeId: string): string {
  return join(iosVideoTakeDirectory(), `${takeId}.json`);
}

function isTakeId(value: string): boolean {
  return /^ios-take-[a-z0-9]+-[a-z0-9]+$/.test(value);
}

function isStoredTake(value: unknown, takeId: string): value is IosVideoTake {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<IosVideoTake>;
  return (
    candidate.id === takeId &&
    typeof candidate.serial === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.startedAt === "number" &&
    (candidate.state === "recording" || candidate.state === "ready")
  );
}

async function persistTake(take: IosVideoTake): Promise<void> {
  await writeFile(metadataPath(take.id), JSON.stringify(take), { mode: 0o600 });
}

function pathBelongsToTakeDirectory(path: string): boolean {
  return resolve(dirname(path)) === resolve(iosVideoTakeDirectory());
}

async function finishDeviceRecording(take: IosVideoTake): Promise<{
  path: string;
  warning?: string;
}> {
  try {
    const result = await captureDeviceVideo({ serial: take.serial, action: "stop" });
    return {
      path: result.path ?? take.path,
      ...(result.warning ? { warning: result.warning } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/(?:no active recording|runner session restarted during recording)/i.test(message)) {
      throw error;
    }

    // The daemon can disappear after it has flushed the local file, or before
    // the first frame reaches disk. Neither case should trap the authoring
    // session in Recording forever: preserve evidence when present and finish
    // gracefully with an explicit warning when it is not.
    const preserved = await access(take.path)
      .then(() => true)
      .catch(() => false);
    return {
      path: take.path,
      warning: preserved
        ? "Recording was interrupted when Relay restarted; preserved video may end early."
        : "Recording was interrupted before its video could be saved.",
    };
  }
}

/**
 * Review takes are recoverable across a server restart, but they are temporary:
 * canonical authoring evidence is persisted separately. Keep ready takes for a
 * bounded review window and never let them masquerade as committed run folders.
 */
export async function pruneIosVideoTakes(
  options: { now?: number; maxAgeMs?: number } = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_READY_TAKE_MAX_AGE_MS;
  let files: string[];
  try {
    files = await readdir(iosVideoTakeDirectory());
  } catch {
    return 0;
  }

  let removed = 0;
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const takeId = file.slice(0, -5);
    if (!isTakeId(takeId)) continue;
    try {
      const stored = JSON.parse(await readFile(metadataPath(takeId), "utf8")) as unknown;
      if (!isStoredTake(stored, takeId) || stored.state !== "ready") continue;
      const ageFrom = stored.finishedAt ?? stored.startedAt;
      if (now - ageFrom <= maxAgeMs) continue;
      if (pathBelongsToTakeDirectory(stored.path)) {
        await unlink(stored.path).catch(() => undefined);
      }
      await unlink(metadataPath(takeId));
      takesById.delete(takeId);
      if (activeTakeBySerial.get(stored.serial) === takeId) {
        activeTakeBySerial.delete(stored.serial);
      }
      removed += 1;
    } catch {
      // Damaged or concurrently consumed metadata is left for diagnostics.
    }
  }
  return removed;
}

export async function startIosVideoTake(serial: string): Promise<IosVideoTake> {
  await pruneIosVideoTakes();
  const currentId = activeTakeBySerial.get(serial);
  if (currentId) {
    const current = takesById.get(currentId);
    if (current) return current;
  }
  const takeId = id();
  const path = videoPath(takeId);
  await mkdir(iosVideoTakeDirectory(), { recursive: true, mode: 0o700 });
  const result = await captureDeviceVideo({ serial, action: "start", path });
  const take: IosVideoTake = {
    id: takeId,
    serial,
    path: result.path ?? path,
    startedAt: Date.now(),
    state: "recording",
    ...(result.warning ? { warning: result.warning } : {}),
  };
  takesById.set(take.id, take);
  activeTakeBySerial.set(serial, take.id);
  await persistTake(take);
  return take;
}

export async function stopIosVideoTake(serial: string): Promise<IosVideoTake | null> {
  const takeId = activeTakeBySerial.get(serial);
  if (!takeId) return null;
  const take = takesById.get(takeId);
  activeTakeBySerial.delete(serial);
  if (!take) return null;
  const result = await finishDeviceRecording(take);
  const path = result.path;
  let warning = result.warning;
  try {
    await access(path);
  } catch {
    warning ??= "The Apple runner stopped, but its video file is not ready yet.";
  }
  const complete: IosVideoTake = {
    ...take,
    path,
    finishedAt: Date.now(),
    state: "ready",
    ...(warning ? { warning } : {}),
  };
  takesById.set(takeId, complete);
  await persistTake(complete);
  return complete;
}

export async function readIosVideoTake(takeId: string): Promise<IosVideoTake | null> {
  const inMemory = takesById.get(takeId);
  if (inMemory) return inMemory;
  if (!isTakeId(takeId)) return null;
  try {
    const stored = JSON.parse(await readFile(metadataPath(takeId), "utf8")) as unknown;
    return isStoredTake(stored, takeId) ? stored : null;
  } catch {
    return null;
  }
}

/** Stop an XCTest recorder left active by a server process exit. Failure is
 * intentionally propagated so startup never releases a device lease while a
 * recorder may still own the target. */
export async function reconcileIosVideoTake(serial: string): Promise<IosVideoTake | null> {
  let files: string[];
  try {
    files = await readdir(iosVideoTakeDirectory());
  } catch {
    return null;
  }
  const candidates: IosVideoTake[] = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const takeId = file.slice(0, -5);
    if (!isTakeId(takeId)) continue;
    try {
      const value = JSON.parse(await readFile(metadataPath(takeId), "utf8")) as unknown;
      if (isStoredTake(value, takeId) && value.serial === serial && value.state === "recording") {
        candidates.push(value);
      }
    } catch {
      // An unrelated damaged metadata file cannot hide a valid active Take.
    }
  }
  const take = candidates.sort((left, right) => right.startedAt - left.startedAt)[0];
  if (!take) return null;
  const result = await finishDeviceRecording(take);
  const path = result.path;
  const complete: IosVideoTake = {
    ...take,
    path,
    state: "ready",
    finishedAt: Date.now(),
    ...(result.warning ? { warning: result.warning } : {}),
  };
  takesById.set(complete.id, complete);
  activeTakeBySerial.delete(serial);
  await persistTake(complete);
  return complete;
}

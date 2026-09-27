import { createHash } from "node:crypto";
import type { AppMap } from "@relay/protocol";
import type { PlayerMapSnapshot } from "./player-manifest.js";
import { canonicalSha256, type CanonicalSha256 } from "./canonical-json.js";
import { buildPlayerManifest, type PlayerManifest } from "./player-manifest.js";
import { readFrameFile } from "./run-artifact-files.js";
import type { PersistedRun } from "./runs.js";

export type WalkthroughPackFrame = {
  runId: string;
  framePath: string;
  imageSha256: string;
  /** Passive PNG bytes. The pack never requests the tested application. */
  content: string;
};

export type WalkthroughPack = {
  schemaVersion: 1;
  kind: "relay-walkthrough-pack";
  digest: CanonicalSha256;
  manifest: PlayerManifest;
  frames: WalkthroughPackFrame[];
};

async function captureReviewFrameFailures(run: PersistedRun): Promise<string[]> {
  const failures: string[] = [];
  if (!run.dir) return [`run ${run.id} has no evidence directory`];
  for (const artifact of run.artifacts ?? []) {
    if (artifact.kind !== "capture-review") continue;
    const data = artifact.data;
    if (data === null || typeof data !== "object" || Array.isArray(data)) continue;
    if (!("framePath" in data) || !("imageSha256" in data)) continue;
    const framePath = data.framePath;
    const imageSha256 = data.imageSha256;
    if (typeof framePath !== "string" || typeof imageSha256 !== "string") continue;
    const bytes = await readFrameFile(run.dir, framePath);
    if (!bytes) {
      failures.push(`missing frame ${framePath} on run ${run.id}`);
      continue;
    }
    const observed = createHash("sha256").update(bytes).digest("hex");
    if (observed !== imageSha256) failures.push(`tampered frame ${framePath} on run ${run.id}`);
  }
  return failures;
}

/** Freeze the captured-app player for one or more runs. Every reviewable
 * frame must still match the digest recorded when it was captured. */
export async function exportWalkthroughPack(input: {
  map: AppMap | PlayerMapSnapshot;
  runs: readonly PersistedRun[];
  now?: number;
}): Promise<WalkthroughPack> {
  if (input.runs.length === 0) throw new Error("Walkthrough export needs at least one run");
  const failures: string[] = [];
  for (const run of input.runs) failures.push(...(await captureReviewFrameFailures(run)));
  if (failures.length > 0) {
    throw new Error(
      `Walkthrough export refused: capture evidence fails integrity — ${failures.join("; ")}`,
    );
  }
  const manifest = buildPlayerManifest({
    map: input.map,
    runs: input.runs,
    now: input.now ?? 0,
  });
  const runsById = new Map(input.runs.map((run) => [run.id, run]));
  const frames: WalkthroughPackFrame[] = [];
  const seen = new Set<string>();
  for (const capture of manifest.captures) {
    const key = `${capture.runId}\0${capture.framePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const run = runsById.get(capture.runId);
    const bytes = run?.dir ? await readFrameFile(run.dir, capture.framePath) : null;
    if (!bytes) {
      throw new Error(
        `Walkthrough export refused: missing frame ${capture.framePath} on run ${capture.runId}`,
      );
    }
    frames.push({
      runId: capture.runId,
      framePath: capture.framePath,
      imageSha256: capture.imageSha256,
      content: bytes.toString("base64"),
    });
  }
  frames.sort((left, right) =>
    left.runId === right.runId
      ? left.framePath < right.framePath
        ? -1
        : left.framePath > right.framePath
          ? 1
          : 0
      : left.runId < right.runId
        ? -1
        : 1,
  );
  const body = {
    schemaVersion: 1 as const,
    kind: "relay-walkthrough-pack" as const,
    manifest,
    frames,
  };
  return { ...body, digest: canonicalSha256(body) };
}

/** Confirm the pack digest and that every embedded frame still matches the
 * capture it claims. Does not contact the tested application. */
export function verifyWalkthroughPack(pack: WalkthroughPack): WalkthroughPack {
  const { digest, ...body } = pack;
  if (canonicalSha256(body) !== digest) {
    throw new Error("Walkthrough pack digest does not match its contents");
  }
  const framesByKey = new Map(
    pack.frames.map((frame) => [`${frame.runId}\0${frame.framePath}`, frame]),
  );
  for (const capture of pack.manifest.captures) {
    const frame = framesByKey.get(`${capture.runId}\0${capture.framePath}`);
    if (!frame || frame.imageSha256 !== capture.imageSha256) {
      throw new Error(
        `Walkthrough pack is missing frame ${capture.framePath} on run ${capture.runId}`,
      );
    }
    const observed = createHash("sha256")
      .update(Buffer.from(frame.content, "base64"))
      .digest("hex");
    if (observed !== capture.imageSha256) {
      throw new Error(
        `Walkthrough pack frame ${capture.framePath} on run ${capture.runId} does not match its digest`,
      );
    }
  }
  return pack;
}

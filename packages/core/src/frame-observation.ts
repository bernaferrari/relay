/**
 * The readable half of a matrix screenshot.
 *
 * A pack of forty locales can only be compared if something remembers what the
 * text on each frame actually said. The runner already holds the tree it used
 * to take the shot, so this records the same locale-stable controls the fixture
 * crawl records — no extra device round trip, and nothing at all when the tree
 * was unavailable.
 */
import type { CombineEvidenceControl } from "./combine-evidence-session.js";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  combineEvidenceControls,
  fingerprintCombineEvidenceScreen,
  titleFromNodes,
} from "./combine-evidence-screen-analysis.js";
import type { SnapshotNode } from "./device.js";
import { now } from "./events.js";
import type { TestJob } from "./session-contract.js";

export const FRAME_OBSERVATION_KIND = "frame-observation";

export type FrameObservation = {
  schemaVersion: 1;
  /** Run-relative frame path, e.g. frames/003.png. */
  framePath: string;
  caption?: string;
  fingerprint: string;
  /** Digest of the raster, so two locales that produced the same pixels say so. */
  sha256?: string;
  title?: string;
  controls: CombineEvidenceControl[];
};

/**
 * Only matrix cases are recorded. A single run has nothing to be compared
 * against, and control lists on every run would grow each trace for no reader.
 */
export function recordFrameObservation(input: {
  job?: TestJob;
  framePath?: string;
  caption?: string;
  nodes?: readonly SnapshotNode[];
  /** Raster of this frame, already in memory from the capture. */
  base64?: string;
}): void {
  const { job, framePath, caption } = input;
  if (!job?.batchId || !framePath) return;
  const nodes = input.nodes ? [...input.nodes] : [];
  if (!nodes.length) return;
  if (job.artifacts.some((artifact) => observationOf(artifact)?.framePath === framePath)) return;
  const { fingerprint } = fingerprintCombineEvidenceScreen(nodes);
  const title = titleFromNodes(nodes, []);
  const observation: FrameObservation = {
    schemaVersion: 1,
    framePath,
    ...(caption ? { caption } : {}),
    fingerprint,
    ...(input.base64
      ? { sha256: createHash("sha256").update(Buffer.from(input.base64, "base64")).digest("hex") }
      : {}),
    ...(title ? { title } : {}),
    controls: combineEvidenceControls(nodes),
  };
  job.artifacts.push({ kind: FRAME_OBSERVATION_KIND, capturedAt: now(), data: observation });
}

function observationOf(artifact: TestJob["artifacts"][number]): FrameObservation | undefined {
  if (artifact.kind !== FRAME_OBSERVATION_KIND) return undefined;
  const data = artifact.data;
  if (!data || typeof data !== "object") return undefined;
  const candidate = data as Partial<FrameObservation>;
  if (typeof candidate.framePath !== "string" || !Array.isArray(candidate.controls))
    return undefined;
  return candidate as FrameObservation;
}

/** Observations of a finished run, keyed by frame file name. Takes only the
 * artifacts so a run read back from disk is as readable as one still in
 * memory. */
export function frameObservations(job: Pick<TestJob, "artifacts">): Map<string, FrameObservation> {
  const byName = new Map<string, FrameObservation>();
  for (const artifact of job.artifacts ?? []) {
    const observation = observationOf(artifact);
    if (observation) byName.set(basename(observation.framePath), observation);
  }
  return byName;
}

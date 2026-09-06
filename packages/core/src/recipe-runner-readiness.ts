import type { Device } from "./device.js";
import { selectedPlatform, sleep, snapshot } from "./device.js";
import { captureScreenshot } from "./workspace-capture.js";
import { cooperativeCheckpoint } from "./control.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import {
  awaitSemanticReadiness,
  labelsFromSemanticSnapshot,
  SemanticReadinessTimeoutError,
  semanticSnapshotDigest,
} from "./semantic-readiness.js";

/** A manual checkpoint without an authored deadline must not own a target
 * lane forever when a run is left unattended. */
export const DEFAULT_HUMAN_CHECKPOINT_TIMEOUT_MS = 15 * 60_000;
const MAX_HUMAN_CHECKPOINT_TIMEOUT_MS = 24 * 60 * 60_000;

export function boundedHumanCheckpointTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_HUMAN_CHECKPOINT_TIMEOUT_MS;
  }
  return Math.max(1, Math.min(Math.floor(value), MAX_HUMAN_CHECKPOINT_TIMEOUT_MS));
}

export function isAndroidSemanticReadinessTarget(): boolean {
  try {
    return selectedPlatform() === "android";
  } catch {
    return false;
  }
}

export async function awaitAndroidSemanticReadiness(
  device: Device,
  expectedLabels: string[],
  ctx: RecipeStepContext,
): Promise<void> {
  try {
    await awaitSemanticReadiness({
      expectedLabels,
      captureSnapshot: async () => {
        const nodes = await snapshot(device);
        const labels = labelsFromSemanticSnapshot({ nodes });
        return { nodes, labels, digest: semanticSnapshotDigest(labels) };
      },
      sleep: (ms) => sleep(ms, device),
    });
  } catch (error) {
    if (!(error instanceof SemanticReadinessTimeoutError)) throw error;
    let screenshotPath = error.screenshotPath;
    if (!screenshotPath) {
      try {
        const shot = await captureScreenshot({
          device,
          jobId: ctx.job?.id,
          caption: "semantic-readiness timeout",
        });
        screenshotPath = shot.framePath ?? shot.path;
      } catch {
        // Tree labels + digest still diagnose the timeout when pixels fail.
      }
    }
    throw screenshotPath && screenshotPath !== error.screenshotPath
      ? new SemanticReadinessTimeoutError({
          timeoutMs: error.timeoutMs,
          expectedLabels: error.expectedLabels,
          missingLabels: error.missingLabels,
          lastLabels: error.lastLabels,
          attempts: error.attempts,
          elapsedMs: error.elapsedMs,
          digest: error.digest,
          screenshotPath,
        })
      : error;
  }
}

/**
 * Poll a visible-target condition every ~400ms until it holds or the
 * deadline passes; the pause checkpoint inside the loop keeps cooperative
 * cancellation (and pause/resume) escaping ahead of any caller timeout.
 */
export async function pollUntil(
  device: Device,
  deadline: number,
  predicate: () => Promise<boolean>,
): Promise<boolean> {
  while (Date.now() < deadline) {
    await cooperativeCheckpoint();
    if (await predicate()) {
      return true;
    }
    await sleep(400, device);
  }
  return false;
}

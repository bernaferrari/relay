import { JobCancelledError } from "./control.js";
import { now } from "./events.js";
import type { AppMap } from "@relay/protocol";
import { currentVerifiedScreen, type RecipeRuntimeState } from "./recipe-runner-context.js";
import type { TestJob } from "./session-contract.js";
import { isTargetUnavailableError } from "./target-unavailable.js";
import { parseAppMapTestExecutionIntentArtifact } from "./app-map-test-execution-intent.js";
import { readAppMap } from "./collaboration.js";
import { proposeRepair } from "./repair-proposal.js";
import { createDefaultGrounder } from "./grounding.js";

type DestinationRepairHintArtifact = {
  schemaVersion: 1;
  expectedScreenId: string;
  expectedScreenTitle?: string;
  expectedFingerprint?: string;
  observedFingerprint?: string;
  observedScreenTitle?: string;
  resolutionMethod?: string;
};

function isJobCancellation(error: unknown): boolean {
  return (
    error instanceof JobCancelledError ||
    (error instanceof Error && error.name === "JobCancelledError")
  );
}

/**
 * On a run failure, turn a destination-mismatch repair hint into review-only
 * proposals from the frozen App Map Test plan's screens. Proposal-only: this
 * never mutates the App Map, retries navigation, or rewrites steps, and an
 * unavailable grounder degrades to zero proposals instead of an error.
 */
export async function attachDestinationRepairProposals(
  job: TestJob,
  error: unknown,
  runtime: RecipeRuntimeState,
): Promise<void> {
  if (isJobCancellation(error) || isTargetUnavailableError(error)) return;
  const hintArtifact = [...job.artifacts]
    .find(
      (
        artifact,
      ): artifact is {
        kind: string;
        capturedAt: number;
        data: DestinationRepairHintArtifact;
      } => artifact.kind === "destination-repair-hint",
    );
  if (!hintArtifact) return;
  const intent = parseAppMapTestExecutionIntentArtifact(
    job.artifacts.find((artifact) => artifact.kind === "app-map-test-execution-intent"),
  );
  const appMapId = intent?.sourcePlan.appMapId ?? job.recipeSnapshot?.id;
  if (!appMapId || !job.projectId) {
    job.artifacts.push({
      kind: "destination-repair-proposals",
      capturedAt: now(),
      data: { available: false, proposals: [], reason: "grounding-unavailable" },
    });
    return;
  }
  let map: AppMap | null = null;
  try {
    map = await readAppMap(job.projectId, appMapId);
  } catch {
    map = null;
  }
  const checkpoint = currentVerifiedScreen(runtime);
  const result = await proposeRepair({
    failure: {
      expectedScreenId: hintArtifact.data.expectedScreenId,
      ...(hintArtifact.data.expectedScreenTitle
        ? { expectedScreenTitle: hintArtifact.data.expectedScreenTitle }
        : {}),
      ...(hintArtifact.data.expectedFingerprint
        ? { expectedFingerprint: hintArtifact.data.expectedFingerprint }
        : {}),
      ...(hintArtifact.data.observedScreenTitle
        ? { observedScreenTitle: hintArtifact.data.observedScreenTitle }
        : {}),
      ...(hintArtifact.data.resolutionMethod
        ? { resolutionMethod: hintArtifact.data.resolutionMethod }
        : {}),
    },
    map: map ?? { screens: {}, screenVariants: {} },
    grounder: createDefaultGrounder(),
    observationAccess: {
      ...(checkpoint?.nodes ? { nodes: () => Promise.resolve(checkpoint.nodes) } : {}),
    },
  });
  job.artifacts.push({
    kind: "destination-repair-proposals",
    capturedAt: now(),
    data: result,
  });
}

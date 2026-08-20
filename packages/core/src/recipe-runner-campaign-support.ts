/**
 * Campaign evidence and the navigation-proof firewall. These helpers only
 * observe or pause; the campaign executor owns every mutation and outcome.
 */
import { describeSnapshotChrome } from "@relay/protocol";
import type { Device } from "./device.js";
import { snapshot } from "./device.js";
import {
  cooperativeCheckpointWithTimeout,
  getExecutingJobId,
  requestPause,
  requestResume,
} from "./control.js";
import { now, publish } from "./events.js";
import type { RecipeStep } from "./recipes.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { captureScreenshot } from "./workspace.js";

export async function captureCampaignFailureEvidence(
  device: Device,
  check: NonNullable<RecipeStep["check"]>,
  ctx: RecipeStepContext,
  startedAt: number,
  error: string,
  phase: "primary" | "cleanup" = "primary",
): Promise<void> {
  const job = ctx.job;
  if (!job) return;
  const attempts = job.artifacts.flatMap((artifact) =>
    artifact.capturedAt >= startedAt &&
    ["target-resolution", "target-resolution-attempt", "locator-fallback", "locator-heal"].includes(
      artifact.kind,
    )
      ? [{ kind: artifact.kind, capturedAt: artifact.capturedAt, data: artifact.data }]
      : [],
  );
  let nodes: Awaited<ReturnType<typeof snapshot>> = [];
  let accessibilityAvailable = false;
  try {
    nodes = await snapshot(device);
    accessibilityAvailable = true;
  } catch {
    // The action error and screenshot remain useful when AX is unavailable.
  }
  const capturedAt = now();
  job.artifacts.push({
    kind: "campaign-check-evidence",
    capturedAt,
    data: {
      checkId: check.id,
      checkTitle: check.title,
      phase,
      error,
      attempts,
      chrome: describeSnapshotChrome(nodes),
      ...(nodes.length ? { screenIdentity: observeScreenIdentity(nodes) } : {}),
      accessibility: { available: accessibilityAvailable, nodeCount: nodes.length },
      nodes,
    },
  });
  await captureScreenshot({
    jobId: job.id,
    caption: `failed:${phase}:${check.title}`,
    device,
    ...(nodes.length ? { semanticNodes: nodes } : {}),
  }).catch(() => undefined);
}

export async function captureCampaignRecoveryIntervention(
  device: Device,
  check: NonNullable<RecipeStep["check"]>,
  ctx: RecipeStepContext,
  transitionId: string,
  reason: string,
): Promise<void> {
  const job = ctx.job;
  if (!job) return;
  let nodes: Awaited<ReturnType<typeof snapshot>> = [];
  let accessibilityAvailable = false;
  try {
    nodes = await snapshot(device);
    accessibilityAvailable = true;
  } catch {
    // Pixels plus the prior action evidence still form a truthful SOS package.
  }
  const caption = `sos:cold-recovery:${transitionId}`;
  const screenshot = await captureScreenshot({
    jobId: job.id,
    caption,
    device,
    ...(nodes.length ? { semanticNodes: nodes } : {}),
  }).catch(() => undefined);
  const capturedAt = now();
  const attempts = job.artifacts
    .filter((artifact) =>
      [
        "target-resolution",
        "target-resolution-attempt",
        "locator-fallback",
        "locator-heal",
      ].includes(artifact.kind),
    )
    .slice(-32)
    .map((artifact) => ({
      kind: artifact.kind,
      capturedAt: artifact.capturedAt,
      data: artifact.data,
    }));
  const recovery = check.recovery;
  const proposal = {
    action: "review-cold-recovery",
    warmRecipeId: recovery?.recipeId,
    proposedColdRecipeId: recovery?.coldRecipeId,
    choices: ["fix-current-state", "teach-semantic-repair", "approve-cold-once", "defer"],
    implicitResumeAllowed: false,
  };
  job.artifacts.push({
    kind: "campaign-recovery-intervention",
    capturedAt,
    data: {
      schemaVersion: 1,
      status: "intervention-required",
      checkId: check.id,
      checkTitle: check.title,
      transitionId,
      reason,
      attemptedSelectors: attempts,
      recovery: proposal,
      chrome: describeSnapshotChrome(nodes),
      ...(nodes.length ? { screenIdentity: observeScreenIdentity(nodes) } : {}),
      accessibility: { available: accessibilityAvailable, nodeCount: nodes.length },
      nodes,
      screenshot: {
        caption,
        ...(screenshot?.framePath ? { framePath: screenshot.framePath } : {}),
        ...(screenshot?.path ? { path: screenshot.path } : {}),
        ...(screenshot?.width ? { width: screenshot.width } : {}),
        ...(screenshot?.height ? { height: screenshot.height } : {}),
      },
    },
  });
  job.artifacts.push({
    kind: "human-intervention-requested",
    capturedAt,
    data: {
      reason: "review",
      message: `Cold recovery blocked for ${check.title}. Review transition ${transitionId}.`,
      resumeLabel: "Resume",
      interventionKind: "campaign-cold-recovery",
      checkId: check.id,
      transitionId,
      recovery: proposal,
    },
  });
  ctx.log(`SOS: cold recovery blocked for transition ${transitionId} — intervention required`);
  const jobId = getExecutingJobId();
  if (jobId === job.id) {
    const started = now();
    job.status = "paused";
    job.waitingFor = {
      kind: "human",
      message: `Stuck: ${check.title}. Resume when the device is ready.`,
      reason: "review",
      resumeLabel: "Resume",
      since: started,
    };
    requestPause(job.id);
    publish({ type: "job.paused", at: started, jobId: job.id, action: job.action });
    try {
      await cooperativeCheckpointWithTimeout(job.id);
    } finally {
      requestResume(job.id);
      job.waitingFor = undefined;
    }
    job.status = "running";
  }
}

export function independentlySourceProvenLeafRecipe(
  check: NonNullable<RecipeStep["check"]>,
  ctx: RecipeStepContext,
): boolean {
  const recovery = check.recovery;
  const leaf = check.transitionDependencies?.at(-1);
  if (
    !recovery ||
    recovery.mode !== "warm-transition" ||
    !recovery.transitionId ||
    recovery.transitionId !== leaf?.connectionId
  ) {
    return false;
  }
  const frozen = ctx.recipeGraph?.[recovery.recipeId];
  const sourceProof = frozen?.steps[0];
  return (
    sourceProof?.kind === "expect-screen" &&
    sourceProof.screenId === leaf.originScreenId &&
    sourceProof.recovery === undefined
  );
}

export async function blockUnprovenCampaignMutation(
  device: Device,
  check: NonNullable<RecipeStep["check"]>,
  ctx: RecipeStepContext,
  startedAt: number,
  reason: string,
): Promise<void> {
  const job = ctx.job;
  const cursor = ctx.runtime?.navigationCursor;
  const expectedOriginScreenId =
    check.warmSourceScreenId ?? check.transitionDependencies?.[0]?.originScreenId;
  const cursorKey = cursor
    ? `${cursor.status}:${cursor.updatedAt}:${cursor.status === "proven" ? cursor.screenId : cursor.reason}`
    : "missing";
  const prior = [...(job?.artifacts ?? [])]
    .reverse()
    .find(
      (artifact) =>
        artifact.kind === "campaign-cursor-firewall" &&
        (artifact.data as { cursorKey?: string }).cursorKey === cursorKey,
    );

  let evidenceCapturedAt = prior?.capturedAt;
  if (job && !prior) {
    let nodes: Awaited<ReturnType<typeof snapshot>> = [];
    let accessibilityAvailable = false;
    try {
      nodes = await snapshot(device);
      accessibilityAvailable = true;
    } catch {
      // A raster and the frozen cursor are still a truthful no-mutation package.
    }
    const caption = `blocked:unproven-cursor:${check.id}`;
    const screenshot = await captureScreenshot({
      jobId: job.id,
      caption,
      device,
      ...(nodes.length ? { semanticNodes: nodes } : {}),
    }).catch(() => undefined);
    const attempts = job.artifacts
      .filter((artifact) =>
        [
          "target-resolution",
          "target-resolution-attempt",
          "locator-fallback",
          "locator-heal",
        ].includes(artifact.kind),
      )
      .slice(-32)
      .map((artifact) => ({
        kind: artifact.kind,
        capturedAt: artifact.capturedAt,
        data: artifact.data,
      }));
    evidenceCapturedAt = now();
    job.artifacts.push({
      kind: "campaign-cursor-firewall",
      capturedAt: evidenceCapturedAt,
      data: {
        schemaVersion: 1,
        status: "blocked-before-mutation",
        cursorKey,
        rootCheckId: check.id,
        rootCheckTitle: check.title,
        reason,
        stoppedMutations: true,
        expected: {
          ...(expectedOriginScreenId ? { originScreenId: expectedOriginScreenId } : {}),
          ...(check.transitionDependencies?.at(-1)
            ? { leafTransition: structuredClone(check.transitionDependencies.at(-1)) }
            : {}),
        },
        observed: {
          cursor: cursor ? structuredClone(cursor) : { status: "missing" },
          chrome: describeSnapshotChrome(nodes),
          ...(nodes.length ? { screenIdentity: observeScreenIdentity(nodes) } : {}),
        },
        attemptedSelectors: attempts,
        accessibility: { available: accessibilityAvailable, nodeCount: nodes.length },
        nodes,
        screenshot: {
          caption,
          ...(screenshot?.framePath ? { framePath: screenshot.framePath } : {}),
          ...(screenshot?.path ? { path: screenshot.path } : {}),
          ...(screenshot?.width ? { width: screenshot.width } : {}),
          ...(screenshot?.height ? { height: screenshot.height } : {}),
        },
        repair: {
          action: "prove-origin-or-teach-canonical-leaf",
          ...(expectedOriginScreenId ? { requiredOriginScreenId: expectedOriginScreenId } : {}),
          choices: ["prove-current-origin", "teach-canonical-leaf", "defer"],
          implicitMutationAllowed: false,
        },
      },
    });
  }

  const finishedAt = now();
  job?.artifacts.push({
    kind: "campaign-check-result",
    capturedAt: finishedAt,
    data: {
      ...check,
      status: "blocked",
      error: `Blocked before mutation: ${reason}`,
      dependencyReason: reason,
      ...(expectedOriginScreenId ? { expectedOriginScreenId } : {}),
      observedCursor: cursor ? structuredClone(cursor) : { status: "missing" },
      stoppedMutations: true,
      ...(evidenceCapturedAt ? { evidenceCapturedAt } : {}),
      selectiveRepair: {
        status: "pending",
        ...(check.recovery
          ? { recipeId: check.recovery.recipeId, groupId: check.recovery.groupId }
          : {}),
      },
      startedAt,
      finishedAt,
    },
  });
  ctx.log(`check blocked before mutation: ${check.title} — ${reason}`);
}

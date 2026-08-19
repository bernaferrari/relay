import { describeSnapshotChrome } from "@relay/protocol";
import type { Device } from "./device.js";
import { snapshot } from "./device.js";
import { now, publish } from "./events.js";
import {
  cooperativeCheckpointWithTimeout,
  getExecutingJobId,
  requestPause,
  requestResume,
} from "./control.js";
import { captureScreenshot } from "./workspace.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { isCancel } from "./recipe-runner-support.js";
import type { RecipeStep } from "./recipes.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { markNavigationUnknown, proveNavigationDestination } from "./recipe-runner-context.js";

async function captureCampaignFailureEvidence(
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

async function captureCampaignRecoveryIntervention(
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

export async function runCampaignCheck(
  device: Device,
  step: RecipeStep & { check: NonNullable<RecipeStep["check"]> },
  ctx: RecipeStepContext,
  execute: (recipeId?: string, bindings?: Record<string, string>) => Promise<void>,
  options: { allowDefer?: boolean } = {},
): Promise<void> {
  const startedAt = now();
  (ctx.runtime ??= {}).campaignCoverageStarted = true;
  const recovery = step.check.recovery;
  const groups = (ctx.runtime.campaignRecoveryGroups ??= {});
  const transitionProofs = (ctx.runtime.campaignTransitionProofs ??= {});
  const transitionDependencies = step.check.transitionDependencies ?? [];
  const openDependency = transitionDependencies.find(
    (dependency) => transitionProofs[dependency.connectionId]?.status === "open",
  );
  if (openDependency) {
    const finishedAt = now();
    const circuit = transitionProofs[openDependency.connectionId]!;
    const dependencyReason = circuit.reason ?? "Shared transition confirmation failed.";
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: finishedAt,
      data: {
        ...step.check,
        status: "blocked",
        error: `Blocked: ${dependencyReason}`,
        dependencyReason,
        dependencyTransitionId: openDependency.connectionId,
        startedAt,
        finishedAt,
      },
    });
    ctx.log(
      `check blocked: ${step.check.title} — transition ${openDependency.connectionId} circuit is open`,
    );
    return;
  }
  const group = recovery ? groups[recovery.groupId] : undefined;
  if (group?.status === "blocked") {
    const finishedAt = now();
    const dependencyReason = group.reason ?? "Shared origin recovery failed.";
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: finishedAt,
      data: {
        ...step.check,
        status: "blocked",
        error: `Blocked: ${dependencyReason}`,
        dependencyReason,
        startedAt,
        finishedAt,
      },
    });
    ctx.log(`check blocked: ${step.check.title} — ${dependencyReason}`);
    return;
  }
  let primaryError: unknown;
  let cleanupError: unknown;
  const transitionToConfirm = transitionDependencies.find(
    (dependency) => transitionProofs[dependency.connectionId]?.status === "needs-confirmation",
  );
  const leafTransitionId = transitionDependencies.at(-1)?.connectionId ?? recovery?.transitionId;
  const ancestorNeedingConfirmation = transitionDependencies
    .slice(0, -1)
    .find(
      (dependency) => transitionProofs[dependency.connectionId]?.status === "needs-confirmation",
    );
  const useCanonicalRecovery = Boolean(
    recovery &&
    ((!ancestorNeedingConfirmation &&
      (ctx.runtime?.navigationCursor?.status === "unknown" ||
        (ctx.runtime?.navigationCursor?.status === "proven" &&
          step.check.warmSourceScreenId !== undefined &&
          ctx.runtime.navigationCursor.screenId !== step.check.warmSourceScreenId))) ||
      (recovery.transitionId
        ? transitionToConfirm?.connectionId === recovery.transitionId
        : false)),
  );
  if (ancestorNeedingConfirmation && !useCanonicalRecovery) {
    const finishedAt = now();
    const message = `Parent transition ${ancestorNeedingConfirmation.connectionId} still needs confirmation.`;
    (ctx.runtime.deferredCampaignChecks ??= []).push({
      check: structuredClone(step.check),
      error: message,
      startedAt,
      deferredAt: finishedAt,
    });
    ctx.job?.artifacts.push({
      kind: "campaign-check-deferred",
      capturedAt: finishedAt,
      data: {
        ...step.check,
        status: "deferred",
        error: message,
        dependencyTransitionId: ancestorNeedingConfirmation.connectionId,
      },
    });
    ctx.log(`check deferred: ${step.check.title} — ${message}`);
    return;
  }
  if (recovery && useCanonicalRecovery && recovery.mode !== "warm-transition") {
    const finishedAt = now();
    const transitionId =
      transitionToConfirm?.connectionId ?? recovery.transitionId ?? recovery.groupId;
    const reason =
      transitionProofs[transitionId]?.reason ??
      "The transition origin is unproven and only a cold recovery is available.";
    await captureCampaignRecoveryIntervention(device, step.check, ctx, transitionId, reason);
    transitionProofs[transitionId] = {
      status: "open",
      checkId: step.check.id,
      updatedAt: finishedAt,
      reason,
    };
    groups[recovery.groupId] = { status: "blocked", reason };
    ctx.job?.artifacts.push({
      kind: "campaign-transition-circuit",
      capturedAt: finishedAt,
      data: {
        schemaVersion: 1,
        connectionId: transitionId,
        checkId: step.check.id,
        status: "open",
        reason,
        openedAt: finishedAt,
        recoverySuppressed: true,
      },
    });
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: finishedAt,
      data: {
        ...step.check,
        status: "blocked",
        error: `Blocked: ${reason}`,
        dependencyReason: reason,
        dependencyTransitionId: transitionId,
        startedAt,
        finishedAt,
      },
    });
    return;
  }
  let cleanupPassed = false;
  try {
    if (useCanonicalRecovery) {
      ctx.log(`check recovery: ${step.check.title} — one canonical path`);
    }
    await execute(useCanonicalRecovery ? recovery?.recipeId : undefined);
  } catch (error) {
    primaryError = error;
    markNavigationUnknown(
      ctx,
      error instanceof Error ? error.message : `Campaign check ${step.check.id} failed.`,
    );
    if (!isCancel(error)) {
      const message = error instanceof Error ? error.message : String(error);
      await captureCampaignFailureEvidence(device, step.check, ctx, startedAt, message, "primary");
    }
  } finally {
    const cleanup = step.check.cleanup;
    if (cleanup) {
      const cleanupStartedAt = now();
      if (primaryError && isCancel(primaryError)) {
        ctx.job?.artifacts.push({
          kind: "campaign-check-cleanup",
          capturedAt: cleanupStartedAt,
          data: {
            checkId: step.check.id,
            recipeId: cleanup.recipeId,
            terminalScreenId: cleanup.terminalScreenId,
            status: "skipped",
            reason: "Job cancellation is an immediate authority boundary.",
            startedAt: cleanupStartedAt,
            finishedAt: cleanupStartedAt,
          },
        });
        ctx.log(`check cleanup skipped: ${step.check.title} — job cancelled`);
      } else {
        try {
          await execute(cleanup.recipeId, cleanup.bindings);
          cleanupPassed = true;
          const finishedAt = now();
          ctx.job?.artifacts.push({
            kind: "campaign-check-cleanup",
            capturedAt: finishedAt,
            data: {
              checkId: step.check.id,
              recipeId: cleanup.recipeId,
              terminalScreenId: cleanup.terminalScreenId,
              status: "passed",
              startedAt: cleanupStartedAt,
              finishedAt,
            },
          });
          ctx.log(`check cleanup passed: ${step.check.title}`);
        } catch (error) {
          cleanupError = error;
          const finishedAt = now();
          ctx.job?.artifacts.push({
            kind: "campaign-check-cleanup",
            capturedAt: finishedAt,
            data: {
              checkId: step.check.id,
              recipeId: cleanup.recipeId,
              terminalScreenId: cleanup.terminalScreenId,
              status: isCancel(error) ? "cancelled" : "failed",
              error: error instanceof Error ? error.message : String(error),
              startedAt: cleanupStartedAt,
              finishedAt,
            },
          });
          ctx.log(
            `check cleanup ${isCancel(error) ? "cancelled" : "failed"}: ${step.check.title} — ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  if (primaryError && isCancel(primaryError)) throw primaryError;
  if (cleanupError && isCancel(cleanupError)) throw cleanupError;
  if (!primaryError && !cleanupError) {
    const finishedAt = now();
    if (recovery) groups[recovery.groupId] = { status: "healthy" };
    // A canonical recovery executes one independently compiled edge. It may
    // prove that edge, but it cannot retroactively prove unexecuted ancestors
    // merely because the leaf destination was reached.
    const provenDependencies =
      useCanonicalRecovery && recovery?.transitionId
        ? transitionDependencies.filter(
            (dependency) => dependency.connectionId === recovery.transitionId,
          )
        : transitionDependencies;
    for (const dependency of provenDependencies) {
      if (transitionProofs[dependency.connectionId]?.status === "verified") continue;
      transitionProofs[dependency.connectionId] = {
        status: "verified",
        checkId: step.check.id,
        updatedAt: finishedAt,
      };
      ctx.job?.artifacts.push({
        kind: "campaign-transition-proof",
        capturedAt: finishedAt,
        data: {
          schemaVersion: 1,
          tokenId: `${ctx.job.id}:${dependency.connectionId}`,
          connectionId: dependency.connectionId,
          originScreenId: dependency.originScreenId,
          destination: structuredClone(dependency.destination),
          ...(dependency.expectedApp ? { expectedApp: dependency.expectedApp } : {}),
          checkId: step.check.id,
          status: "verified",
          verifiedAt: finishedAt,
        },
      });
    }
    const terminalDestination = transitionDependencies.at(-1)?.destination;
    const terminalScreenId =
      cleanupPassed && step.check.cleanup
        ? step.check.cleanup.terminalScreenId
        : terminalDestination?.kind === "screen"
          ? terminalDestination.screenId
          : undefined;
    if (terminalScreenId) {
      proveNavigationDestination(ctx, {
        screenId: terminalScreenId,
        source: cleanupPassed ? "cleanup" : "transition",
        at: finishedAt,
        ...(cleanupPassed
          ? {}
          : {
              token: `${ctx.job?.id ?? "local"}:${transitionDependencies.at(-1)!.connectionId}`,
            }),
      });
    }
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: finishedAt,
      data: { ...step.check, status: "passed", startedAt, finishedAt },
    });
    ctx.log(`check passed: ${step.check.title}`);
    return;
  }

  const primaryMessage = primaryError
    ? primaryError instanceof Error
      ? primaryError.message
      : String(primaryError)
    : undefined;
  const cleanupMessage = cleanupError
    ? cleanupError instanceof Error
      ? cleanupError.message
      : String(cleanupError)
    : undefined;
  const message =
    primaryMessage && cleanupMessage
      ? `Primary failed: ${primaryMessage}; cleanup failed: ${cleanupMessage}`
      : primaryMessage
        ? primaryMessage
        : `Cleanup failed: ${cleanupMessage}`;
  const finishedAt = now();
  // A successful cleanup proves its explicit terminal screen. Otherwise the
  // current device state stays unknown and no later warm path may trust it.
  if (cleanupPassed && step.check.cleanup) {
    proveNavigationDestination(ctx, {
      screenId: step.check.cleanup.terminalScreenId,
      source: "cleanup",
      at: finishedAt,
    });
  } else {
    markNavigationUnknown(ctx, message);
  }
  if (cleanupError) {
    await captureCampaignFailureEvidence(device, step.check, ctx, startedAt, message, "cleanup");
  }
  const failedConfirmationTransitionId =
    useCanonicalRecovery && recovery?.transitionId ? recovery.transitionId : undefined;
  if (failedConfirmationTransitionId) {
    await captureCampaignRecoveryIntervention(
      device,
      step.check,
      ctx,
      failedConfirmationTransitionId,
      message,
    );
    transitionProofs[failedConfirmationTransitionId] = {
      status: "open",
      checkId: step.check.id,
      updatedAt: finishedAt,
      reason: message,
    };
    groups[recovery!.groupId] = { status: "blocked", reason: message };
    ctx.job?.artifacts.push({
      kind: "campaign-transition-circuit",
      capturedAt: finishedAt,
      data: {
        schemaVersion: 1,
        connectionId: failedConfirmationTransitionId,
        checkId: step.check.id,
        status: "open",
        reason: message,
        openedAt: finishedAt,
      },
    });
    ctx.log(
      `transition circuit opened: ${failedConfirmationTransitionId} — canonical confirmation failed`,
    );
  }
  if (recovery && options.allowDefer !== false && !failedConfirmationTransitionId) {
    if (leafTransitionId) {
      const currentProof = transitionProofs[leafTransitionId];
      if (currentProof?.status !== "verified") {
        transitionProofs[leafTransitionId] = {
          status: "needs-confirmation",
          checkId: step.check.id,
          updatedAt: finishedAt,
          reason: message,
        };
        ctx.job?.artifacts.push({
          kind: "campaign-transition-circuit",
          capturedAt: finishedAt,
          data: {
            schemaVersion: 1,
            connectionId: leafTransitionId,
            checkId: step.check.id,
            status: "needs-confirmation",
            reason: message,
            updatedAt: finishedAt,
          },
        });
      }
    }
    (ctx.runtime!.deferredCampaignChecks ??= []).push({
      check: structuredClone(step.check),
      error: message,
      startedAt,
      deferredAt: finishedAt,
    });
    ctx.job?.artifacts.push({
      kind: "campaign-check-deferred",
      capturedAt: finishedAt,
      data: {
        ...step.check,
        status: "deferred",
        error: message,
        ...(primaryMessage ? { primaryError: primaryMessage } : {}),
        ...(cleanupMessage ? { cleanupError: cleanupMessage } : {}),
      },
    });
    ctx.log(`check deferred: ${step.check.title} — ${message}`);
    return;
  }
  if (recovery && !failedConfirmationTransitionId) {
    groups[recovery.groupId] = { status: "blocked", reason: message };
  }
  ctx.job?.artifacts.push({
    kind: "campaign-check-result",
    capturedAt: finishedAt,
    data: {
      ...step.check,
      status: "failed",
      error: message,
      ...(primaryMessage ? { primaryError: primaryMessage } : {}),
      ...(cleanupMessage ? { cleanupError: cleanupMessage } : {}),
      startedAt,
      finishedAt,
    },
  });
  ctx.log(`check failed: ${step.check.title} — ${message}`);
}

/** Finish the coverage pass without moving the device again. The original
 * failure and its evidence become the terminal result; the saved recovery
 * metadata remains available to an explicit selective-repair run. */
export function finalizeDeferredCampaignChecks(ctx: RecipeStepContext): void {
  const queue = ctx.runtime?.deferredCampaignChecks?.splice(0) ?? [];
  if (queue.length === 0) return;
  ctx.log(
    `${queue.length} campaign check${queue.length === 1 ? "" : "s"} queued for selective repair`,
  );
  for (const deferred of queue) {
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: deferred.deferredAt,
      data: {
        ...deferred.check,
        status: "failed",
        error: deferred.error,
        startedAt: deferred.startedAt,
        finishedAt: deferred.deferredAt,
        selectiveRepair: {
          status: "pending",
          ...(deferred.check.recovery
            ? {
                recipeId: deferred.check.recovery.recipeId,
                groupId: deferred.check.recovery.groupId,
              }
            : {}),
        },
      },
    });
    ctx.log(`check needs repair: ${deferred.check.title} — ${deferred.error}`);
  }
}

export async function retryDeferredCampaignChecks(
  device: Device,
  ctx: RecipeStepContext,
  executeRecipe: (recipeId: string) => Promise<void>,
  budgetMs = 30_000,
): Promise<void> {
  const queue = ctx.runtime?.deferredCampaignChecks?.splice(0) ?? [];
  if (queue.length === 0) return;
  const startedAt = Date.now();
  ctx.log(`retrying ${queue.length} deferred campaign check${queue.length === 1 ? "" : "s"}`);
  for (const deferred of queue) {
    const recovery = deferred.check.recovery;
    if (!recovery) continue;
    if (Date.now() - startedAt >= budgetMs) {
      const at = Date.now();
      ctx.job?.artifacts.push({
        kind: "campaign-check-result",
        capturedAt: at,
        data: {
          ...deferred.check,
          status: "blocked",
          error: "Blocked: deferred retry budget exhausted",
          dependencyReason: `Deferred retry budget exhausted after ${budgetMs}ms.`,
          startedAt: at,
          finishedAt: at,
        },
      });
      ctx.log(`check blocked: ${deferred.check.title} — retry budget exhausted`);
      continue;
    }
    await runCampaignCheck(
      device,
      { kind: "module", recipeId: recovery.recipeId, check: deferred.check },
      ctx,
      () => executeRecipe(recovery.recipeId),
      { allowDefer: false },
    );
  }
}

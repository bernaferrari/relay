import type { Device } from "./device.js";
import {
  armCompensatingCleanup,
  disarmCompensatingCleanup,
  getExecutingJobId,
  runWithCancellationShield,
} from "./control.js";
import { now } from "./events.js";
import { IosMutationOutcomeUnknownError } from "./ios-mutation-policy.js";
import type { RecipeStep } from "./recipes.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { markNavigationUnknown, proveNavigationDestination } from "./recipe-runner-context.js";
import {
  blockUnprovenCampaignMutation,
  captureCampaignFailureEvidence,
  captureCampaignRecoveryIntervention,
  independentlySourceProvenLeafRecipe,
} from "./recipe-runner-campaign-support.js";
import { isCancel } from "./recipe-runner-support.js";
import { isTargetUnavailableError } from "./target-unavailable.js";

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
  let targetUnavailableError: unknown;
  const recordTargetUnavailable = (error: unknown, phase: "primary" | "cleanup"): void => {
    if (targetUnavailableError) return;
    targetUnavailableError = error;
    const capturedAt = now();
    const message = error instanceof Error ? error.message : String(error);
    ctx.job?.artifacts.push({
      kind: "target-transport-failure",
      capturedAt,
      data: {
        schemaVersion: 1,
        checkId: step.check.id,
        checkTitle: step.check.title,
        phase,
        status: "target-unavailable",
        error: message,
        stoppedMutations: true,
      },
    });
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt,
      data: {
        ...step.check,
        status: "interrupted",
        error: message,
        interruption: "target-unavailable",
        phase,
        ...(phase === "cleanup" && primaryError
          ? {
              primaryError:
                primaryError instanceof Error ? primaryError.message : String(primaryError),
            }
          : {}),
        startedAt,
        finishedAt: capturedAt,
      },
    });
    ctx.log(
      `target unavailable: ${step.check.title} — stopping the run without further device actions`,
    );
  };
  const transitionToConfirm = transitionDependencies.find(
    (dependency) => transitionProofs[dependency.connectionId]?.status === "needs-confirmation",
  );
  const leafTransitionId = transitionDependencies.at(-1)?.connectionId ?? recovery?.transitionId;
  const ancestorNeedingConfirmation = transitionDependencies
    .slice(0, -1)
    .find(
      (dependency) => transitionProofs[dependency.connectionId]?.status === "needs-confirmation",
    );
  const cursor = ctx.runtime.navigationCursor;
  const cursorMismatch =
    cursor?.status === "proven" &&
    step.check.warmSourceScreenId !== undefined &&
    cursor.screenId !== step.check.warmSourceScreenId;
  const cursorUnproven = cursor !== undefined && cursor.status !== "proven";
  const canonicalLeafIsSafe = independentlySourceProvenLeafRecipe(step.check, ctx);
  if ((cursorUnproven || cursorMismatch) && !canonicalLeafIsSafe) {
    const expected =
      step.check.warmSourceScreenId ??
      transitionDependencies[0]?.originScreenId ??
      "an authored origin";
    const observed =
      cursor?.status === "proven"
        ? cursor.screenId
        : cursor?.status === "external-handoff"
          ? `external handoff (${cursor.foregroundApp})`
          : cursor?.status === "unknown"
            ? `unknown (${cursor.reason})`
            : "unproven";
    await blockUnprovenCampaignMutation(
      device,
      step.check,
      ctx,
      startedAt,
      `Expected ${expected}; runtime cursor is ${observed}. No frozen independently source-proven canonical leaf edge is available.`,
    );
    return;
  }
  const useCanonicalRecovery = Boolean(
    recovery &&
    canonicalLeafIsSafe &&
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
  let cleanupOutcome: "passed" | "failed" | "skipped" | "cancelled" | "interrupted" | undefined;
  const cancellationCleanupJobId =
    step.check.cleanup?.onCancel === "run-if-controllable"
      ? (ctx.job?.id ?? getExecutingJobId())
      : undefined;
  armCompensatingCleanup(cancellationCleanupJobId);
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
    if (error instanceof IosMutationOutcomeUnknownError) {
      // An iOS native command may already have landed. Evidence is read-only,
      // but cleanup would issue a second physical command against an unknown
      // state, so preserve the exact error and stop this recipe/tour here.
      const message = error.message;
      await captureCampaignFailureEvidence(device, step.check, ctx, startedAt, message, "primary");
      throw error;
    }
    if (isTargetUnavailableError(error)) {
      recordTargetUnavailable(error, "primary");
    } else if (!isCancel(error)) {
      const message = error instanceof Error ? error.message : String(error);
      await captureCampaignFailureEvidence(device, step.check, ctx, startedAt, message, "primary");
    }
  } finally {
    const cleanup = step.check.cleanup;
    if (primaryError instanceof IosMutationOutcomeUnknownError) {
      cleanupOutcome = "skipped";
      const capturedAt = now();
      if (cleanup) {
        ctx.job?.artifacts.push({
          kind: "campaign-check-cleanup",
          capturedAt,
          data: {
            checkId: step.check.id,
            recipeId: cleanup.recipeId,
            terminalScreenId: cleanup.terminalScreenId,
            status: "skipped",
            reason: "An iOS mutation has an unknown outcome; no cleanup command is safe.",
            startedAt: capturedAt,
            finishedAt: capturedAt,
          },
        });
      }
      ctx.log(`check cleanup skipped: ${step.check.title} — iOS mutation outcome unknown`);
    } else if (cleanup && targetUnavailableError) {
      cleanupOutcome = "skipped";
      const capturedAt = now();
      ctx.job?.artifacts.push({
        kind: "campaign-check-cleanup",
        capturedAt,
        data: {
          checkId: step.check.id,
          recipeId: cleanup.recipeId,
          terminalScreenId: cleanup.terminalScreenId,
          status: "skipped",
          reason: "The target disappeared; no further device mutations are safe.",
          startedAt: capturedAt,
          finishedAt: capturedAt,
        },
      });
      ctx.log(`check cleanup skipped: ${step.check.title} — target unavailable`);
    } else if (cleanup) {
      const cleanupStartedAt = now();
      if (primaryError && isCancel(primaryError) && cleanup.onCancel === "skip") {
        cleanupOutcome = "skipped";
        ctx.job?.artifacts.push({
          kind: "campaign-check-cleanup",
          capturedAt: cleanupStartedAt,
          data: {
            checkId: step.check.id,
            recipeId: cleanup.recipeId,
            terminalScreenId: cleanup.terminalScreenId,
            status: "skipped",
            reason: "The frozen cleanup policy skips cancellation.",
            startedAt: cleanupStartedAt,
            finishedAt: cleanupStartedAt,
          },
        });
        ctx.log(`check cleanup skipped: ${step.check.title} — authored cancellation policy`);
      } else {
        try {
          const runCleanup = () => execute(cleanup.recipeId, cleanup.bindings);
          await (primaryError && isCancel(primaryError)
            ? runWithCancellationShield(cancellationCleanupJobId, runCleanup)
            : runCleanup());
          cleanupPassed = true;
          cleanupOutcome = "passed";
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
          if (error instanceof IosMutationOutcomeUnknownError) {
            // Cleanup is a physical recipe too. Its command may have landed,
            // so the campaign cannot turn that ambiguity into a normal failed
            // check, defer it, or begin a sibling check.
            cleanupOutcome = "interrupted";
            ctx.job?.artifacts.push({
              kind: "campaign-check-cleanup",
              capturedAt: finishedAt,
              data: {
                checkId: step.check.id,
                recipeId: cleanup.recipeId,
                terminalScreenId: cleanup.terminalScreenId,
                status: "interrupted",
                error: error.message,
                reason:
                  "An iOS cleanup mutation has an unknown outcome; no further command is safe.",
                startedAt: cleanupStartedAt,
                finishedAt,
              },
            });
            await captureCampaignFailureEvidence(
              device,
              step.check,
              ctx,
              startedAt,
              error.message,
              "cleanup",
            );
            // eslint-disable-next-line no-unsafe-finally -- unknown cleanup state must remain terminal.
            throw error;
          }
          if (isTargetUnavailableError(error)) recordTargetUnavailable(error, "cleanup");
          cleanupOutcome = isCancel(error)
            ? "cancelled"
            : isTargetUnavailableError(error)
              ? "interrupted"
              : "failed";
          ctx.job?.artifacts.push({
            kind: "campaign-check-cleanup",
            capturedAt: finishedAt,
            data: {
              checkId: step.check.id,
              recipeId: cleanup.recipeId,
              terminalScreenId: cleanup.terminalScreenId,
              status: isCancel(error)
                ? "cancelled"
                : isTargetUnavailableError(error)
                  ? "interrupted"
                  : "failed",
              error: error instanceof Error ? error.message : String(error),
              startedAt: cleanupStartedAt,
              finishedAt,
            },
          });
          const cleanupStatus = isCancel(error)
            ? "cancelled"
            : isTargetUnavailableError(error)
              ? "interrupted"
              : "failed";
          ctx.log(
            `check cleanup ${cleanupStatus}: ${step.check.title} — ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  if (targetUnavailableError) {
    // Preserve product outcomes collected before the disconnect. They remain
    // independently repairable, while the job itself ends as infrastructure.
    finalizeDeferredCampaignChecks(ctx);
    disarmCompensatingCleanup(cancellationCleanupJobId);
    throw targetUnavailableError;
  }
  if (primaryError && isCancel(primaryError)) {
    const finishedAt = now();
    if (cleanupPassed && step.check.cleanup) {
      proveNavigationDestination(ctx, {
        screenId: step.check.cleanup.terminalScreenId,
        source: "cleanup",
        at: finishedAt,
      });
    } else {
      markNavigationUnknown(
        ctx,
        cleanupError
          ? `Cancelled primary; cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
          : `Cancelled primary; cleanup ${step.check.cleanup ? "did not prove its terminal" : "was not configured"}.`,
      );
    }
    if (cleanupError) {
      await runWithCancellationShield(cancellationCleanupJobId, () =>
        captureCampaignFailureEvidence(
          device,
          step.check,
          ctx,
          startedAt,
          `Cancelled primary; cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          "cleanup",
        ),
      );
    }
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: finishedAt,
      data: {
        ...step.check,
        status: "cancelled",
        primaryError: primaryError instanceof Error ? primaryError.message : String(primaryError),
        ...(cleanupError
          ? {
              cleanupError:
                cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            }
          : {}),
        cleanupStatus: cleanupOutcome ?? "not-configured",
        startedAt,
        finishedAt,
      },
    });
    disarmCompensatingCleanup(cancellationCleanupJobId);
    throw primaryError;
  }
  if (cleanupError && isCancel(cleanupError)) {
    disarmCompensatingCleanup(cancellationCleanupJobId);
    throw cleanupError;
  }
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
    disarmCompensatingCleanup(cancellationCleanupJobId);
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
    disarmCompensatingCleanup(cancellationCleanupJobId);
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
  disarmCompensatingCleanup(cancellationCleanupJobId);
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

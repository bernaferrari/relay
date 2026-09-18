import type { Device } from "./device.js";
import { boundedHumanCheckpointTimeoutMs } from "./recipe-runner-readiness.js";
import { cooperativeCheckpointWithTimeout, requestPause, requestResume } from "./control.js";
import { publish, now } from "./events.js";
import { describeTarget, type RecipeStep } from "./recipes.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";

/** Execute a human checkpoint and preserve its durable intervention evidence. */
export async function runPauseStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "pause" }>,
  ctx: RecipeStepContext,
  runStep: (device: Device, step: RecipeStep, ctx: RecipeStepContext) => Promise<void>,
): Promise<void> {
  const { log, job } = ctx;
  if (!job) throw new Error("pause: no job to pause (standalone step execution)");
  const checkpointStartedAt = now();
  const checkpointTimeoutMs = boundedHumanCheckpointTimeoutMs(
    step.timeoutMs ?? ctx.defaultHumanCheckpointTimeoutMs,
  );
  const reason = step.reason ?? "other";
  const resumeLabel = step.resumeLabel ?? "Continue test";
  log(`⏸ ${step.message}`);
  job.status = "paused";
  job.waitingFor = {
    kind: "human",
    message: step.message,
    reason,
    resumeLabel,
    since: checkpointStartedAt,
    timeoutMs: checkpointTimeoutMs,
    ...(step.verifyAfter
      ? {
          verifyAfter: {
            ...step.verifyAfter,
            condition: step.verifyAfter.condition ?? "visible",
          },
        }
      : {}),
  };
  job.artifacts.push({
    kind: "human-intervention-requested",
    capturedAt: checkpointStartedAt,
    data: { reason, message: step.message, resumeLabel, timeoutMs: checkpointTimeoutMs },
  });
  requestPause(job.id);
  publish({ type: "job.paused", at: now(), jobId: job.id, action: job.action });
  publish({
    type: "job.log",
    at: now(),
    jobId: job.id,
    line: `==> waiting for you: ${step.message}`,
    level: "info",
  });
  try {
    await cooperativeCheckpointWithTimeout(job.id, checkpointTimeoutMs);
  } catch (error) {
    if (!(error instanceof Error && error.name === "JobCancelledError")) {
      job.artifacts.push({
        kind: "human-intervention-expired",
        capturedAt: now(),
        data: {
          reason,
          message: step.message,
          waitedMs: now() - checkpointStartedAt,
          timeoutMs: checkpointTimeoutMs,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
    throw error;
  } finally {
    requestResume(job.id);
    job.waitingFor = undefined;
  }
  job.artifacts.push({
    kind: "human-intervention-completed",
    capturedAt: now(),
    data: { reason, message: step.message, waitedMs: now() - checkpointStartedAt },
  });
  job.status = "running";
  if (!step.verifyAfter) return;
  const verificationStartedAt = now();
  const condition = step.verifyAfter.condition ?? "visible";
  try {
    await runStep(
      device,
      {
        kind: "expect",
        target: step.verifyAfter.target,
        condition,
        ...(step.verifyAfter.timeoutMs !== undefined
          ? { timeoutMs: step.verifyAfter.timeoutMs }
          : {}),
      },
      ctx,
    );
    job.artifacts.push({
      kind: "human-intervention-verified",
      capturedAt: now(),
      data: {
        passed: true,
        target: step.verifyAfter.target,
        condition,
        durationMs: now() - verificationStartedAt,
      },
    });
    log(`human checkpoint: verified ${describeTarget(step.verifyAfter.target)} ${condition}`);
  } catch (error) {
    job.artifacts.push({
      kind: "human-intervention-verified",
      capturedAt: now(),
      data: {
        passed: false,
        target: step.verifyAfter.target,
        condition,
        durationMs: now() - verificationStartedAt,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

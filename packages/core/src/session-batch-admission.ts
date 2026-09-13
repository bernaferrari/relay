import { publish } from "./events.js";
import { runWithOperationContext, type OperationContext } from "./operation-context.js";
import { finishDurableSessionJob, queueDurableSessionJob } from "./session-durable-worker.js";
import type { EnqueueJobInput, TestJob } from "./session-contract.js";
import { executionTargetRefForJob } from "./target-driver.js";
import { jobSchedulingTargetId } from "./browser-account-lane.js";
import type { TargetWorkerScheduledWork, TargetWorkerStagedBatch } from "./target-worker.js";

type ScheduledJob = TargetWorkerScheduledWork;

type SessionBatchScheduler = {
  stageBatch(work: readonly ScheduledJob[]): TargetWorkerStagedBatch;
};

export type DeferredSessionJobBatch = {
  jobs: TestJob[];
  /** Register queued jobs and target reservations while keeping their frozen
   * scheduler batch undispatchable. */
  activate(): TestJob[];
  /** Transfer activated work to the already-validated scheduler batch. This
   * is the no-throw post-campaign/lease-commit transition. */
  dispatch(): TestJob[];
  /** Compatibility shortcut for one-shot callers: activate then dispatch. */
  commit(): TestJob[];
  /** Mark staged durable assignments cancelled before they ever reach the
   * scheduler. Safe to call repeatedly after a failed campaign write. */
  rollback(): void;
};

export type SessionBatchAdmissionDependencies = {
  createJob(input: EnqueueJobInput): TestJob;
  validateJob(job: TestJob): void;
  registerCompletion(job: TestJob): void;
  forgetCompletion(job: TestJob): void;
  linkRetry(input: EnqueueJobInput, job: TestJob): void;
  unlinkRetry(input: EnqueueJobInput, job: TestJob): void;
  remember(job: TestJob): void;
  forgetUnstarted(job: TestJob): void;
  reserveTargetControl(job: TestJob): void;
  releaseTargetControl(job: TestJob): void;
  scheduler: SessionBatchScheduler;
  schedule(job: TestJob): ScheduledJob;
};

export type SessionBatchInput = {
  input: EnqueueJobInput;
  /** Each Combine cell may freeze a different admitted lease. */
  operationContext?: OperationContext;
};

function cancelDurableStaging(jobs: readonly TestJob[]): void {
  const failures: unknown[] = [];
  for (const job of jobs) {
    try {
      job.status = "cancelled";
      finishDurableSessionJob(job);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    const detail = failures
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join("; ");
    throw new Error(`Relay could not cancel staged durable jobs: ${detail}`);
  }
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rethrowWithCleanup(error: unknown, cleanupFailures: readonly unknown[]): never {
  if (!cleanupFailures.length) throw error;
  throw new Error(
    `Batch admission failed (${describeFailure(error)}) and compensation also failed: ${cleanupFailures
      .map(describeFailure)
      .join("; ")}`,
  );
}

/**
 * Validate and durably stage every job before one can reach the scheduler.
 * A later cell's invalid target or journal failure therefore cannot start an
 * earlier target. Callers may persist a campaign that references `jobs` and
 * only then call `commit`; on any failure they call `rollback`.
 */
export function prepareSessionJobBatch(
  inputs: readonly SessionBatchInput[],
  dependencies: SessionBatchAdmissionDependencies,
): DeferredSessionJobBatch {
  const jobs = inputs.map(({ input, operationContext }) => {
    const job = operationContext
      ? runWithOperationContext(operationContext, () => dependencies.createJob(input))
      : dependencies.createJob(input);
    dependencies.validateJob(job);
    return job;
  });
  const scheduled = jobs.map((job) => dependencies.schedule(job));
  // Stage the exact frozen work before any durable record. Unlike a dry-run,
  // this reservation participates in later scheduler-policy validation, so
  // dispatch after campaign persistence cannot be invalidated by a concurrent
  // enqueue changing host/target policy.
  const schedulerBatch = dependencies.scheduler.stageBatch(scheduled);
  const queued: TestJob[] = [];
  try {
    for (const job of jobs) {
      queueDurableSessionJob(job);
      queued.push(job);
    }
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    try {
      schedulerBatch.rollback();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    try {
      cancelDurableStaging(queued);
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    rethrowWithCleanup(error, cleanupFailures);
  }
  let state: "staged" | "activated" | "committed" | "rolled-back" = "staged";
  const completions: TestJob[] = [];
  const retryLinks: Array<{ input: EnqueueJobInput; job: TestJob }> = [];
  const remembered: TestJob[] = [];
  const reservations: TestJob[] = [];

  const compensate = (): unknown[] => {
    const cleanupFailures: unknown[] = [];
    try {
      schedulerBatch.rollback();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    for (const job of [...reservations].reverse()) {
      try {
        dependencies.releaseTargetControl(job);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    for (const job of [...remembered].reverse()) {
      try {
        dependencies.forgetUnstarted(job);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    for (const { input, job } of [...retryLinks].reverse()) {
      try {
        dependencies.unlinkRetry(input, job);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    for (const job of [...completions].reverse()) {
      try {
        dependencies.forgetCompletion(job);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    try {
      cancelDurableStaging(jobs);
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    state = "rolled-back";
    return cleanupFailures;
  };

  const activate = (): TestJob[] => {
    if (state === "committed" || state === "activated") return jobs;
    if (state === "rolled-back") throw new Error("Cannot activate a rolled-back job batch");
    try {
      // This is deliberately all before `schedulerBatch.dispatch()`. If a
      // registry, target-control, or event integration fails, compensation
      // leaves no visible queued job and the pre-staged scheduler work never
      // reaches a device.
      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index]!;
        const input = inputs[index]!.input;
        dependencies.registerCompletion(job);
        completions.push(job);
        dependencies.linkRetry(input, job);
        retryLinks.push({ input, job });
        dependencies.remember(job);
        remembered.push(job);
        if (job.targetContext.kind === "device") {
          dependencies.reserveTargetControl(job);
          reservations.push(job);
        }
        publish({
          type: "job.queued",
          at: job.queuedAt,
          jobId: job.id,
          action: job.action,
          serial: job.serial,
        });
      }
      state = "activated";
      return jobs;
    } catch (error) {
      rethrowWithCleanup(error, compensate());
    }
  };

  const dispatch = (): TestJob[] => {
    if (state === "committed") return jobs;
    if (state === "staged") activate();
    if (state === "rolled-back") throw new Error("Cannot dispatch a rolled-back job batch");
    try {
      // TargetWorkerScheduler dispatch is an array transfer plus an async
      // drain; its fallible policy work happened in stageBatch() above.
      schedulerBatch.dispatch();
      state = "committed";
      return jobs;
    } catch (error) {
      rethrowWithCleanup(error, compensate());
    }
  };

  return {
    jobs,
    activate,
    dispatch,
    commit: () => {
      activate();
      return dispatch();
    },
    rollback() {
      if (state === "rolled-back") return;
      if (state === "committed") {
        throw new Error("Committed job batches must use normal job cancellation");
      }
      const cleanupFailures = compensate();
      if (cleanupFailures.length) {
        throw new Error(
          `Relay could not compensate staged durable jobs: ${cleanupFailures
            .map(describeFailure)
            .join("; ")}`,
        );
      }
    },
  };
}

/** Create the one scheduler callback that session owns: it carries target
 * lane and host facts frozen on the job, without duplicating device execution
 * policy in Combine or campaign code. */
export function scheduledSessionJob(input: {
  job: TestJob;
  run: () => Promise<void>;
}): ScheduledJob {
  const { job } = input;
  return {
    id: job.id,
    workerId: job.workerId!,
    targetId: jobSchedulingTargetId({
      executionTarget: executionTargetRefForJob(job),
      browserCaseProfile: job.browserCaseProfile,
    }),
    capacity: job.workerCapacity!,
    ...(job.hostWorkerId && job.hostWorkerCapacity
      ? {
          host: {
            workerId: job.hostWorkerId,
            capacity: job.hostWorkerCapacity,
          },
        }
      : {}),
    run: input.run,
  };
}

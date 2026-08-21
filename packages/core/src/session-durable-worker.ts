/** Bridge job lifecycle transitions to the local durable worker journal. */
import {
  currentDurableWorkerInstanceId,
  durableWorkerAssignmentStore,
} from "./durable-worker-assignments.js";
import { executionTargetRefForJob } from "./target-driver.js";
import type { TestJob } from "./session-contract.js";

const DURABLE_WORKER_HEARTBEAT_MS = 15_000;

type TerminalSessionStatus = Extract<TestJob["status"], "ok" | "error" | "healed" | "cancelled">;

function terminalStatus(status: TestJob["status"]): status is TerminalSessionStatus {
  return status === "ok" || status === "error" || status === "healed" || status === "cancelled";
}

function requiredLane(job: TestJob): { workerId: string; capacity: number } {
  if (!job.workerId?.trim() || !job.workerCapacity) {
    throw new Error(`Job ${job.id} is missing its frozen target worker lane`);
  }
  return { workerId: job.workerId, capacity: job.workerCapacity };
}

/** Write durable queue admission before an in-memory scheduler can dispatch. */
export function queueDurableSessionJob(job: TestJob): void {
  const lane = requiredLane(job);
  const context = job.operationContext;
  durableWorkerAssignmentStore().queue({
    id: job.id,
    projectId: job.projectId ?? context?.projectId,
    executionTarget: executionTargetRefForJob(job),
    lane: {
      ...lane,
      ...(job.hostWorkerId && job.hostWorkerCapacity
        ? { host: { workerId: job.hostWorkerId, capacity: job.hostWorkerCapacity } }
        : {}),
    },
    ...(context?.leaseId
      ? {
          lease: {
            leaseId: context.leaseId,
            ownerId: context.leaseOwnerId ?? context.actorId,
            actorId: context.actorId,
          },
        }
      : {}),
    queuedAt: job.queuedAt,
  });
}

/** Claim the durable record immediately before any operation can affect a target. */
export function claimDurableSessionJob(job: TestJob): string {
  const workerInstanceId = currentDurableWorkerInstanceId();
  durableWorkerAssignmentStore().claimRunning(job.id, workerInstanceId);
  return workerInstanceId;
}

/** Keep an in-flight record current without putting SQLite work on every 50 ms
 * cancellation poll. */
export function createDurableSessionHeartbeat(jobId: string, workerInstanceId: string): () => void {
  let nextAt = Date.now() + DURABLE_WORKER_HEARTBEAT_MS;
  return () => {
    const now = Date.now();
    if (now < nextAt) return;
    durableWorkerAssignmentStore().heartbeat(jobId, workerInstanceId, now);
    nextAt = now + DURABLE_WORKER_HEARTBEAT_MS;
  };
}

export function setDurableSessionPaused(
  jobId: string,
  paused: boolean,
  workerInstanceId = currentDurableWorkerInstanceId(),
): void {
  durableWorkerAssignmentStore().setPaused(jobId, workerInstanceId, paused);
}

/** Finalize only after the run manifest is durable. It is safe to repeat an
 * identical terminal update, which covers races between cancel and scheduler
 * drain without inventing a second execution. */
export function finishDurableSessionJob(
  job: Pick<TestJob, "id" | "status">,
  workerInstanceId?: string,
): void {
  if (!terminalStatus(job.status)) return;
  durableWorkerAssignmentStore().finish({
    id: job.id,
    status: job.status,
    ...(workerInstanceId ? { workerInstanceId } : {}),
  });
}

/**
 * Wrap one scheduler dispatch with durable ownership. `execute` runs only
 * after SQLite records the process that owns the target; terminality is
 * written only after the caller has durably persisted its run manifest.
 */
export async function runScheduledSessionJob(input: {
  job: TestJob;
  execute: (workerInstanceId: string) => Promise<void>;
  onDispatchFailure: (error: unknown) => Promise<void>;
  onDurabilityFailure: (error: unknown) => void;
}): Promise<void> {
  let workerInstanceId: string | undefined;
  try {
    if (input.job.status === "cancelled") return;
    workerInstanceId = claimDurableSessionJob(input.job);
    // A racing cancel now follows the active-job path and observes the durable
    // worker owner instead of trying to terminalize a queued record.
    input.job.status = "running";
    await input.execute(workerInstanceId);
  } catch (error) {
    if (
      input.job.status === "queued" ||
      input.job.status === "running" ||
      input.job.status === "paused"
    ) {
      await input.onDispatchFailure(error);
    }
  } finally {
    if (input.job.persisted) {
      try {
        finishDurableSessionJob(input.job, workerInstanceId);
      } catch (error) {
        input.onDurabilityFailure(error);
      }
    }
  }
}

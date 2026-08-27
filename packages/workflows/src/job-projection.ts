import type { FrozenRunTestIdentity, RunTestSnapshot, WorkflowProblem } from "./types.js";
import type { WorkflowRef } from "./types.js";

export type CanonicalJob = {
  id: string;
  action: string;
  status: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  updatedAt?: number;
  frameCount?: number;
  runId?: string;
  error?: string;
};

export function parseCanonicalJob(value: unknown): CanonicalJob | undefined {
  if (!value || typeof value !== "object") return undefined;
  const job = value as Record<string, unknown>;
  if (
    typeof job.id !== "string" ||
    !job.id ||
    typeof job.action !== "string" ||
    !job.action ||
    typeof job.status !== "string" ||
    !job.status ||
    typeof job.queuedAt !== "number"
  ) {
    return undefined;
  }
  const optionalNumbers = ["startedAt", "finishedAt", "updatedAt", "frameCount"] as const;
  if (optionalNumbers.some((key) => job[key] !== undefined && typeof job[key] !== "number")) {
    return undefined;
  }
  if (job.runId !== undefined && typeof job.runId !== "string") return undefined;
  if (job.error !== undefined && typeof job.error !== "string") return undefined;
  return job as CanonicalJob;
}

function fingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function workflowVersionForJob(job: CanonicalJob): string {
  return `job-v1-${fingerprint(
    JSON.stringify([
      job.id,
      job.status,
      job.startedAt,
      job.finishedAt,
      job.updatedAt,
      job.frameCount,
      job.runId,
      job.error,
    ]),
  )}`;
}

function jobPhase(job: CanonicalJob): RunTestSnapshot["phase"] {
  if (job.status === "queued") return "queued";
  if (job.status === "running") return "running";
  if (job.status === "paused") return "paused";
  if (["ok", "healed", "succeeded", "completed"].includes(job.status)) return "succeeded";
  if (["error", "failed"].includes(job.status)) return "failed";
  if (["cancelled", "canceled"].includes(job.status)) return "cancelled";
  return "needs-attention";
}

function progressLabel(job: CanonicalJob, phase: RunTestSnapshot["phase"]): string {
  if (phase === "queued") return "Waiting for the selected target";
  if (phase === "running") {
    return job.frameCount ? `Running test · ${job.frameCount} frames captured` : "Running test";
  }
  if (phase === "paused") return "Run paused";
  if (phase === "succeeded") return "Test completed";
  if (phase === "failed") return "Test failed";
  if (phase === "cancelled") return "Run cancelled";
  return `Relay reported an unknown job status: ${job.status}`;
}

export function snapshotFromJob(input: {
  ref: WorkflowRef;
  frozen: FrozenRunTestIdentity;
  job: CanonicalJob;
  extraProblems?: readonly WorkflowProblem[];
}): RunTestSnapshot {
  const { ref, frozen, job } = input;
  const phase = jobPhase(job);
  const problems = [...(input.extraProblems ?? [])];
  if (phase === "failed") {
    problems.push({
      code: "operation-unavailable",
      title: "The test did not complete",
      detail: job.error ?? "The canonical run ended with an error.",
      recovery:
        "Inspect the run evidence, repair the Test if needed, then start a new run explicitly.",
      retryable: false,
    });
  } else if (phase === "needs-attention") {
    problems.push({
      code: "unknown-job-status",
      title: "Relay cannot classify this run",
      detail: `The canonical job status is ${job.status}.`,
      recovery: "Inspect the job with a Relay version that understands this status.",
      retryable: false,
    });
  }
  const active = phase === "queued" || phase === "running" || phase === "paused";
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: `Run ${frozen.testId}`,
    phase,
    version: workflowVersionForJob(job),
    ref,
    frozen,
    execution: { jobId: job.id, ...(job.runId ? { runId: job.runId } : {}) },
    progress: {
      label: progressLabel(job, phase),
      ...(typeof job.frameCount === "number" ? { completed: job.frameCount } : {}),
    },
    allowedNextActions: active ? ["inspect", "cancel"] : ["inspect"],
    problems,
    evidenceRefs: job.runId ? [{ kind: "run", id: job.runId }] : [],
  };
}

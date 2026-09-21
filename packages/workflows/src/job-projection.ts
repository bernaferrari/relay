import type {
  DurableWorkflowHandle,
  FrozenRunTestIdentity,
  RunTestSnapshot,
  WorkflowProblem,
} from "./types.js";
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
  recipeSnapshot?: {
    steps?: readonly {
      kind?: string;
      check?: { id?: string; title?: string };
    }[];
  };
  artifacts?: readonly { kind: string; data?: unknown }[];
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
  if (
    job.recipeSnapshot !== undefined &&
    (!job.recipeSnapshot ||
      typeof job.recipeSnapshot !== "object" ||
      Array.isArray(job.recipeSnapshot) ||
      !Array.isArray((job.recipeSnapshot as { steps?: unknown }).steps) ||
      (job.recipeSnapshot as { steps: unknown[] }).steps.some(
        (step) =>
          !step ||
          typeof step !== "object" ||
          ((step as { kind?: unknown }).kind !== undefined &&
            typeof (step as { kind?: unknown }).kind !== "string") ||
          ((step as { check?: unknown }).check !== undefined &&
            (!(step as { check?: unknown }).check ||
              typeof (step as { check?: unknown }).check !== "object" ||
              Array.isArray((step as { check?: unknown }).check) ||
              typeof (step as { check: { id?: unknown } }).check.id !== "string" ||
              typeof (step as { check: { title?: unknown } }).check.title !== "string")),
      ))
  )
    return undefined;
  if (
    job.artifacts !== undefined &&
    (!Array.isArray(job.artifacts) ||
      job.artifacts.some(
        (artifact) =>
          !artifact ||
          typeof artifact !== "object" ||
          typeof (artifact as { kind?: unknown }).kind !== "string",
      ))
  )
    return undefined;
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
      authoredProgress(job),
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

/** Count undecided human-review obligations on capture-review artifacts.
 * A decided capture carries one of the review verbs; only "pending" (or a
 * missing status on a fully-formed review entry) still requires a person. */
function reviewObligations(job: CanonicalJob): { pending: number; decided: number } | undefined {
  const reviews = (job.artifacts ?? []).filter((artifact) => artifact.kind === "capture-review");
  if (reviews.length === 0) return undefined;
  let pending = 0;
  for (const artifact of reviews) {
    const data = artifact.data;
    const status =
      data !== null && typeof data === "object" && "status" in data
        ? (data.status as unknown)
        : undefined;
    if (status === undefined || status === "pending") pending += 1;
  }
  return { pending, decided: reviews.length - pending };
}

function progressLabel(job: CanonicalJob, phase: RunTestSnapshot["phase"]): string {
  if (phase === "queued") return "Waiting for the selected target";
  if (phase === "running") {
    const authored = authoredProgress(job);
    if (authored) {
      return `Running test · ${authored.title}`;
    }
    return job.frameCount ? `Running test · ${job.frameCount} frames captured` : "Running test";
  }
  if (phase === "paused") return "Run paused";
  if (phase === "succeeded") return "Test completed";
  if (phase === "failed") return "Test failed";
  if (phase === "cancelled") return "Run cancelled";
  return `Relay reported an unknown job status: ${job.status}`;
}

function authoredProgress(
  job: CanonicalJob,
): { completed: number; total: number; title: string } | undefined {
  const planned = job.recipeSnapshot?.steps
    ?.filter((step) => step.kind === "module" && step.check?.id && step.check.title)
    .map((step) => ({ id: step.check!.id!, title: step.check!.title! }));
  if (!planned?.length) return undefined;
  const completedIds = new Set(
    (job.artifacts ?? [])
      .filter((artifact) => artifact.kind === "campaign-check-result")
      .flatMap((artifact) => {
        const data = artifact.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) return [];
        const result = data as { id?: unknown; status?: unknown };
        return typeof result.id === "string" && result.status === "passed" ? [result.id] : [];
      }),
  );
  const completed = planned.findIndex((step) => !completedIds.has(step.id));
  const index = completed < 0 ? planned.length : completed;
  return {
    completed: index,
    total: planned.length,
    title: planned[Math.min(index, planned.length - 1)]!.title,
  };
}

export function snapshotFromJob(input: {
  ref?: WorkflowRef;
  workflow?: DurableWorkflowHandle;
  frozen: FrozenRunTestIdentity;
  job: CanonicalJob;
  extraProblems?: readonly WorkflowProblem[];
}): RunTestSnapshot {
  const { frozen, job } = input;
  // Relay persists a Run under the canonical job id. Older/provider-specific
  // projections may also include an explicit runId, but Product navigation
  // must not depend on that redundant field being present.
  const runId = job.runId ?? job.id;
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
  const authored = phase === "running" ? authoredProgress(job) : undefined;
  const review = reviewObligations(job);
  if (!active && review && review.pending > 0) {
    problems.push({
      code: "review-required",
      title: `${review.pending} capture${review.pending === 1 ? "" : "s"} await${
        review.pending === 1 ? "s" : ""
      } human review`,
      detail:
        "Collection completed, but acceptance is not final until a person decides on the pending captures.",
      recovery: `Review the run's captures (run ${runId}), then rerun this command to confirm the final outcome.`,
      retryable: false,
    });
  }
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: `Run ${frozen.testId}`,
    phase,
    version: input.workflow
      ? `workflow-v${input.workflow.expectedVersion}`
      : workflowVersionForJob(job),
    ...(input.workflow ? { workflow: input.workflow } : {}),
    ...(input.ref ? { ref: input.ref } : {}),
    frozen,
    execution: { jobId: job.id, runId },
    progress: {
      label: progressLabel(job, phase),
      ...(authored
        ? { completed: authored.completed, total: authored.total }
        : typeof job.frameCount === "number"
          ? { completed: job.frameCount }
          : {}),
    },
    allowedNextActions: active ? ["inspect", "cancel"] : ["inspect"],
    ...(review ? { review } : {}),
    problems,
    evidenceRefs: [{ kind: "run", id: runId }],
  };
}

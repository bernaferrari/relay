import type { DurableWorkflowOperationOutput, OperationOutput } from "@relay/protocol";
import type { RelayOperationPort } from "./operation-port.js";
import { parseCanonicalJob, snapshotFromJob } from "./job-projection.js";
import type {
  DurableWorkflowHandle,
  FrozenRunTestIdentity,
  RunTestIntent,
  RunTestRecoveryIntent,
  RunTestSnapshot,
  WorkflowDecision,
  WorkflowProblem,
  WorkflowRef,
} from "./types.js";
import { encodeRunWorkflowRef, type RunWorkflowReference } from "./workflow-ref.js";
import { readRunJob } from "./run-workflow-job-inspection.js";
import { queuedRunIdentityFromJob } from "./run-workflow-execution-identity.js";
import {
  mutationUnknownWorkflowProblem as mutationUnknownProblem,
  unavailableWorkflowProblem as unavailableProblem,
} from "./workflow-problems.js";
import {
  durableRunSnapshot,
  unavailableDurableRun,
  type ValidCompile,
} from "./run-workflow-support.js";
import { startRunTest } from "./run-workflow-start.js";

export class CanonicalRunWorkflow {
  constructor(private readonly operations: RelayOperationPort) {}

  async start(intent: RunTestIntent): Promise<RunTestSnapshot> {
    return startRunTest(this.operations, intent);
  }

  async recover(intent: RunTestRecoveryIntent): Promise<RunTestSnapshot> {
    const unavailable = (problem: WorkflowProblem): RunTestSnapshot => ({
      schemaVersion: 1,
      kind: "run-test",
      title: `Run ${intent.frozen.testId}`,
      phase: "needs-attention",
      version: "recovery-needed",
      frozen: intent.frozen,
      progress: { label: problem.title },
      allowedNextActions: [],
      problems: [problem],
      evidenceRefs: [],
    });
    let summaries: OperationOutput<"job.list">["jobs"];
    try {
      ({ jobs: summaries } = await this.operations.invoke("job.list", { limit: 100 }));
    } catch (error) {
      return unavailable({
        ...unavailableProblem("inspect canonical jobs", error),
        recovery:
          "Restore Relay connectivity, then inspect this uncertain Run again. Do not start another Run.",
      });
    }
    const recent = summaries.filter((job) => job.queuedAt >= intent.startedAfter - 1_000);
    const matches: Array<{
      job: NonNullable<ReturnType<typeof parseCanonicalJob>>;
      frozen: FrozenRunTestIdentity;
      compiled?: ValidCompile;
    }> = [];
    for (const summary of recent) {
      try {
        const output = await this.operations.invoke("job.get", { jobId: summary.id });
        const raw = output.job as unknown as Record<string, unknown>;
        const job = parseCanonicalJob(raw);
        if (!job) continue;
        const identity = queuedRunIdentityFromJob({
          frozen: intent.frozen,
          job: raw,
          matchPlanDigest: !intent.frozen.workflowRequestId,
        });
        if (identity.status !== "verified") continue;
        matches.push({ job, frozen: identity.frozen, compiled: identity.compiled });
      } catch {
        // One unreadable candidate cannot justify retrying a possibly completed mutation.
      }
    }
    if (matches.length !== 1) {
      return unavailable({
        code: "mutation-outcome-unknown",
        title:
          matches.length > 1
            ? "More than one canonical Run matches this request"
            : "Relay has not found the uncertain Run yet",
        detail:
          matches.length > 1
            ? "Relay cannot choose one Run without risking attribution to the wrong execution."
            : "The enqueue may still be persisting, or its canonical job is not currently readable.",
        recovery:
          "Inspect this uncertain Run again after Relay is available. Do not start another Run.",
        retryable: false,
      });
    }
    const match = matches[0]!;
    const frozen = match.frozen;
    const ref = encodeRunWorkflowRef({
      schemaVersion: 1,
      kind: "run-test",
      jobId: match.job.id,
      frozen,
    });
    return {
      ...snapshotFromJob({ ref, frozen, job: match.job }),
      ...(match.compiled
        ? { compiled: { plan: match.compiled.plan, preflight: match.compiled.preflight } }
        : {}),
    };
  }

  async inspect(ref: WorkflowRef, reference: RunWorkflowReference): Promise<RunTestSnapshot> {
    return readRunJob(this.operations, ref, reference);
  }

  async inspectRun(workflowId: string): Promise<RunTestSnapshot> {
    try {
      return durableRunSnapshot(await this.operations.invoke("workflow.get", { workflowId }));
    } catch (error) {
      return unavailableDurableRun({
        workflow: { workflowId, expectedVersion: 1 },
        problem: {
          ...unavailableProblem("inspect the durable Run workflow", error),
          recovery:
            "Restore Relay connectivity, then inspect this workflow ID again. Do not start another Run.",
        },
      });
    }
  }

  snapshotDurable(output: DurableWorkflowOperationOutput): RunTestSnapshot {
    return durableRunSnapshot(output);
  }

  async cancelRun(input: DurableWorkflowHandle): Promise<RunTestSnapshot> {
    try {
      return durableRunSnapshot(
        await this.operations.invoke("workflow.transition", {
          workflowId: input.workflowId,
          expectedVersion: input.expectedVersion,
          action: "cancel-run",
        }),
      );
    } catch (error) {
      try {
        const inspected = durableRunSnapshot(
          await this.operations.invoke("workflow.get", { workflowId: input.workflowId }),
        );
        return {
          ...inspected,
          problems: [
            ...inspected.problems,
            mutationUnknownProblem("the exact Run was cancelled", error),
          ],
        };
      } catch {
        // A failed read cannot justify issuing the cancellation again.
      }
      return unavailableDurableRun({
        workflow: input,
        problem: mutationUnknownProblem("the exact Run was cancelled", error),
      });
    }
  }

  async advance(
    decision: WorkflowDecision,
    reference: RunWorkflowReference,
  ): Promise<RunTestSnapshot> {
    const current = await readRunJob(this.operations, decision.ref, reference);
    if (!current.execution || current.version === "unavailable") return current;
    if (current.version !== decision.expectedVersion) {
      return {
        ...current,
        problems: [
          ...current.problems,
          {
            code: "stale-workflow-version",
            title: "This run changed before cancellation",
            detail: "The supplied workflow version no longer matches the canonical job.",
            recovery:
              "Review the latest snapshot and explicitly cancel again only if it is still active.",
            retryable: true,
          },
        ],
      };
    }
    if (decision.action !== "cancel") {
      return {
        ...current,
        problems: [
          ...current.problems,
          {
            code: "unexpected-authoring-state",
            title: "This decision does not apply to a Test run",
            detail: `The ${decision.action} decision belongs to an Authoring Session.`,
            recovery: "Use a decision allowed by the latest workflow snapshot.",
            retryable: false,
          },
        ],
      };
    }
    if (!current.allowedNextActions.includes("cancel")) return current;

    try {
      const cancelled = await this.operations.invoke("job.cancel", { jobId: reference.jobId });
      const job = parseCanonicalJob(cancelled.job);
      if (!job || job.id !== reference.jobId) {
        throw new TypeError("Cancellation response does not identify the requested job");
      }
      return snapshotFromJob({ ref: decision.ref, frozen: reference.frozen, job });
    } catch (error) {
      return {
        ...current,
        phase: "needs-attention",
        allowedNextActions: ["inspect"],
        problems: [
          ...current.problems,
          mutationUnknownProblem("the exact run was cancelled", error),
        ],
        progress: { label: "Cancellation outcome needs inspection" },
      };
    }
  }
}

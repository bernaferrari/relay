import type { OfflineTestPreflightFinding, OperationInput, OperationOutput } from "@relay/protocol";
import {
  createRelayOperationPort,
  type RelayInvokeClient,
  type RelayOperationPort,
} from "./operation-port.js";
import { parseCanonicalJob, snapshotFromJob } from "./job-projection.js";
import type {
  FrozenRunTestIdentity,
  RelayWorkflows,
  RunTestIntent,
  WorkflowProblem,
  WorkflowRef,
  WorkflowSnapshot,
} from "./types.js";
import {
  decodeRunWorkflowRef,
  encodeRunWorkflowRef,
  type RunWorkflowReference,
} from "./workflow-ref.js";

type ValidCompile = {
  plan: OperationOutput<"app-map.test.compile">["plan"];
  preflight: OperationOutput<"app-map.test.compile">["preflight"];
  blockers: OfflineTestPreflightFinding[];
};

function errorDetail(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Relay did not return a usable response.";
}

function initialProblem(input: {
  intent: RunTestIntent;
  problem: WorkflowProblem;
  frozen?: FrozenRunTestIdentity;
  phase?: WorkflowSnapshot["phase"];
}): WorkflowSnapshot {
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: `Run ${input.intent.testId}`,
    phase: input.phase ?? "blocked",
    version: "unstarted",
    ...(input.frozen ? { frozen: input.frozen } : {}),
    progress: { label: input.problem.title },
    allowedNextActions: [],
    problems: [input.problem],
    evidenceRefs: [],
  };
}

function unavailableProblem(stage: string, error: unknown): WorkflowProblem {
  return {
    code: "operation-unavailable",
    title: `Relay could not ${stage}`,
    detail: errorDetail(error),
    recovery: "Resolve the reported Relay problem, then start this workflow again explicitly.",
    retryable: true,
  };
}

function mutationUnknownProblem(action: string, error: unknown): WorkflowProblem {
  return {
    code: "mutation-outcome-unknown",
    title: `Relay cannot prove whether ${action}`,
    detail: errorDetail(error),
    recovery:
      "Inspect canonical jobs before starting or cancelling anything again. Relay will not retry this mutation.",
    retryable: false,
  };
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function readCompile(
  output: OperationOutput<"app-map.test.compile">,
  identity: { appMapId: string; appMapRevision: number; testId: string },
): ValidCompile | undefined {
  const preflight = output.preflight;
  if (
    !preflight ||
    typeof preflight !== "object" ||
    !output.plan ||
    typeof output.plan !== "object"
  ) {
    return undefined;
  }
  if (
    preflight.schemaVersion !== 1 ||
    preflight.mode !== "offline-test-preflight" ||
    preflight.appMapId !== identity.appMapId ||
    preflight.appMapRevision !== identity.appMapRevision ||
    preflight.testId !== identity.testId ||
    typeof preflight.planDigest !== "string" ||
    !preflight.planDigest ||
    !preflight.summary ||
    !validRevision(preflight.summary.blockers) ||
    !Array.isArray(preflight.findings)
  ) {
    return undefined;
  }
  const blockers = preflight.findings.filter((finding): finding is OfflineTestPreflightFinding =>
    Boolean(
      finding &&
      typeof finding === "object" &&
      finding.severity === "blocker" &&
      typeof finding.code === "string" &&
      typeof finding.message === "string",
    ),
  );
  if (blockers.length !== preflight.summary.blockers) return undefined;
  return { plan: output.plan, preflight, blockers };
}

function frozenIdentity(
  intent: RunTestIntent,
  revision: number,
  planDigest: string,
  rootRecipeId?: string,
): FrozenRunTestIdentity {
  return {
    appMapId: intent.appMapId,
    appMapRevision: revision,
    testId: intent.testId,
    ...(rootRecipeId ? { rootRecipeId } : {}),
    planDigest,
    target: { ...intent.target },
    ...(intent.startup ? { startup: { ...intent.startup } } : {}),
    ...(intent.sourceRevision ? { sourceRevision: { ...intent.sourceRevision } } : {}),
    ...(intent.capture
      ? { capture: { fullSurfaceScreenIds: [...intent.capture.fullSurfaceScreenIds] } }
      : {}),
  };
}

function invalidRefSnapshot(ref: WorkflowRef): WorkflowSnapshot {
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: "Relay run",
    phase: "needs-attention",
    version: "invalid-ref",
    ref,
    progress: { label: "The workflow reference is invalid" },
    allowedNextActions: [],
    problems: [
      {
        code: "invalid-workflow-ref",
        title: "Relay cannot inspect this workflow",
        detail: "The opaque workflow reference is malformed or belongs to an unsupported version.",
        recovery: "Use the reference returned by start without editing it.",
        retryable: false,
      },
    ],
    evidenceRefs: [],
  };
}

class CanonicalRelayWorkflows implements RelayWorkflows {
  constructor(private readonly operations: RelayOperationPort) {}

  async start(intent: RunTestIntent): Promise<WorkflowSnapshot> {
    let revision: number;
    if (intent.revision && intent.revision !== "current") {
      revision = intent.revision.exact;
      if (!validRevision(revision)) {
        return initialProblem({
          intent,
          problem: {
            code: "invalid-intent",
            title: "The requested revision is invalid",
            detail: "An exact App Map revision must be a non-negative integer.",
            recovery: "Choose current or provide a valid exact revision.",
            retryable: false,
          },
        });
      }
    } else {
      try {
        const current = await this.operations.invoke("app-map.get", { appMapId: intent.appMapId });
        revision = current.appMap.revision;
        if (!validRevision(revision)) throw new TypeError("App Map response has no valid revision");
      } catch (error) {
        return initialProblem({
          intent,
          problem: unavailableProblem("read the current App Map", error),
        });
      }
    }

    let compiled: OperationOutput<"app-map.test.compile">;
    try {
      compiled = await this.operations.invoke("app-map.test.compile", {
        appMapId: intent.appMapId,
        testId: intent.testId,
      });
    } catch (error) {
      return initialProblem({ intent, problem: unavailableProblem("compile the Test", error) });
    }

    const checkedCompile = readCompile(compiled, {
      appMapId: intent.appMapId,
      appMapRevision: revision,
      testId: intent.testId,
    });
    if (!checkedCompile) {
      return initialProblem({
        intent,
        problem: {
          code: "malformed-response",
          title: "Relay could not verify the compiled Test",
          detail:
            "The compile result did not match the requested App Map, Test, and frozen revision.",
          recovery:
            "Do not run this Test until the operation response or revision conflict is resolved.",
          retryable: false,
        },
      });
    }

    const frozen = frozenIdentity(intent, revision, checkedCompile.preflight.planDigest);
    if (checkedCompile.blockers.length) {
      const primary = checkedCompile.blockers[0];
      return initialProblem({
        intent,
        frozen,
        problem: {
          code: "compile-blocked",
          title: `The Test has ${checkedCompile.blockers.length} compile blocker${checkedCompile.blockers.length === 1 ? "" : "s"}`,
          detail: primary.message,
          recovery: "Repair the reviewed Test evidence or selector, then start a new workflow.",
          retryable: false,
          sourceCode: primary.code,
        },
      });
    }

    const runInput: OperationInput<"app-map.test.run"> = {
      appMapId: intent.appMapId,
      testId: intent.testId,
      expectedRevision: revision,
      target: { ...intent.target },
      ...(intent.startup ? { startup: { ...intent.startup } } : {}),
      ...(intent.sourceRevision ? { sourceRevision: { ...intent.sourceRevision } } : {}),
      ...(intent.capture
        ? { surfaceCapture: { forceRecaptureScreenIds: [...intent.capture.fullSurfaceScreenIds] } }
        : {}),
    };
    let run: OperationOutput<"app-map.test.run">;
    try {
      run = await this.operations.invoke("app-map.test.run", runInput);
    } catch (error) {
      return initialProblem({
        intent,
        frozen,
        phase: "needs-attention",
        problem: mutationUnknownProblem("the Test run was queued", error),
      });
    }

    const job = parseCanonicalJob(run.job);
    const identity = run.planIdentity;
    if (
      !job ||
      identity.appMapId !== intent.appMapId ||
      identity.appMapRevision !== revision ||
      identity.testId !== intent.testId ||
      typeof identity.rootRecipeId !== "string" ||
      !identity.rootRecipeId
    ) {
      return initialProblem({
        intent,
        frozen,
        phase: "needs-attention",
        problem: mutationUnknownProblem(
          "the Test run was queued",
          "The run response failed identity validation.",
        ),
      });
    }

    const finalFrozen = frozenIdentity(
      intent,
      revision,
      checkedCompile.preflight.planDigest,
      identity.rootRecipeId,
    );
    const ref = encodeRunWorkflowRef({
      schemaVersion: 1,
      kind: "run-test",
      jobId: job.id,
      frozen: finalFrozen,
    });
    return snapshotFromJob({ ref, frozen: finalFrozen, job });
  }

  async inspect(ref: WorkflowRef): Promise<WorkflowSnapshot> {
    const reference = decodeRunWorkflowRef(ref);
    if (!reference) return invalidRefSnapshot(ref);
    return this.readJob(ref, reference);
  }

  async advance(decision: {
    action: "cancel";
    ref: WorkflowRef;
    expectedVersion: string;
  }): Promise<WorkflowSnapshot> {
    const reference = decodeRunWorkflowRef(decision.ref);
    if (!reference) return invalidRefSnapshot(decision.ref);
    const current = await this.readJob(decision.ref, reference);
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

  private async readJob(
    ref: WorkflowRef,
    reference: RunWorkflowReference,
  ): Promise<WorkflowSnapshot> {
    try {
      const output = await this.operations.invoke("job.get", { jobId: reference.jobId });
      const job = parseCanonicalJob(output.job);
      if (!job || job.id !== reference.jobId) {
        throw new TypeError("Job response does not identify the workflow job");
      }
      return snapshotFromJob({ ref, frozen: reference.frozen, job });
    } catch (error) {
      return {
        schemaVersion: 1,
        kind: "run-test",
        title: `Run ${reference.frozen.testId}`,
        phase: "needs-attention",
        version: "unavailable",
        ref,
        frozen: reference.frozen,
        execution: { jobId: reference.jobId },
        progress: { label: "Relay could not inspect the canonical job" },
        allowedNextActions: ["inspect"],
        problems: [
          {
            code: "malformed-response",
            title: "Relay could not inspect this run",
            detail: errorDetail(error),
            recovery:
              "Restore Relay connectivity or repair the response contract, then inspect again.",
            retryable: true,
          },
        ],
        evidenceRefs: [],
      };
    }
  }
}

export function createRelayWorkflows(client: RelayInvokeClient): RelayWorkflows {
  return new CanonicalRelayWorkflows(createRelayOperationPort(client));
}

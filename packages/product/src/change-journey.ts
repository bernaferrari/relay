import type {
  ChangeProofExecutionNextAction,
  ChangeProofExecutionHumanEvidenceAttachment,
  ChangeProofExecutionStatus,
  AgentRepairPacket,
  ChangeProofPublicationOutboxStatus,
  ChangeVerificationDecision,
  ChangeVerificationState,
  OperationInput,
  OperationOutput,
} from "@relay/protocol";
import { createChangeVerificationWorkflow } from "@relay/workflows";
import { projectError, type HumanError } from "./errors.js";
import {
  createRelayOperationPort,
  type RelayInvokeClient,
  type RelayOperationPort,
} from "@relay/workflows/operation-port";

/** Product-facing Change summary. Plan units, cells, and digests deliberately
 * remain below this boundary; the server is still the authority for them. */
export type ProductChange = {
  readonly id: string;
  readonly version: number;
  readonly status: ChangeVerificationState;
  readonly repository: string;
  readonly title: string;
  readonly pullRequest?: number;
  readonly targetBranch?: string;
  readonly agentClaim?: {
    readonly summary: string;
    readonly acceptanceCriteria: readonly string[];
  };
  readonly baseRevision: string;
  readonly requestedRevision: string;
  readonly decision?: ChangeVerificationDecision;
  readonly runs: readonly string[];
  readonly evidenceCount: number;
  readonly coverageGaps: readonly string[];
  readonly residualRisk: readonly string[];
  readonly appIds?: readonly string[];
  readonly affectedTestCount: number;
  readonly requiredVerificationCount: number;
  readonly advisoryVerificationCount: number;
  readonly updatedAt: number;
};

export type ProductAffectedTest = {
  readonly appId: string;
  readonly testId: string;
  readonly reason: string;
  readonly confidence: "definite" | "probable" | "coverage-gap";
  readonly revision?: number;
};

export type ProductVerificationItem = {
  readonly id: string;
  readonly appId: string;
  readonly testId: string;
  readonly targetName: string;
  readonly platform: "android" | "ios" | "browser";
  readonly buildName: string;
  readonly requirement: "required" | "advisory";
  readonly reason: string;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly estimatedDurationMs?: number;
  readonly cleanupRequired: boolean;
  readonly pilot: boolean;
};

export type ProductChangeExecution = {
  readonly id: string;
  readonly status: ChangeProofExecutionStatus;
  readonly completed: number;
  readonly total: number;
  readonly nextAction: ChangeProofExecutionNextAction;
  readonly currentVerificationId?: string;
  readonly attention?: {
    readonly kind: "human-evidence" | "uncertain";
    readonly reason: string;
    readonly executionId?: string;
    readonly cellId?: string;
    readonly stepId?: string;
  };
};

/** Bounded server-owned repair instructions. Product surfaces may render
 * these fields, but never construct or revise the packet themselves. */
export type ProductChangeRepairPacket = Pick<
  AgentRepairPacket,
  | "proofId"
  | "headSha"
  | "runId"
  | "appMapId"
  | "testId"
  | "targetCaseId"
  | "firstCausalFailure"
  | "expected"
  | "observed"
  | "evidenceRefs"
  | "relevantLogs"
  | "suggestedScope"
  | "rerun"
>;

export type ProductChangePublication = {
  readonly id: string;
  readonly status: ChangeProofPublicationOutboxStatus | "completed" | "queued" | "in_progress";
  readonly provider?: "github";
  readonly detailsUrl?: string;
  readonly attempts?: number;
  readonly canRetry: boolean;
};

export type ProductChangeDetails = {
  readonly change: ProductChange;
  readonly history: readonly ProductChange[];
  readonly publications: readonly ProductChangePublication[];
  readonly affectedTests: readonly ProductAffectedTest[];
  readonly verificationPlan: readonly ProductVerificationItem[];
  readonly firstFailure?: {
    readonly summary: string;
    readonly runId: string;
    readonly testId?: string;
  };
  readonly repairPacket?: ProductChangeRepairPacket;
  readonly nextVerification?: {
    readonly kind: "approve-plan" | "provide-build" | "run-pilot" | "expand" | "review" | "none";
    readonly reason: string;
  };
  readonly planApproved: boolean;
  readonly audit: {
    readonly policy: string;
    readonly policyId: string;
    readonly policyVersion: number;
    readonly policyDigest?: string;
    readonly planDigest?: string;
    readonly decisionDigest?: string;
    readonly requestedBy: string;
    readonly updatedBy: string;
    readonly buildIds: readonly string[];
    readonly proofVersion: number;
  };
  readonly execution?: ProductChangeExecution;
};

export type ProductChangeReport = {
  readonly id: string;
  readonly changeId: string;
  readonly status: ChangeVerificationState;
  readonly decision?: ChangeVerificationDecision;
  readonly runIds: readonly string[];
  readonly evidenceCount: number;
  readonly publicationCount: number;
  readonly summary: string;
};

export type ProductChangeState = {
  readonly status: "idle" | "preparing" | "ready" | "running" | "completed" | "needs-attention";
  readonly change?: ProductChange;
  readonly details?: ProductChangeDetails;
  readonly report?: ProductChangeReport;
  readonly recovery?: HumanError;
};

export type ProductChangeJourney = {
  state(): ProductChangeState;
  list(input?: OperationInput<"proof.list">): Promise<readonly ProductChange[]>;
  open(changeId: string, includeHistory?: boolean): Promise<ProductChangeState>;
  prepare(input?: Omit<OperationInput<"proof.prepare">, "policy">): Promise<ProductChangeState>;
  approve(
    input: Omit<OperationInput<"proof.plan.approve">, "proofId"> & { changeId: string },
  ): Promise<ProductChangeState>;
  run(input: {
    changeId: string;
    expectedVersion?: number;
    wait?: boolean;
  }): Promise<ProductChangeState>;
  watch(input?: {
    signal?: AbortSignal;
    pollMs?: number;
    onState?: (state: ProductChangeState) => void;
  }): Promise<ProductChangeState>;
  cancel(input?: {
    changeId?: string;
    expectedVersion?: number;
    reason?: string;
  }): Promise<ProductChangeState>;
  report(changeId?: string): Promise<ProductChangeReport | undefined>;
  retryPublication(input: {
    changeId: string;
    publicationId: string;
    expectedVersion: number;
    reason: string;
  }): Promise<ProductChangeState>;
  rerunAffected(input: { changeId: string; expectedVersion: number }): Promise<ProductChangeState>;
  resumeHumanEvidence(input: {
    changeId: string;
    executionId: string;
    cellId: string;
    stepId: string;
    attachment: ChangeProofExecutionHumanEvidenceAttachment;
    wait?: boolean;
  }): Promise<ProductChangeState>;
};

type Proof = OperationOutput<"proof.inspect">["proof"];
type Inspect = OperationOutput<"proof.inspect">;

function changeOf(proof: Proof): ProductChange {
  const cells = proof.selection.cells ?? [];
  return {
    id: proof.id,
    version: proof.version,
    status: proof.state as ChangeVerificationState,
    repository: proof.change.repository,
    title: changeTitle(proof),
    ...(proof.change.pullRequest ? { pullRequest: proof.change.pullRequest } : {}),
    ...(proof.change.targetBranch ? { targetBranch: proof.change.targetBranch } : {}),
    ...(proof.change.agentClaim
      ? {
          agentClaim: {
            summary: proof.change.agentClaim.summary,
            acceptanceCriteria: [...proof.change.agentClaim.acceptanceCriteria],
          },
        }
      : {}),
    baseRevision: proof.change.baseSha,
    requestedRevision: proof.change.headSha,
    ...(proof.decision ? { decision: proof.decision as ChangeVerificationDecision } : {}),
    runs: [...proof.runIds],
    evidenceCount: proof.evidenceDigests.length,
    coverageGaps: [...proof.coverageGaps],
    residualRisk: [...proof.residualRisk],
    appIds: [...new Set(proof.selection.affectedJourneys.map((journey) => journey.appMapId))],
    affectedTestCount: proof.selection.affectedJourneys.length,
    requiredVerificationCount: cells.filter((cell) => cell.requirement === "required").length,
    advisoryVerificationCount: cells.filter((cell) => cell.requirement === "advisory").length,
    updatedAt: proof.updatedAt,
  };
}

function changeTitle(proof: Proof): string {
  const claim = proof.change.agentClaim?.summary.trim();
  if (claim) return claim;
  if (proof.change.pullRequest) return `Pull request #${proof.change.pullRequest}`;
  const firstAffectedTest = proof.selection.affectedJourneys[0]?.testId;
  if (firstAffectedTest) return humanizeIdentifier(firstAffectedTest);
  const repository = proof.change.repository.split("/").filter(Boolean).at(-1) ?? "repository";
  return `Change in ${repository}`;
}

function humanizeIdentifier(value: string): string {
  const words = value
    .replaceAll(/[-_.]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return words ? `${words[0]!.toLocaleUpperCase()}${words.slice(1)}` : "Repository Change";
}

function detailsOf(value: Inspect): ProductChangeDetails {
  const targets = new Map(value.proof.selection.targetCases.map((target) => [target.id, target]));
  const builds = new Map(value.proof.builds.map((build) => [build.id, build]));
  return {
    change: changeOf(value.proof),
    history: (value.history ?? []).map(changeOf),
    publications: (
      value.publicationOutbox.map(
        (record): ProductChangePublication => ({
          id: record.id,
          status: record.status,
          provider: record.provider,
          attempts: record.attempts,
          canRetry: record.status === "retry" && record.attempts >= record.maxAttempts,
          ...(record.receipt?.htmlUrl ? { detailsUrl: record.receipt.htmlUrl } : {}),
        }),
      ) as ProductChangePublication[]
    ).concat(
      value.publications
        .filter(
          (publication) =>
            !value.publicationOutbox.some(
              (record) =>
                record.externalId === publication.externalId &&
                record.headSha === publication.headSha,
            ),
        )
        .map((publication) => ({
          // External ID is the canonical provider identity for historical receipts.
          id: publication.externalId,
          status: publication.status ?? "completed",
          provider: publication.provider,
          canRetry: false,
          ...(publication.htmlUrl ? { detailsUrl: publication.htmlUrl } : {}),
        })),
    ),
    affectedTests: value.proof.selection.affectedJourneys.map((journey) => ({
      appId: journey.appMapId,
      testId: journey.testId,
      reason: journey.reason,
      confidence: journey.confidence,
      ...(journey.appMapRevision ? { revision: journey.appMapRevision } : {}),
    })),
    verificationPlan: (value.proof.selection.cells ?? []).map((cell) => {
      const target = targets.get(cell.targetCaseId);
      const build = builds.get(cell.buildId);
      return {
        id: cell.id,
        appId: cell.journey.appMapId,
        testId: cell.journey.testId,
        targetName: target?.targetProfile.name ?? "Unavailable target",
        platform: target?.targetProfile.platform ?? "browser",
        buildName: build?.configuration ?? "Unavailable build",
        requirement: cell.requirement,
        reason: cell.selectionReason,
        dimensions: { ...cell.dimensions },
        ...(cell.estimatedDurationMs ? { estimatedDurationMs: cell.estimatedDurationMs } : {}),
        cleanupRequired: cell.cleanupRequired,
        pilot: cell.id === value.proof.selection.pilotCellId,
      };
    }),
    ...(value.proof.firstCausalFailure
      ? {
          firstFailure: {
            summary: value.proof.firstCausalFailure.summary,
            runId: value.proof.firstCausalFailure.runId,
            ...(value.proof.firstCausalFailure.testId
              ? { testId: value.proof.firstCausalFailure.testId }
              : {}),
          },
        }
      : {}),
    ...(value.proof.smallestNextVerification
      ? {
          nextVerification: {
            kind: value.proof.smallestNextVerification.kind,
            reason: value.proof.smallestNextVerification.reason,
          },
        }
      : {}),
    ...(value.repairPacket ? { repairPacket: value.repairPacket } : {}),
    planApproved: value.proof.planApproval !== undefined,
    audit: {
      policy: `${value.proof.policy.id}@${value.proof.policy.version}`,
      policyId: value.proof.policy.id,
      policyVersion: value.proof.policy.version,
      ...(value.proof.policyDigest ? { policyDigest: value.proof.policyDigest } : {}),
      ...(value.proof.planDigest ? { planDigest: value.proof.planDigest } : {}),
      ...(value.proof.decisionDigest ? { decisionDigest: value.proof.decisionDigest } : {}),
      requestedBy: value.proof.requestedBy,
      updatedBy: value.proof.updatedBy,
      buildIds: value.proof.builds.map((build) => build.id),
      proofVersion: value.proof.version,
    },
    ...(value.execution
      ? {
          execution: {
            id: value.execution.id,
            status: value.execution.status,
            completed: value.execution.cursor,
            total: value.execution.total,
            nextAction: value.execution.nextAction,
            ...(value.execution.currentCellId
              ? { currentVerificationId: value.execution.currentCellId }
              : {}),
            ...(value.execution.humanIntervention
              ? {
                  attention: {
                    kind: "human-evidence" as const,
                    reason: value.execution.humanIntervention.reason,
                    executionId: value.execution.id,
                    cellId: value.execution.humanIntervention.cellId,
                    stepId: value.execution.humanIntervention.stepId,
                  },
                }
              : value.execution.terminalUncertainty
                ? {
                    attention: {
                      kind: "uncertain" as const,
                      reason: value.execution.terminalUncertainty.reason,
                    },
                  }
                : {}),
          },
        }
      : {}),
  };
}

function reportOf(details: ProductChangeDetails): ProductChangeReport {
  const { change } = details;
  return {
    id: change.id,
    changeId: change.id,
    status: change.status,
    ...(change.decision ? { decision: change.decision } : {}),
    runIds: change.runs,
    evidenceCount: change.evidenceCount,
    publicationCount: details.publications.length,
    summary: change.decision
      ? `Change ${change.decision} with ${change.evidenceCount} evidence item${change.evidenceCount === 1 ? "" : "s"}.`
      : `Change is ${change.status}.`,
  };
}

function statusFor(
  change?: ProductChange,
  execution?: ProductChangeExecution,
): ProductChangeState["status"] {
  if (!change) return "idle";
  if (execution && ["paused-human", "uncertain"].includes(execution.status)) {
    return "needs-attention";
  }
  if (execution && ["queued", "running"].includes(execution.status)) return "running";
  if (
    [
      "proved",
      "rejected",
      "needs-review",
      "insufficient-evidence",
      "cancelled",
      "superseded",
    ].includes(change.status)
  )
    return "completed";
  return "ready";
}

export function createProductChangeJourney(input: {
  operations: RelayOperationPort;
}): ProductChangeJourney {
  const workflow = createChangeVerificationWorkflow(input.operations);
  let current: ProductChangeState = { status: "idle" };
  let selectedId: string | undefined;
  let selectedVersion: number | undefined;

  const state = () => structuredClone(current);
  const publish = (details: ProductChangeDetails): ProductChangeState => {
    selectedId = details.change.id;
    selectedVersion = details.change.version;
    current = {
      status: statusFor(details.change, details.execution),
      change: details.change,
      details,
      ...(statusFor(details.change, details.execution) === "completed"
        ? { report: reportOf(details) }
        : {}),
    };
    return state();
  };
  const fail = (error: unknown): ProductChangeState => {
    current = {
      ...current,
      status: "needs-attention",
      recovery: projectError(error),
    };
    return state();
  };
  const inspect = async (changeId: string, includeHistory = true): Promise<ProductChangeState> => {
    try {
      return publish(
        detailsOf(await workflow.inspectChangeVerification({ proofId: changeId, includeHistory })),
      );
    } catch (error) {
      return fail(error);
    }
  };
  return {
    state,
    async list(listInput = {}) {
      const result = await workflow.listChangeVerifications(listInput);
      return result.proofs.map(changeOf);
    },
    open: inspect,
    async prepare(prepareInput = {}) {
      try {
        const result = await workflow.prepareChangeVerification(prepareInput);
        return inspect(result.proof.id);
      } catch (error) {
        return fail(error);
      }
    },
    async approve(approveInput) {
      try {
        await workflow.approveVerificationPlan({ ...approveInput, proofId: approveInput.changeId });
        return inspect(approveInput.changeId);
      } catch (error) {
        return fail(error);
      }
    },
    async run(runInput) {
      try {
        const output = await input.operations.invoke("proof.run", {
          proofId: runInput.changeId,
          ...(runInput.expectedVersion === undefined
            ? {}
            : { expectedVersion: runInput.expectedVersion }),
          ...(runInput.wait === undefined ? {} : { wait: runInput.wait }),
        });
        return publish(
          detailsOf(
            await workflow.inspectChangeVerification({
              proofId: output.proof.id,
              includeHistory: false,
            }),
          ),
        );
      } catch (error) {
        return fail(error);
      }
    },
    async watch(watchInput = {}) {
      const id = selectedId;
      if (!id) return fail(new TypeError("Open a Change before watching it."));
      const pollMs = watchInput.pollMs ?? 2_000;
      while (!watchInput.signal?.aborted) {
        const next = await inspect(id, false);
        watchInput.onState?.(next);
        if (next.status !== "running") return next;
        await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
      }
      return state();
    },
    async cancel(cancelInput = {}) {
      const id = cancelInput.changeId ?? selectedId;
      const version = cancelInput.expectedVersion ?? selectedVersion;
      if (!id || !version)
        return fail(new TypeError("A Change and its current version are required."));
      try {
        await workflow.cancelChangeVerification({
          proofId: id,
          expectedVersion: version,
          reason: cancelInput.reason ?? "Cancelled by the operator.",
          confirm: true,
        });
        return inspect(id);
      } catch (error) {
        return fail(error);
      }
    },
    async report(changeId = selectedId) {
      if (!changeId) return undefined;
      const next = await inspect(changeId, false);
      return next.details ? reportOf(next.details) : undefined;
    },
    async retryPublication(retryInput) {
      try {
        await workflow.retryProofPublication({
          proofId: retryInput.changeId,
          publicationId: retryInput.publicationId,
          expectedProofVersion: retryInput.expectedVersion,
          reason: retryInput.reason,
          confirm: true,
        });
        return inspect(retryInput.changeId);
      } catch (error) {
        return fail(error);
      }
    },
    async rerunAffected(rerunInput) {
      try {
        const currentState = await inspect(rerunInput.changeId, false);
        const currentProof = currentState.details?.change;
        if (!currentProof) throw new TypeError("Open this Change before preparing a rerun.");
        const { change } = await input.operations.invoke("workspace.change.inspect", {});
        if (
          !change.readyForProof ||
          !change.repository ||
          !change.base ||
          !change.head ||
          !change.changeRef
        ) {
          throw new TypeError(
            change.blockers[0] ?? "The current workspace is not ready for verification.",
          );
        }
        if (
          change.repository !== currentProof.repository ||
          change.head.sha === currentProof.requestedRevision
        ) {
          throw new TypeError(
            "The current workspace does not contain a newer revision for this Change.",
          );
        }
        const original = currentState.details;
        const result = await workflow.rerunAffectedVerification({
          proofId: rerunInput.changeId,
          expectedVersion: rerunInput.expectedVersion,
          change: {
            repository: change.repository,
            baseSha: change.base.sha,
            headSha: change.head.sha,
            ...change.changeRef,
            previousHeadSha: currentProof.requestedRevision,
            ...(currentProof.pullRequest ? { pullRequest: currentProof.pullRequest } : {}),
            ...(currentProof.agentClaim ? { agentClaim: currentProof.agentClaim } : {}),
          },
          policy: {
            id: original.audit.policyId,
            version: original.audit.policyVersion,
          },
          coverageGaps: ["Exact replacement builds and affected Tests must be prepared."],
          residualRisk: currentProof.residualRisk,
          smallestNextVerification: {
            kind: "provide-build",
            reason: "Prepare exact replacement builds before rerunning affected Tests.",
          },
        });
        return inspect(result.replacement.id);
      } catch (error) {
        return fail(error);
      }
    },
    async resumeHumanEvidence(resumeInput) {
      try {
        await workflow.resumeHumanEvidence({
          proofId: resumeInput.changeId,
          executionId: resumeInput.executionId,
          cellId: resumeInput.cellId,
          stepId: resumeInput.stepId,
          attachment: resumeInput.attachment,
          ...(resumeInput.wait === undefined ? {} : { wait: resumeInput.wait }),
          confirm: true,
        });
        return inspect(resumeInput.changeId);
      } catch (error) {
        return fail(error);
      }
    },
  };
}

export function createProductChangeJourneyFromClient(input: {
  client: RelayInvokeClient;
}): ProductChangeJourney {
  return createProductChangeJourney({ operations: createRelayOperationPort(input.client) });
}

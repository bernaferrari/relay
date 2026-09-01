import { changeProofExecutionPreview, changeProofRequiredRunCases } from "@relay/core";
import type { VerificationPlan } from "@relay/protocol";
import { invokeOperation, type OperationInvoker } from "./invoke.js";
import { CliError, ExitCode, UsageError } from "./errors.js";
import {
  type VerifyChangeActorKind,
  type VerifyChangeNextAction,
  type VerifyChangePlanResult,
} from "./verify-change-types.js";
import { boundedText, record, verifyChangeRequestIdentity } from "./verify-change-utils.js";

const terminalProofStates = new Set([
  "proved",
  "rejected",
  "needs-review",
  "insufficient-evidence",
  "cancelled",
  "superseded",
]);
export function proofRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const proof = (value as Record<string, unknown>).proof;
  return proof && typeof proof === "object" && !Array.isArray(proof)
    ? (proof as Record<string, unknown>)
    : undefined;
}

function proofState(proof: Record<string, unknown>): string | undefined {
  return typeof proof.state === "string" ? proof.state : undefined;
}

function proofVersion(proof: Record<string, unknown>): number {
  if (
    !Number.isSafeInteger(proof.version) ||
    typeof proof.version !== "number" ||
    proof.version < 1
  ) {
    throw new UsageError("Relay returned a Proof without a positive version");
  }
  return proof.version;
}

export function isExecutableVerificationPlan(plan: VerificationPlan): boolean {
  return (
    plan.status === "ready-for-approval" &&
    plan.coverageGaps.length === 0 &&
    plan.builds.length > 0 &&
    plan.selection.affectedJourneys.length > 0 &&
    (plan.selection.cells?.some(({ requirement }) => requirement === "required") ?? false) &&
    plan.pilotCellId !== undefined
  );
}

export function assertExecutablePlanTargets(plan: VerificationPlan): void {
  for (const targetCase of plan.selection.targetCases) {
    if (targetCase.required && targetCase.executionTarget.kind === "provider-session") {
      throw new UsageError(
        `Target case ${targetCase.id} uses provider-session ${targetCase.executionTarget.provider.key}; prove only executes local-device and local-browser targets`,
      );
    }
  }
  for (const targetCase of plan.selection.targetCases.filter(({ required }) => required)) {
    const platform =
      targetCase.executionTarget.platform === "browser"
        ? "web"
        : targetCase.executionTarget.platform;
    const matchingBuilds = plan.builds.filter(
      ({ platform: buildPlatform }) => buildPlatform === platform,
    );
    if (matchingBuilds.length !== 1) {
      throw new UsageError(
        `Target case ${targetCase.id} requires exactly one frozen ${platform} build; found ${matchingBuilds.length}`,
      );
    }
  }
}

async function invokePlanApproval(
  client: OperationInvoker,
  proof: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ response: unknown; proof: Record<string, unknown> }> {
  const proofId = boundedText(proof.id, "Proof id", 256);
  const response = await invokeOperation(
    client,
    "proof.plan.approve",
    {
      proofId,
      expectedVersion: proofVersion(proof),
      decisionId: `verify-change-${proofId}-plan-approval`.slice(0, 256),
      reason:
        "Human approval of the exact Git change, builds, affected journeys, targets, and policy.",
      confirm: true,
    },
    signal,
    verifyChangeRequestIdentity("proof-approve", proofId),
  );
  const next = proofRecord(response);
  if (!next) throw new UsageError("proof.plan.approve returned no durable Proof");
  return { response, proof: next };
}

export function nextVerifyChangeAction(
  plan: VerificationPlan,
  base: string,
  configFile: string,
  proof: Record<string, unknown> | undefined,
): VerifyChangeNextAction {
  if (!proof) {
    return {
      kind: "confirm",
      reason:
        "Review the exact Git change and Verification Plan, then explicitly authorize Proof creation.",
      command: `relay prove --base ${shellArgument(base)} --config-file ${shellArgument(configFile)} --confirm`,
    };
  }
  const state = proofState(proof);
  if (state && terminalProofStates.has(state)) {
    return {
      kind: "complete",
      reason: `The durable Proof reached terminal state ${state}.`,
      ...(typeof proof.id === "string"
        ? { command: `relay proof inspect ${shellArgument(proof.id)}` }
        : {}),
    };
  }
  const proofId = typeof proof.id === "string" ? proof.id : undefined;
  const smallest =
    proof.smallestNextVerification && typeof proof.smallestNextVerification === "object"
      ? (proof.smallestNextVerification as Record<string, unknown>)
      : undefined;
  const kind = typeof smallest?.kind === "string" ? smallest.kind : undefined;
  const reason = typeof smallest?.reason === "string" ? smallest.reason : undefined;
  if (kind === "provide-build" || plan.status === "awaiting-build") {
    return {
      kind: "provide-build",
      reason: reason ?? "Provide an exact build whose source revision matches the Proof head.",
      ...(proofId ? { command: `relay proof inspect ${shellArgument(proofId)}` } : {}),
    };
  }
  if (kind === "review" || plan.status === "needs-review") {
    return {
      kind: "review",
      reason: reason ?? "Resolve every Verification Plan coverage gap before approval.",
      ...(proofId ? { command: `relay proof inspect ${shellArgument(proofId)}` } : {}),
    };
  }
  if (kind === "run-pilot") {
    return {
      kind: "run-pilot",
      reason: "The frozen Proof is approved and ready for its deterministic pilot.",
      ...(proofId ? { command: `relay proof inspect ${shellArgument(proofId)}` } : {}),
    };
  }
  return {
    kind: "approve-plan",
    reason: reason ?? "Review and approve the exact builds, journeys, targets, and policy.",
    ...(proofId ? { command: `relay proof inspect ${shellArgument(proofId)}` } : {}),
  };
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

export type VerifyChangeLiveExecution = {
  proof: Record<string, unknown>;
  proofApprovalResponse?: unknown;
  planApproved: boolean;
  pilot: VerifyChangePlanResult["execution"]["pilot"];
  runs: VerifyChangePlanResult["execution"]["runs"];
  terminalState?: string;
  nextAction?: VerifyChangeNextAction;
};

function proofRunIds(proof: Record<string, unknown>): string[] {
  if (!Array.isArray(proof.runIds) || proof.runIds.some((id) => typeof id !== "string")) {
    throw new UsageError("Relay returned a Proof without its durable Run identities");
  }
  return proof.runIds.map((id) => String(id));
}

function serverExecution(value: unknown): Record<string, unknown> {
  const response = record(value, "proof.run");
  const execution = record(response.execution, "proof.run execution");
  if (typeof execution.status !== "string") {
    throw new UsageError("proof.run returned an execution without a status");
  }
  return execution;
}

function serverExecutionReason(execution: Record<string, unknown>): string {
  const uncertainty = execution.terminalUncertainty;
  if (uncertainty && typeof uncertainty === "object" && !Array.isArray(uncertainty)) {
    const reason = (uncertainty as Record<string, unknown>).reason;
    if (typeof reason === "string" && reason.trim()) return reason;
  }
  const status = typeof execution.status === "string" ? execution.status : "unknown";
  return `The server-owned Proof coordinator returned execution status ${status}.`;
}

async function issueProofRunConfirmations(input: {
  client: OperationInvoker;
  proof: Record<string, unknown>;
  signal: AbortSignal;
  actorKind: VerifyChangeActorKind;
}): Promise<unknown[]> {
  const preview = changeProofExecutionPreview(input.proof);
  const gated = preview.cells.filter(
    ({ executionRisk }) =>
      executionRisk.level !== "safe" && executionRisk.confirmation !== "human-only",
  );
  if (!gated.length) return [];
  if (input.actorKind !== "human") {
    throw new CliError(
      "Guarded Proof Cells require an authenticated human actor to issue confirmation receipts; no target was controlled",
      ExitCode.auth,
      { proof: input.proof, preview, nextAction: "human-run-confirmation" },
    );
  }
  const selection = (input.proof as Record<string, unknown>).selection;
  const targetCases =
    selection && typeof selection === "object" && !Array.isArray(selection)
      ? (selection as Record<string, unknown>).targetCases
      : undefined;
  const receipts: unknown[] = [];
  for (const cell of gated) {
    const targetCase = Array.isArray(targetCases)
      ? targetCases.find(
          (candidate) =>
            candidate &&
            typeof candidate === "object" &&
            (candidate as Record<string, unknown>).id === cell.targetCaseId,
        )
      : undefined;
    const targetProfileId =
      targetCase && typeof targetCase === "object" && !Array.isArray(targetCase)
        ? (
            (targetCase as Record<string, unknown>).targetProfile as
              | Record<string, unknown>
              | undefined
          )?.id
        : undefined;
    const fixtureScope =
      cell.executionRisk.level === "destructive"
        ? {
            targetCaseId: cell.targetCaseId,
            targetProfileId:
              typeof targetProfileId === "string" && targetProfileId.trim()
                ? targetProfileId
                : cell.targetCaseId,
            cleanupCheckIds: cell.executionRisk.reasons.length
              ? cell.executionRisk.reasons.map(({ code }) => code)
              : [cell.cellId],
          }
        : undefined;
    const response = await invokeOperation(
      input.client,
      "proof.run.confirm",
      {
        proofId: String(input.proof.id),
        expectedVersion: Number(input.proof.version),
        cellId: cell.cellId,
        previewDigest: preview.previewDigest,
        ...(fixtureScope ? { fixtureScope } : {}),
        confirm: true,
      },
      input.signal,
      verifyChangeRequestIdentity(`proof-confirm-${cell.cellId}`, String(input.proof.id)),
    );
    const receipt = record(response, "proof.run.confirm").receipt;
    if (!receipt || typeof receipt !== "object") {
      throw new UsageError("proof.run.confirm returned no durable confirmation receipt");
    }
    receipts.push(receipt);
  }
  return receipts;
}

/** Execute an approved plan through the durable server-owned Proof coordinator.
 * The CLI performs human approval and exact per-cell receipt issuance when needed,
 * then submits one `proof.run`
 * request and projects its authoritative response. It never controls a target,
 * polls jobs, or records a client-side verdict. */
export async function executeVerifyChangeLive(input: {
  client: OperationInvoker;
  plan: VerificationPlan;
  proof: Record<string, unknown>;
  actorKind?: VerifyChangeActorKind;
  signal: AbortSignal;
}): Promise<VerifyChangeLiveExecution> {
  let currentProof = input.proof;
  if (terminalProofStates.has(proofState(currentProof) ?? "")) {
    return {
      proof: currentProof,
      planApproved: false,
      pilot: {
        available: false,
        attempted: false,
        reason: `The durable Proof was already terminal (${proofState(currentProof)}); no target was controlled.`,
      },
      runs: [],
      terminalState: proofState(currentProof),
    };
  }
  let proofApprovalResponse: unknown;
  const initialState = proofState(currentProof);
  if (initialState === "planning" || initialState === "awaiting-build") {
    if ((input.actorKind ?? "human") !== "human") {
      throw new CliError(
        "Live Proof execution requires a human actor to approve the Verification Plan; no pilot was started",
        ExitCode.auth,
        { proof: currentProof, nextAction: "human-plan-approval" },
      );
    }
    const approval = await invokePlanApproval(input.client, currentProof, input.signal);
    proofApprovalResponse = approval.response;
    currentProof = approval.proof;
  }
  if (!currentProof.planApproval) {
    throw new UsageError("Live Proof execution requires an approved frozen Verification Plan");
  }
  if (
    !["ready", "running-pilot", "awaiting-expansion", "running"].includes(
      proofState(currentProof) ?? "",
    )
  ) {
    throw new UsageError(
      `Proof state ${proofState(currentProof) ?? "unknown"} cannot resume live execution`,
    );
  }
  const requiredCases = (() => {
    try {
      return changeProofRequiredRunCases(currentProof);
    } catch (error) {
      throw new UsageError(
        `Proof has no executable required cases: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();
  if (!requiredCases.length) {
    throw new UsageError("The approved Proof has no policy-required run cases");
  }
  if (requiredCases.length > input.plan.expansion.maxCases) {
    throw new UsageError(
      `The approved Proof materializes ${requiredCases.length} Verification Cells, exceeding the plan limit of ${input.plan.expansion.maxCases}; no target was controlled`,
    );
  }
  const confirmationReceipts = await issueProofRunConfirmations({
    client: input.client,
    proof: currentProof,
    signal: input.signal,
    actorKind: input.actorKind ?? "human",
  });
  const proofId = boundedText(currentProof.id, "Proof id", 256);
  const response = await invokeOperation(
    input.client,
    "proof.run",
    {
      proofId,
      wait: true,
      ...(confirmationReceipts.length ? { confirmationReceipts } : {}),
    },
    input.signal,
    verifyChangeRequestIdentity("proof-run", proofId),
  );
  const nextProof = proofRecord(response);
  if (!nextProof) throw new UsageError("proof.run returned no durable Proof");
  currentProof = nextProof;
  const execution = serverExecution(response);
  const runIds = proofRunIds(currentProof);
  if (runIds.length > requiredCases.length) {
    throw new UsageError(
      "proof.run returned more durable Runs than its frozen required case matrix",
    );
  }
  const runSummaries = runIds.map((runId, index) => {
    const runCase = requiredCases[index];
    if (!runCase) throw new UsageError("proof.run returned an unknown required Run position");
    return {
      appMapId: runCase.appMapId,
      testId: runCase.testId,
      targetCaseId: runCase.targetCaseId,
      jobId: runId,
      runId,
    };
  });
  const pilotRun = runSummaries[0];
  const pilot: VerifyChangePlanResult["execution"]["pilot"] = pilotRun
    ? {
        available: true,
        attempted: true,
        reason:
          "The deterministic pilot was executed and recorded by the server-owned Proof coordinator.",
        targetCaseId: pilotRun.targetCaseId,
        runId: pilotRun.runId,
      }
    : {
        available: false,
        attempted: false,
        reason: serverExecutionReason(execution),
      };
  const terminalState = proofState(currentProof);
  const pausedHuman =
    execution.status === "paused-human" &&
    execution.humanIntervention &&
    typeof execution.humanIntervention === "object" &&
    !Array.isArray(execution.humanIntervention)
      ? (execution.humanIntervention as Record<string, unknown>)
      : undefined;
  return {
    proof: currentProof,
    ...(proofApprovalResponse === undefined ? {} : { proofApprovalResponse }),
    planApproved: currentProof.planApproval !== undefined,
    pilot,
    runs: runSummaries,
    ...(terminalState && terminalProofStates.has(terminalState) ? { terminalState } : {}),
    ...(pausedHuman
      ? {
          nextAction: {
            kind: "human-intervention" as const,
            reason:
              typeof pausedHuman.reason === "string"
                ? pausedHuman.reason
                : "Complete the exact human-only step and record its evidence before resuming.",
            command: `relay proof inspect ${shellArgument(proofId)}`,
          },
        }
      : {}),
  };
}

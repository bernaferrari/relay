import type http from "node:http";
import {
  ChangeProofConfirmationError,
  ChangeProofExecutionError,
  changeProofExecutionPreview,
  changeProofRequiredRunCases,
  decideChangeVerification,
  issueDurableChangeProofExecutionConfirmation,
  summarizeChangeProofExecution,
  validateChangeProofExecutionConfirmations,
  type AdvanceChangeVerificationInput,
  type ChangeProofCellExecutor,
  type ChangeVerificationScope,
  type PersistedRun,
} from "@relay/core";
import {
  changeProofCaseResultSchema,
  type ChangeVerification,
  type OperationInput,
} from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";
import type { OperationContext } from "@relay/core";
import type { ChangeVerificationRouteRuntime } from "./change-verification-routes.js";
import { createDefaultChangeProofCellExecutor } from "./change-proof-cell-executor.js";
import { changeProofExecutionRequestAuthority } from "./change-proof-request-authority.js";
import {
  proofRunRequestDigest,
  proofRequestDigest as requestDigest,
} from "./change-verification-route-intent.js";

type CaseResult = Awaited<ReturnType<ChangeVerificationRouteRuntime["caseResultFromRun"]>>;

export type ChangeProofExecutionRoutesInput = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  requestContext: RequestContext;
  scope: ChangeVerificationScope;
  runtime: ChangeVerificationRouteRuntime;
  operation?: OperationContext;
  actorId: string;
  requestId?: string;
  at: number;
  currentProof: (proofId: string) => Promise<ChangeVerification>;
  advanceProof: (
    current: ChangeVerification,
    input: Omit<AdvanceChangeVerificationInput, keyof ChangeVerificationScope | "proofId">,
  ) => Promise<ChangeVerification>;
  replayedReceipt: (
    proof: ChangeVerification,
    requestId: string,
    action: ChangeVerification["lastMutation"]["action"],
    digest: ChangeVerification["lastMutation"]["requestDigest"],
  ) => Promise<ChangeVerification["lastMutation"] | undefined>;
  publishTerminalProof: (proof: ChangeVerification) => Promise<void>;
  routeError: (error: unknown) => never;
};

function proofRunConflict(message: string, details?: Record<string, unknown>): never {
  throw new HttpError(409, message, { code: "PROOF_RUN_INVALID", ...details });
}

function runIdentity(value: { appMapId: string; testId: string; targetCaseId: string }): string {
  return `${value.appMapId}\0${value.testId}\0${value.targetCaseId}`;
}

async function projectProofRunResults(
  runtime: ChangeVerificationRouteRuntime,
  scope: ChangeVerificationScope,
  proof: ChangeVerification,
  requestedRunIds: readonly string[],
): Promise<CaseResult[]> {
  const runs: PersistedRun[] = [];
  for (const runId of requestedRunIds) {
    const run = await runtime.readRun(runId);
    if (!run) proofRunConflict(`Persisted Run ${runId} was not found`, { runId });
    if (run.id !== runId)
      proofRunConflict(`Persisted Run identity does not match ${runId}`, { runId });
    if (run.projectId !== scope.projectId) {
      proofRunConflict(`Persisted Run ${runId} belongs to another project`, { runId });
    }
    if (
      run.executionProvenance?.organizationId !== scope.organizationId ||
      run.executionProvenance.projectId !== scope.projectId
    ) {
      proofRunConflict(`Persisted Run ${runId} has no matching scoped execution provenance`, {
        runId,
      });
    }
    runs.push(run);
  }
  try {
    return await Promise.all(
      runs.map(async (run) =>
        changeProofCaseResultSchema.parse(await runtime.caseResultFromRun({ proof, run })),
      ),
    );
  } catch (error) {
    proofRunConflict(
      error instanceof Error ? error.message : "Persisted Run could not be bound to this Proof",
    );
  }
}

async function trustedProofRunResults(
  runtime: ChangeVerificationRouteRuntime,
  scope: ChangeVerificationScope,
  proof: ChangeVerification,
  requestedRunIds: readonly string[],
): Promise<CaseResult[]> {
  if (new Set(requestedRunIds).size !== requestedRunIds.length) {
    proofRunConflict("record-runs cannot contain duplicate Run ids");
  }
  const alreadyRecorded = new Set(proof.runIds);
  const duplicate = requestedRunIds.find((runId) => alreadyRecorded.has(runId));
  if (duplicate) {
    proofRunConflict(`Run ${duplicate} is already recorded on this Proof`, { runId: duplicate });
  }
  return projectProofRunResults(runtime, scope, proof, requestedRunIds);
}

function appendUnique<T>(before: readonly T[], additions: readonly T[]): T[] {
  return [...new Set([...before, ...additions])];
}

function decideTrustedProof(input: {
  proof: ChangeVerification;
  caseResults: readonly unknown[];
}): ReturnType<typeof decideChangeVerification> {
  try {
    return decideChangeVerification(input);
  } catch (error) {
    proofRunConflict(
      error instanceof Error
        ? error.message
        : "Persisted Run facts could not form a Proof decision",
    );
  }
}

export async function handleChangeProofExecutionRoutes(
  input: ChangeProofExecutionRoutesInput,
): Promise<boolean> {
  const runMatch = matchPath(input.pathname, "/proofs/:proofId/run");
  const confirmMatch = matchPath(input.pathname, "/proofs/:proofId/run/confirm");
  const humanEvidenceMatch = matchPath(input.pathname, "/proofs/:proofId/run/human-evidence");

  if (input.method === "POST" && confirmMatch) {
    if (!input.requestId) throw new HttpError(400, "Actor-aware operation context is required");
    if (input.operation?.actorKind !== "human") {
      throw new HttpError(403, "Proof confirmation receipt issuance requires a human actor");
    }
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.run.confirm">;
    const current = await input.currentProof(confirmMatch.proofId!);
    if (current.version !== body.expectedVersion) {
      throw new HttpError(409, "Proof confirmation preview is stale", {
        code: "PROOF_CONFIRMATION_DRIFT",
        currentVersion: current.version,
      });
    }
    let preview;
    try {
      preview = changeProofExecutionPreview(current);
    } catch (error) {
      throw new HttpError(
        409,
        error instanceof Error ? error.message : "Proof preview unavailable",
        { code: "PROOF_CONFIRMATION_INVALID" },
      );
    }
    if (body.previewDigest !== preview.previewDigest) {
      throw new HttpError(409, "Proof changed after the confirmation preview", {
        code: "PROOF_CONFIRMATION_DRIFT",
        previewDigest: preview.previewDigest,
      });
    }
    if (
      !current.planApproval ||
      !["ready", "running-pilot", "awaiting-expansion", "running"].includes(current.state)
    ) {
      throw new HttpError(409, "Only an approved Proof can receive a run confirmation", {
        code: "PROOF_CONFIRMATION_INVALID",
      });
    }
    try {
      const receipt = await issueDurableChangeProofExecutionConfirmation({
        proof: current,
        cellId: body.cellId,
        actorId: input.actorId,
        actorKind: input.operation.actorKind,
        ...(body.ttlMs === undefined ? {} : { ttlMs: body.ttlMs }),
        ...(body.fixtureScope ? { fixtureScope: body.fixtureScope } : {}),
        now: input.at,
      });
      recordAudit(input.requestContext, {
        action: "proof.run.confirmation.issue",
        resource: current.id,
        target: receipt.receiptId,
        result: "allow",
      });
      json(input.response, 201, { proofId: current.id, preview, receipt });
    } catch (error) {
      if (error instanceof ChangeProofConfirmationError) {
        recordAudit(input.requestContext, {
          action: "proof.run.confirmation.issue",
          resource: current.id,
          result: "deny",
        });
      }
      input.routeError(error);
    }
    return true;
  }

  if (input.method === "POST" && humanEvidenceMatch) {
    if (!input.requestId) throw new HttpError(400, "Actor-aware operation context is required");
    if (input.operation?.actorKind !== "human") {
      throw new HttpError(403, "Human intervention evidence requires a human actor");
    }
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.run.human-evidence">;
    const current = await input.currentProof(humanEvidenceMatch.proofId!);
    const existing = await input.runtime.executionCoordinator.read(input.scope, current.id);
    if (!existing) {
      throw new HttpError(409, "The Proof has no durable execution to resume", {
        code: "PROOF_EXECUTION_HUMAN_INTERVENTION",
      });
    }
    const authority = existing.requestAuthority;
    if (!authority) {
      throw new HttpError(409, "The paused Proof has no durable request authority", {
        code: "PROOF_EXECUTION_HUMAN_INTERVENTION",
        recovery: "Re-admit this Proof with explicit proof.run authority before resuming it.",
      });
    }
    if (!input.runtime.supportsHumanInterventionResume || !input.runtime.executeCell) {
      throw new HttpError(
        409,
        "The canonical App Map Test executor cannot resume the exact human-only step; the Proof remains paused",
        {
          code: "PROOF_EXECUTION_HUMAN_INTERVENTION",
          recovery:
            "Provide an exact step-resume executor with durable evidence, then retry this operation.",
        },
      );
    }
    let execution;
    try {
      execution = await input.runtime.executionCoordinator.recordHumanInterventionEvidence({
        ...input.scope,
        proofId: current.id,
        executionId: body.executionId,
        cellId: body.cellId,
        stepId: body.stepId,
        evidenceDigest: body.evidenceDigest as `sha256:${string}`,
        actorId: input.actorId,
        requestId: input.requestId,
        at: input.at,
      });
    } catch (error) {
      if (error instanceof ChangeProofExecutionError) {
        recordAudit(input.requestContext, {
          action: "proof.run.human-evidence",
          resource: current.id,
          target: body.executionId,
          result: "deny",
        });
      }
      input.routeError(error);
    }
    const execute = input.runtime.executeCell;
    const resumedProof = await input.currentProof(current.id);
    const runInput = {
      ...input.scope,
      proof: resumedProof,
      requestId: existing.requestId,
      requestDigest: existing.requestDigest,
      actorId: existing.actorId,
      authority: "confirmed" as const,
      requestAuthority: authority,
    };
    if (body.wait) {
      execution = await input.runtime.executionCoordinator.run(runInput, execute);
    } else {
      void input.runtime.executionCoordinator.run(runInput, execute).catch(() => undefined);
    }
    const proof = await input.currentProof(current.id);
    recordAudit(input.requestContext, {
      action: "proof.run.human-evidence",
      resource: proof.id,
      target: execution.humanInterventionEvidence?.at(-1)?.requestId ?? input.requestId,
      result: "allow",
    });
    json(input.response, body.wait ? 200 : 202, {
      proof,
      execution: summarizeChangeProofExecution(execution),
      evidence: execution.humanInterventionEvidence!.at(-1),
    });
    return true;
  }

  if (input.method === "POST" && runMatch) {
    if (!input.requestId) throw new HttpError(400, "Actor-aware operation context is required");
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.run">;
    const current = await input.currentProof(runMatch.proofId!);
    const digest = proofRunRequestDigest(current.id, body);
    const operationContext = input.operation;
    const requestAuthority = changeProofExecutionRequestAuthority(
      input.requestContext,
      operationContext,
    );
    const existingExecution = await input.runtime.executionCoordinator.read(
      input.scope,
      current.id,
    );
    let confirmationReceipts;
    try {
      confirmationReceipts =
        existingExecution && !body.confirmationReceipts?.length
          ? []
          : validateChangeProofExecutionConfirmations({
              proof: existingExecution?.frozenProof ?? current,
              receipts: body.confirmationReceipts,
              actorId: input.actorId,
              now: input.at,
            });
    } catch (error) {
      if (error instanceof ChangeProofConfirmationError) {
        recordAudit(input.requestContext, {
          action: "proof.run.confirmation",
          resource: current.id,
          ...(body.confirmationReceipts?.[0]?.receiptId
            ? { target: body.confirmationReceipts[0].receiptId }
            : {}),
          result: "deny",
        });
      }
      input.routeError(error);
    }
    let execution;
    try {
      execution = await input.runtime.executionCoordinator.submit({
        ...input.scope,
        proof: current,
        requestId: input.requestId,
        requestDigest: digest,
        actorId: input.actorId,
        authority: "confirmed",
        requestAuthority,
        ...(confirmationReceipts.length ? { confirmationReceipts } : {}),
        ...(body.expectedVersion === undefined ? {} : { expectedVersion: body.expectedVersion }),
      });
    } catch (error) {
      if (error instanceof ChangeProofConfirmationError) {
        recordAudit(input.requestContext, {
          action: "proof.run.confirmation",
          resource: current.id,
          ...(body.confirmationReceipts?.[0]?.receiptId
            ? { target: body.confirmationReceipts[0].receiptId }
            : {}),
          result: "deny",
        });
      }
      input.routeError(error);
    }
    const execute: ChangeProofCellExecutor =
      input.runtime.executeCell ?? createDefaultChangeProofCellExecutor(input.requestContext);
    if (execute) {
      const admittedProof = await input.currentProof(current.id);
      const runInput = {
        ...input.scope,
        proof: admittedProof,
        requestId: input.requestId,
        requestDigest: digest,
        actorId: input.actorId,
        authority: "confirmed" as const,
        requestAuthority,
      };
      if (body.wait) {
        execution = await input.runtime.executionCoordinator.run(runInput, execute);
      } else {
        void input.runtime.executionCoordinator.run(runInput, execute).catch(() => undefined);
      }
    }
    const proof = await input.currentProof(current.id);
    recordAudit(input.requestContext, { action: "proof.run", resource: proof.id, result: "allow" });
    if (confirmationReceipts.length) {
      recordAudit(input.requestContext, {
        action: "proof.run.confirmation",
        resource: proof.id,
        target: confirmationReceipts.map((receipt) => receipt.receiptId).join(","),
        result: "allow",
      });
    }
    json(input.response, body.wait ? 200 : 202, {
      proof,
      execution: summarizeChangeProofExecution(execution),
    });
    return true;
  }

  const continueMatch = matchPath(input.pathname, "/proofs/:proofId/continue");
  if (input.method === "POST" && continueMatch) {
    if (!input.requestId) throw new HttpError(400, "Actor-aware operation context is required");
    const body = (await parseJsonBody(input.request)) as OperationInput<"proof.continue">;
    const current = await input.currentProof(continueMatch.proofId!);
    const digest = requestDigest(current.id, body);
    const replay = await input.replayedReceipt(current, input.requestId, body.action, digest);
    if (replay) {
      await input.publishTerminalProof(current);
      json(input.response, 200, { proof: current, receipt: replay });
      return true;
    }
    const common = {
      expectedVersion: body.expectedVersion,
      actorId: input.actorId,
      requestId: input.requestId,
      requestDigest: digest,
      action: body.action,
      at: input.at,
    } as const;
    let proof: ChangeVerification;
    if (body.action === "start-pilot") {
      if (current.state !== "ready" || !current.planApproval) {
        throw new HttpError(409, "Only an approved ready Proof can start its pilot", {
          code: "PROOF_EXECUTION_NOT_READY",
        });
      }
      try {
        changeProofRequiredRunCases(current);
      } catch (error) {
        throw new HttpError(
          409,
          error instanceof Error ? error.message : "Proof has no executable required cases",
          { code: "PROOF_EXECUTION_NOT_READY" },
        );
      }
      proof = await input.advanceProof(current, {
        ...common,
        state: "running-pilot",
        smallestNextVerification: {
          kind: "run-pilot",
          reason: body.reason ?? "Run the first deterministic Verification Plan pilot case.",
        },
      });
    } else if (body.action === "start-required-coverage") {
      if (current.state !== "awaiting-expansion") {
        throw new HttpError(409, "Required coverage can start only after a passing pilot", {
          code: "PROOF_EXPANSION_NOT_READY",
        });
      }
      let requiredCases: ReturnType<typeof changeProofRequiredRunCases>;
      try {
        requiredCases = changeProofRequiredRunCases(current);
      } catch (error) {
        throw new HttpError(
          409,
          error instanceof Error ? error.message : "Proof has no executable required cases",
          { code: "PROOF_EXPANSION_NOT_READY" },
        );
      }
      if (current.runIds.length >= requiredCases.length) {
        throw new HttpError(409, "Proof has no remaining required coverage to start", {
          code: "PROOF_EXPANSION_COMPLETE",
        });
      }
      proof = await input.advanceProof(current, {
        ...common,
        state: "running",
        smallestNextVerification: {
          kind: "expand",
          reason: body.reason ?? "Run the remaining policy-required Verification Plan cases.",
        },
      });
    } else if (body.action === "record-runs") {
      if (current.state !== "running-pilot" && current.state !== "running") {
        throw new HttpError(409, "Runs can be recorded only while a Proof is executing", {
          code: "PROOF_EXECUTION_NOT_RUNNING",
        });
      }
      const runIds = body.runIds!;
      if (current.state === "running-pilot" && runIds.length !== 1) {
        throw new HttpError(409, "The pilot must record exactly one completed Run", {
          code: "PROOF_PILOT_RUN_REQUIRED",
        });
      }
      const newResults = await trustedProofRunResults(input.runtime, input.scope, current, runIds);
      const allResults =
        current.state === "running"
          ? [
              ...(current.runIds.length
                ? await projectProofRunResults(input.runtime, input.scope, current, current.runIds)
                : []),
              ...newResults,
            ]
          : newResults;
      const appendedRunIds = appendUnique(current.runIds, runIds);
      const appendedEvidence = appendUnique(
        current.evidenceDigests,
        newResults.flatMap(({ evidenceDigests }) => evidenceDigests),
      );
      if (current.state === "running-pilot") {
        const pilot = newResults[0]!;
        const pilotCase = changeProofRequiredRunCases(current)[0];
        if (
          !pilotCase ||
          runIdentity(pilot) !==
            runIdentity({
              appMapId: pilotCase.appMapId,
              testId: pilotCase.testId,
              targetCaseId: pilotCase.targetCaseId,
            })
        ) {
          throw new HttpError(409, "Recorded Run is not the deterministic Proof pilot", {
            code: "PROOF_PILOT_RUN_MISMATCH",
          });
        }
        const requiredCases = changeProofRequiredRunCases(current);
        if (pilot.outcome === "passed" && requiredCases.length > 1) {
          proof = await input.advanceProof(current, {
            ...common,
            state: "awaiting-expansion",
            action: "record-runs",
            runIds: appendedRunIds,
            evidenceDigests: appendedEvidence,
            smallestNextVerification: {
              kind: "expand",
              reason: "The pilot passed; run the smallest remaining required coverage.",
            },
          });
        } else {
          const decision = decideTrustedProof({ proof: current, caseResults: allResults });
          proof = await input.advanceProof(current, {
            ...common,
            state: decision.state,
            action: "record-runs",
            runIds: appendedRunIds,
            evidenceDigests: appendedEvidence,
            firstCausalFailure: decision.firstCausalFailure ?? null,
            coverageGaps: decision.coverageGaps,
            residualRisk: decision.residualRisk,
            smallestNextVerification: decision.smallestNextVerification,
          });
        }
      } else {
        const decision = decideTrustedProof({ proof: current, caseResults: allResults });
        const partial =
          decision.decision === "insufficient-evidence" &&
          decision.summary.insufficient === 0 &&
          decision.summary.missing > 0;
        proof = await input.advanceProof(current, {
          ...common,
          state: partial ? "running" : decision.state,
          action: "record-runs",
          runIds: appendedRunIds,
          evidenceDigests: appendedEvidence,
          firstCausalFailure: decision.firstCausalFailure ?? null,
          coverageGaps: partial ? current.coverageGaps : decision.coverageGaps,
          residualRisk: decision.residualRisk,
          smallestNextVerification: partial
            ? {
                kind: "expand",
                reason: "Continue with the smallest missing required Verification case.",
                ...(decision.smallestNextVerification.appMapId
                  ? { appMapId: decision.smallestNextVerification.appMapId }
                  : {}),
                ...(decision.smallestNextVerification.testId
                  ? { testId: decision.smallestNextVerification.testId }
                  : {}),
                ...(decision.smallestNextVerification.targetCaseId
                  ? { targetCaseId: decision.smallestNextVerification.targetCaseId }
                  : {}),
              }
            : decision.smallestNextVerification,
        });
      }
    } else {
      if (["running-pilot", "awaiting-expansion", "running"].includes(current.state)) {
        throw new HttpError(409, "Cancel the active Proof execution before changing its plan", {
          code: "PROOF_EXECUTION_ACTIVE",
        });
      }
      proof =
        body.action === "revise-plan"
          ? await input.advanceProof(current, {
              ...common,
              state: body.builds!.length ? "planning" : "awaiting-build",
              builds: body.builds!,
              selection: body.selection!,
              planApproval: null,
              coverageGaps: body.coverageGaps,
              residualRisk: body.residualRisk,
              smallestNextVerification: body.smallestNextVerification ?? {
                kind: body.builds!.length ? "approve-plan" : "provide-build",
                reason: body.builds!.length
                  ? "Review and approve the revised Verification Plan."
                  : "Provide an exact build for the current head.",
              },
            })
          : body.action === "request-plan-review"
            ? await input.advanceProof(current, {
                ...common,
                state: "needs-review",
                smallestNextVerification: { kind: "review", reason: body.reason! },
              })
            : await input.advanceProof(current, {
                ...common,
                state: current.builds.length ? "planning" : "awaiting-build",
                planApproval: null,
                smallestNextVerification: {
                  kind: current.builds.length ? "approve-plan" : "provide-build",
                  reason: body.reason!,
                },
              });
    }
    await input.publishTerminalProof(proof);
    recordAudit(input.requestContext, {
      action: "proof.continue",
      resource: proof.id,
      result: "allow",
    });
    json(input.response, 200, { proof, receipt: proof.lastMutation });
    return true;
  }

  return false;
}

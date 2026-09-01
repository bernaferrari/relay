import { Readable } from "node:stream";
import type http from "node:http";
import {
  cancelJob,
  currentOperationContext,
  confirmationReceiptForCell,
  readPersistedRun,
  runWithOperationContext,
  waitForJobCompletion,
  frozenCellExecutionRisk,
  type ChangeProofCellExecutor,
  type ChangeProofExecutionRecord,
} from "@relay/core";
import { changeTestedSha, type OperationInput } from "@relay/protocol";
import type { RequestContext } from "./security.js";
import { handleAppMapRunRoute } from "./app-map-run-routes.js";

/** Build the exact one-cell App Map Test request from the frozen Proof plan.
 * Both browser deployments and device builds retain the registered build
 * identity. Browser entries are provider-verified deployments and are admitted
 * through their exact digest without entering mobile APK/IPA preflight. */
export function changeProofCellRunInput(
  execution: Pick<
    ChangeProofExecutionRecord,
    "frozenProof" | "confirmationReceipts" | "humanInterventionEvidence"
  >,
  cell: {
    cellId: string;
    appMapId: string;
    testId: string;
    appMapRevision: number;
    targetCaseId: string;
    buildId: string;
  },
): OperationInput<"app-map.test.run"> {
  const targetCase = execution.frozenProof.selection.targetCases.find(
    (candidate) => candidate.id === cell.targetCaseId,
  );
  const build = execution.frozenProof.builds.find((candidate) => candidate.id === cell.buildId);
  if (!targetCase || !build) {
    throw new Error(
      `Proof cell ${cell.appMapId}/${cell.testId} does not bind a frozen target and build`,
    );
  }
  const verificationCell = execution.frozenProof.selection.cells?.find(
    (candidate) => candidate.id === cell.cellId,
  );
  if (!verificationCell) {
    throw new Error(`Proof cell ${cell.cellId} is absent from the frozen Verification Plan`);
  }
  const executionRisk = frozenCellExecutionRisk(verificationCell);
  if (executionRisk.level === "prohibited") {
    throw new Error(`Verification Cell ${cell.cellId} is prohibited and cannot be executed`);
  }
  if (executionRisk.confirmation === "human-only") {
    throw new Error(
      `Verification Cell ${cell.cellId} requires an exact human-only evidence boundary; the canonical App Map Test executor cannot resume at that step`,
    );
  }
  if (
    (executionRisk.level !== "safe" || executionRisk.confirmation !== "none") &&
    !execution.confirmationReceipts?.some((receipt) => receipt.scope.cellId === cell.cellId)
  ) {
    throw new Error(`Verification Cell ${cell.cellId} requires an exact confirmation receipt`);
  }
  const repeatDimensions = Object.fromEntries(
    Object.entries(verificationCell.dimensions).filter(
      ([dimension, value]) => targetCase.dimensions[dimension] !== value,
    ),
  );
  const repeat = Object.keys(repeatDimensions).length
    ? {
        in: Object.fromEntries(
          Object.entries(repeatDimensions).map(([dimension, value]) => [dimension, [value]]),
        ),
        pilotCase: repeatDimensions,
      }
    : {};
  const platform = targetCase.executionTarget.platform;
  const target = {
    kind: platform === "browser" ? ("browser" as const) : ("device" as const),
    platform,
    targetId: targetCase.executionTarget.targetId,
  };
  const sourceRevision = {
    vcs: "git" as const,
    sha: changeTestedSha(execution.frozenProof.change),
    artifactDigest: build.artifactDigest,
    buildId: build.id,
  };
  return {
    appMapId: cell.appMapId,
    testId: cell.testId,
    expectedRevision: cell.appMapRevision,
    target,
    targetProfileId: targetCase.targetProfile.id,
    executionMode: "pilot",
    ...repeat,
    sourceRevision,
  } as OperationInput<"app-map.test.run">;
}

/**
 * Adapt the durable Proof cell seam to the one canonical App Map Test route.
 * The adapter intentionally owns no compile, target, or session behavior: it
 * submits the exact frozen cell through handleAppMapRunRoute, then waits for
 * the existing durable session lifecycle to publish its immutable Run.
 */
export function createDefaultChangeProofCellExecutor(
  scope: RequestContext,
): ChangeProofCellExecutor {
  return async ({ execution, cell }) => {
    const body = changeProofCellRunInput(execution, cell);
    const verificationCell = execution.frozenProof.selection.cells?.find(
      (candidate) => candidate.id === cell.cellId,
    );
    if (!verificationCell) {
      throw new Error(`Proof cell ${cell.cellId} is absent from the frozen Verification Plan`);
    }
    const confirmationReceipt = confirmationReceiptForCell(
      execution.confirmationReceipts,
      cell.cellId,
    );
    const humanInterventionEvidence = execution.humanInterventionEvidence?.find(
      (item) =>
        item.cellId === cell.cellId &&
        item.stepId ===
          verificationCell.executionRisk?.reasons.find((reason) => reason.stepId)?.stepId,
    );
    const build = execution.frozenProof.builds.find((candidate) => candidate.id === cell.buildId);
    if (!build) {
      throw new Error(`Proof cell ${cell.cellId} is absent from the frozen build matrix`);
    }
    const outer = currentOperationContext();
    const requestId = `${execution.requestId}:${cell.cellId}`;
    const operation = {
      schemaVersion: 1 as const,
      actorId: execution.actorId,
      actorKind: execution.requestAuthority?.actorKind ?? outer?.actorKind ?? ("agent" as const),
      organizationId: execution.organizationId,
      projectId: execution.projectId,
      operationId: "app-map.test.run",
      requestId,
      idempotencyKey: requestId,
      issuedAt: Date.now(),
      ...(outer?.causationId ? { causationId: outer.causationId } : {}),
      ...(outer?.correlationId ? { correlationId: outer.correlationId } : {}),
      ...(outer?.leaseId ? { leaseId: outer.leaseId, leaseOwnerId: outer.leaseOwnerId } : {}),
    };
    // The shared HTTP body reader accepts transport byte chunks. Feeding it a
    // JavaScript string works in a basic stream but crashes Buffer.concat at
    // the canonical route boundary, which would take down the server after
    // Proof admission and leave the durable cell waiting for reconciliation.
    const request = Readable.from([
      Buffer.from(JSON.stringify(body), "utf8"),
    ]) as unknown as http.IncomingMessage;
    request.url = `/app-maps/${encodeURIComponent(cell.appMapId)}/tests/${encodeURIComponent(cell.testId)}/run`;
    request.headers = {};
    let responsePayload: string | undefined;
    const response = {
      writeHead() {
        return this;
      },
      end(value?: string | Uint8Array) {
        responsePayload = value === undefined ? "" : String(value);
      },
    } as unknown as http.ServerResponse;

    await runWithOperationContext(operation, async () => {
      const handled = await handleAppMapRunRoute({
        method: "POST",
        pathname: `/app-maps/${cell.appMapId}/tests/${cell.testId}/run`,
        request,
        response,
        scope,
        proofExecutionAuthority: {
          executionRiskDigest: verificationCell.executionRiskDigest!,
          evidencePolicyDigest: verificationCell.evidencePolicyDigest!,
          buildId: build.id,
          sourceSha: build.sourceSha,
          artifactDigest: build.artifactDigest,
          ...(confirmationReceipt ? { confirmationReceipt } : {}),
          ...(humanInterventionEvidence
            ? { humanInterventionEvidence: structuredClone(humanInterventionEvidence) }
            : {}),
        },
      });
      if (!handled || !responsePayload) {
        throw new Error(`Canonical App Map Test route did not enqueue Proof cell ${cell.cellId}`);
      }
    });

    const payload = responsePayload;
    if (!payload)
      throw new Error(`Canonical App Map Test route returned no response for ${cell.cellId}`);
    const output = JSON.parse(payload) as {
      job?: { id?: unknown };
    };
    const runId = output.job?.id;
    if (typeof runId !== "string" || !runId.trim()) {
      throw new Error(`Canonical App Map Test route returned no durable Run for ${cell.cellId}`);
    }
    return {
      runId,
      wait: async () => {
        await waitForJobCompletion(runId);
        const persisted = await readPersistedRun(runId);
        if (!persisted) throw new Error(`Run ${runId} did not publish a durable manifest`);
        return persisted;
      },
      cancel: () => {
        cancelJob(runId);
      },
    };
  };
}

/** Reconstruct only the authority admitted with the durable Proof. Legacy
 * records intentionally fail closed instead of being upgraded to the local
 * server's trust mode after restart. */
export function recoveredChangeProofExecutionAuthority(
  execution: ChangeProofExecutionRecord,
  issuedAt: number,
): { scope: RequestContext; operation: NonNullable<ReturnType<typeof currentOperationContext>> } {
  const authority = execution.requestAuthority;
  if (!authority) {
    throw new Error(
      "Proof execution predates durable request authority; explicit proof.run re-admission is required",
    );
  }
  return {
    scope: {
      subject: authority.subject,
      organizationId: execution.organizationId,
      projectId: execution.projectId,
      allowedProjects: [...authority.allowedProjects],
      tokenKind: authority.tokenKind,
      localTrusted: authority.localTrusted,
      role: authority.role,
      ...(authority.externalActorKind ? { externalActorKind: authority.externalActorKind } : {}),
    },
    operation: {
      schemaVersion: 1,
      actorId: execution.actorId,
      actorKind: authority.actorKind,
      organizationId: execution.organizationId,
      projectId: execution.projectId,
      operationId: "proof.run.recover",
      requestId: `${execution.requestId}:recover`,
      idempotencyKey: execution.requestId,
      issuedAt,
      ...(authority.leaseId
        ? {
            leaseId: authority.leaseId,
            ...(authority.leaseOwnerId ? { leaseOwnerId: authority.leaseOwnerId } : {}),
          }
        : {}),
    },
  };
}

export async function executeRecoveredChangeProofCell(
  input: Parameters<ChangeProofCellExecutor>[0],
  issuedAt: number,
) {
  const recovered = recoveredChangeProofExecutionAuthority(input.execution, issuedAt);
  const execute = createDefaultChangeProofCellExecutor(recovered.scope);
  return runWithOperationContext(recovered.operation, () => execute(input));
}

import { Readable } from "node:stream";
import type http from "node:http";
import {
  cancelJob,
  currentOperationContext,
  readPersistedRun,
  runWithOperationContext,
  waitForJobCompletion,
  type ChangeProofCellExecutor,
  type ChangeProofExecutionRecord,
} from "@relay/core";
import { changeTestedSha, type OperationInput } from "@relay/protocol";
import type { RequestContext } from "./security.js";
import { handleAppMapRunRoute } from "./app-map-run-routes.js";

/** Build the exact one-cell App Map Test request from the frozen Proof plan.
 * Browser deployments deliberately omit buildId because the canonical route
 * requires a provider-verified deployment identity there; device runs retain
 * the registered build identity for installed-build provenance. */
export function changeProofCellRunInput(
  execution: Pick<ChangeProofExecutionRecord, "frozenProof">,
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
    ...(platform === "browser" ? {} : { buildId: build.id }),
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
    const outer = currentOperationContext();
    const requestId = `${execution.requestId}:${cell.cellId}`;
    const operation = {
      schemaVersion: 1 as const,
      actorId: execution.actorId,
      actorKind: outer?.actorKind ?? ("agent" as const),
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

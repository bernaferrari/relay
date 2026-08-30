import {
  changeProofExecutionSummarySchema,
  type ChangeProofExecutionCancellation,
  type ChangeProofExecutionSummary,
} from "@relay/protocol";
import { parseChangeVerification } from "@relay/protocol";
import {
  advanceChangeVerification,
  readChangeVerification,
  type ChangeVerificationScope,
} from "./change-verification-store.js";
import { changeProofRequiredRunCases } from "./change-proof-live-run.js";
import { changeProofCaseResultFromPersistedRun } from "./change-proof-live-run.js";
import { readPersistedRun, type PersistedRun } from "./runs.js";
import { readControlStore, withControlStore } from "./collaboration-store.js";
import { canonicalSha256 } from "./canonical-json.js";
import {
  CHANGE_PROOF_EXECUTION_SCHEMA_VERSION,
  DEFAULT_CHANGE_PROOF_EXECUTION_DURATION_MS,
  DEFAULT_CHANGE_PROOF_EXECUTION_LEASE_MS,
  ChangeProofExecutionError,
  type ChangeProofCellExecutor,
  type ChangeProofExecutionCoordinatorOptions,
  type ChangeProofExecutionRecord,
  type ChangeProofExecutionSubmitInput,
} from "./change-proof-execution-types.js";
import {
  clone,
  executionId,
  mutationDigest,
  nonEmpty,
  normalizeRecord,
  readExecution,
  requestDigest,
} from "./change-proof-execution-store.js";
import {
  reconcileClaimedRecord,
  runOne,
  type ChangeProofExecutionRunOptions,
} from "./change-proof-execution-runner.js";

export {
  CHANGE_PROOF_EXECUTION_SCHEMA_VERSION,
  DEFAULT_CHANGE_PROOF_EXECUTION_DURATION_MS,
  DEFAULT_CHANGE_PROOF_EXECUTION_LEASE_MS,
  ChangeProofExecutionError,
} from "./change-proof-execution-types.js";
export type {
  ChangeProofCellDispatch,
  ChangeProofCellExecutor,
  ChangeProofExecutionCell,
  ChangeProofExecutionCoordinatorOptions,
  ChangeProofExecutionLease,
  ChangeProofExecutionRecord,
  ChangeProofExecutionSubmitInput,
} from "./change-proof-execution-types.js";

function nextAction(record: ChangeProofExecutionRecord): ChangeProofExecutionSummary["nextAction"] {
  if (record.status === "completed") return "complete";
  if (record.status === "cancelled") return "cancelled";
  if (record.status === "uncertain") return "reconcile";
  const current = record.cells[record.cursor];
  if (current?.status === "dispatching" || current?.status === "running") return "reconcile";
  return record.cursor === 0 ? "run-pilot" : "run-required-coverage";
}

export function summarizeChangeProofExecution(
  record: ChangeProofExecutionRecord,
): ChangeProofExecutionSummary {
  const current = record.cells[record.cursor];
  return changeProofExecutionSummarySchema.parse({
    id: record.id,
    proofId: record.proofId,
    status: record.status,
    cursor: record.cursor,
    total: record.total,
    ...(current && ["pending", "dispatching", "running"].includes(current.status)
      ? { currentCellId: current.cell.cellId }
      : {}),
    runIds: record.runIds,
    deadlineAt: record.deadlineAt,
    nextAction: nextAction(record),
    ...(record.cancellation ? { cancellation: record.cancellation } : {}),
    ...(record.terminalUncertainty ? { terminalUncertainty: record.terminalUncertainty } : {}),
  });
}

async function ensureStarted(
  input: ChangeProofExecutionSubmitInput,
  options: Required<Pick<ChangeProofExecutionCoordinatorOptions, "now" | "maxDurationMs">> &
    Pick<ChangeProofExecutionCoordinatorOptions, "publication">,
): Promise<ChangeProofExecutionRecord> {
  nonEmpty(input.requestId, "requestId");
  requestDigest(input.requestDigest);
  const proof = parseChangeVerification(input.proof);
  if (proof.organizationId !== input.organizationId || proof.projectId !== input.projectId) {
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_CONFLICT",
      "Proof scope does not match execution scope",
    );
  }
  if (input.authority !== "confirmed")
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_NOT_READY",
      "Proof execution requires confirmed authority",
    );
  const current = await readChangeVerification(
    { organizationId: input.organizationId, projectId: input.projectId },
    proof.id,
  );
  if (!current)
    throw new ChangeProofExecutionError("PROOF_EXECUTION_NOT_FOUND", "Proof was not found");
  const existing = await readExecution(input, proof.id);
  if (existing) {
    if (existing.requestId === input.requestId && existing.requestDigest !== input.requestDigest) {
      throw new ChangeProofExecutionError(
        "PROOF_EXECUTION_CONFLICT",
        "Proof request id is already bound to another execution intent",
      );
    }
    return existing;
  }
  // A retry resumes the durable execution even after the Proof has advanced
  // through one or more cells. Check the optimistic version only while
  // admitting a brand-new execution; otherwise a detached request could not
  // be reattached with its original expectedVersion.
  if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
    throw new ChangeProofExecutionError("PROOF_EXECUTION_CONFLICT", "Proof version is stale");
  }
  if (
    !current.planApproval ||
    !["ready", "running-pilot", "awaiting-expansion", "running"].includes(current.state)
  ) {
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_NOT_READY",
      "Only an approved Proof can be run",
    );
  }
  const cases = changeProofRequiredRunCases(current);
  if (!cases.length)
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_NOT_READY",
      "Proof has no executable Verification Cells",
    );
  const at = options.now();
  const id = executionId(input, current.id);
  const base: ChangeProofExecutionRecord = {
    schemaVersion: CHANGE_PROOF_EXECUTION_SCHEMA_VERSION,
    id,
    organizationId: current.organizationId,
    projectId: current.projectId,
    proofId: current.id,
    proofVersion: current.version,
    requestId: input.requestId,
    requestDigest: input.requestDigest,
    actorId: input.actorId,
    authority: "confirmed",
    ...((input.publication ?? options.publication)
      ? { publication: input.publication ?? options.publication }
      : {}),
    frozenProof: clone(current),
    cells: cases.map((cell) => ({ cell, status: "pending", updatedAt: at })),
    cursor: current.runIds.length,
    total: cases.length,
    deadlineAt: at + options.maxDurationMs,
    status: "queued",
    runIds: [...current.runIds],
    createdAt: at,
    updatedAt: at,
  };
  if (base.cursor > base.total)
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_CONFLICT",
      "Proof has more Runs than frozen cells",
    );
  // Start-pilot is the only Proof mutation admitted by this operation. A
  // restart can reconstruct the queued coordinator from the running-pilot
  // Proof if the process stopped between these two durable writes.
  if (current.state === "ready") {
    try {
      await advanceChangeVerification({
        organizationId: current.organizationId,
        projectId: current.projectId,
        proofId: current.id,
        expectedVersion: current.version,
        state: "running-pilot",
        actorId: input.actorId,
        requestId: `${id}:start-pilot`,
        requestDigest: mutationDigest(base, "start-pilot", at),
        action: "start-pilot",
        at,
        smallestNextVerification: {
          kind: "run-pilot",
          reason: "The durable Proof coordinator is running its deterministic pilot.",
        },
      });
    } catch (error) {
      // Two retried proof.run requests can observe the same ready version.
      // If another admission won the Proof transition, continue to the
      // unique execution insert instead of reporting a false stale request.
      const latest = await readChangeVerification(input, proof.id);
      if (!latest || latest.state !== "running-pilot") throw error;
    }
  }
  return withControlStore((store) => {
    const existingRecord = store.changeProofExecutionByProof(
      current.organizationId,
      current.projectId,
      current.id,
    );
    if (existingRecord) return normalizeRecord(existingRecord);
    if (!store.insertChangeProofExecution(base)) {
      throw new ChangeProofExecutionError(
        "PROOF_EXECUTION_CONFLICT",
        "Execution admission raced another coordinator",
      );
    }
    return clone(base);
  });
}

export function createChangeProofExecutionCoordinator(
  configured: ChangeProofExecutionCoordinatorOptions = {},
): ChangeProofExecutionCoordinator {
  const now = configured.now ?? Date.now;
  const workerId = configured.workerId ?? `relay-proof-execution:${process.pid}`;
  const leaseMs = configured.leaseMs ?? DEFAULT_CHANGE_PROOF_EXECUTION_LEASE_MS;
  const maxDurationMs = configured.maxDurationMs ?? DEFAULT_CHANGE_PROOF_EXECUTION_DURATION_MS;
  const readRun = configured.readRun ?? readPersistedRun;
  const projectRun = configured.projectRun ?? changeProofCaseResultFromPersistedRun;
  const active = new Set<string>();
  const activeDispatches = new Map<string, { cancel?: () => Promise<void> | void }>();

  return {
    async submit(input) {
      return ensureStarted(input, { now, maxDurationMs, publication: configured.publication });
    },
    async read(scope, proofId) {
      return readExecution(scope, proofId);
    },
    async cancel(input) {
      const existing = await readExecution(input, input.proofId);
      if (!existing) return undefined;
      if (["completed", "cancelled", "uncertain"].includes(existing.status)) return existing;
      const at = input.at ?? now();
      const cancellation = {
        reason: input.reason,
        cancelledBy: input.actorId,
        cancelledAt: at,
      } satisfies ChangeProofExecutionCancellation;
      const updated = await withControlStore((store) => {
        const normalized = normalizeRecord({
          ...existing,
          status: "cancelled",
          lease: undefined,
          cancellation,
          updatedAt: at,
        });
        if (
          !store.updateChangeProofExecution(normalized, {
            status: existing.status,
            cursor: existing.cursor,
            ...(existing.lease?.token ? { leaseToken: existing.lease.token } : {}),
          })
        ) {
          throw new ChangeProofExecutionError(
            "PROOF_EXECUTION_NOT_FOUND",
            "Change Proof execution disappeared during update",
          );
        }
        return clone(normalized);
      });
      const dispatch = activeDispatches.get(existing.id);
      if (dispatch?.cancel) await Promise.resolve(dispatch.cancel()).catch(() => undefined);
      const current = await readChangeVerification(input, input.proofId);
      if (
        current &&
        ![
          "proved",
          "rejected",
          "needs-review",
          "insufficient-evidence",
          "cancelled",
          "superseded",
        ].includes(current.state)
      ) {
        await advanceChangeVerification({
          organizationId: input.organizationId,
          projectId: input.projectId,
          proofId: current.id,
          expectedVersion: current.version,
          state: "cancelled",
          actorId: input.actorId,
          requestId: `${existing.id}:cancel:${at}`,
          requestDigest: canonicalSha256({ executionId: existing.id, reason: input.reason, at }),
          action: "cancel",
          at,
          cancellation,
          smallestNextVerification: {
            kind: "none",
            reason: "This Proof execution was cancelled and cannot authorize merge.",
          },
        });
      }
      return updated;
    },
    async reconcile(scope, at = now()) {
      const records = await readControlStore((store) =>
        store
          .changeProofExecutions(scope?.organizationId, scope?.projectId)
          .map(normalizeRecord)
          .filter((record) => record.status === "running" && Boolean(record.lease)),
      );
      const reconciled: ChangeProofExecutionRecord[] = [];
      for (const record of records) {
        reconciled.push(
          await reconcileClaimedRecord(
            record,
            readRun,
            at,
            record.publication ?? configured.publication,
          ),
        );
      }
      return reconciled;
    },
    async run(input, executor) {
      let admitted = await ensureStarted(input, {
        now,
        maxDurationMs,
        publication: configured.publication,
      });
      // A caller may be the first process to reattach after the prior server
      // died. Reconcile an expired in-flight lease before attempting a new
      // claim; otherwise a `dispatching` cell with no committed Run id could
      // cross the target enqueue seam a second time.
      if (admitted.status === "running" && admitted.lease && admitted.lease.expiresAt <= now()) {
        admitted = await reconcileClaimedRecord(
          admitted,
          readRun,
          now(),
          admitted.publication ?? configured.publication,
        );
      }
      if (["completed", "cancelled", "uncertain"].includes(admitted.status)) return admitted;
      if (active.has(admitted.id)) return admitted;
      active.add(admitted.id);
      try {
        const options: ChangeProofExecutionRunOptions = {
          now,
          workerId,
          leaseMs,
          readRun,
          projectRun,
          publication: configured.publication,
          activeDispatches,
        };
        return await runOne(admitted, input, options, executor);
      } finally {
        active.delete(admitted.id);
      }
    },
  };
}

export type ChangeProofExecutionCoordinator = {
  submit(input: ChangeProofExecutionSubmitInput): Promise<ChangeProofExecutionRecord>;
  read(
    scope: ChangeVerificationScope,
    proofId: string,
  ): Promise<ChangeProofExecutionRecord | undefined>;
  cancel(
    input: ChangeVerificationScope & {
      proofId: string;
      actorId: string;
      reason: string;
      at?: number;
    },
  ): Promise<ChangeProofExecutionRecord | undefined>;
  reconcile(scope?: ChangeVerificationScope, at?: number): Promise<ChangeProofExecutionRecord[]>;
  run(
    input: ChangeProofExecutionSubmitInput,
    executor: ChangeProofCellExecutor,
  ): Promise<ChangeProofExecutionRecord>;
};

export async function reconcileChangeProofExecutions(
  input: {
    scope?: ChangeVerificationScope;
    at?: number;
    readRun?: (id: string) => Promise<PersistedRun | null>;
  } = {},
): Promise<ChangeProofExecutionRecord[]> {
  return createChangeProofExecutionCoordinator({ readRun: input.readRun }).reconcile(
    input.scope,
    input.at,
  );
}

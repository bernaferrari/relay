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
import {
  changeProofCaseResultFromPersistedRun,
  changeProofCellIdFromPersistedRun,
  changeProofRequiredRunCases,
  frozenCellExecutionRisk,
} from "./change-proof-live-run.js";
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
  type ChangeProofExecutionHumanEvidenceInput,
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
  updateGuard,
  write,
} from "./change-proof-execution-store.js";
import {
  ChangeProofConfirmationError,
  validateChangeProofExecutionConfirmations,
  validateIssuedChangeProofExecutionConfirmations,
  consumeIssuedChangeProofExecutionConfirmations,
  humanOnlyInterventionForCell,
} from "./change-proof-confirmation.js";
import {
  reconcileClaimedRecord,
  runOne,
  type ChangeProofExecutionRunOptions,
} from "./change-proof-execution-runner.js";
import { publish } from "./events.js";

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
  ChangeProofExecutionRequestAuthority,
  ChangeProofExecutionHumanIntervention,
  ChangeProofExecutionHumanInterventionEvidence,
  ChangeProofExecutionHumanEvidenceInput,
  ChangeProofExecutionSubmitInput,
} from "./change-proof-execution-types.js";

function nextAction(record: ChangeProofExecutionRecord): ChangeProofExecutionSummary["nextAction"] {
  if (record.status === "completed") return "complete";
  if (record.status === "cancelled") return "cancelled";
  if (record.status === "uncertain") return "reconcile";
  if (record.status === "paused-human") return "human-intervention";
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
    ...(record.humanIntervention ? { humanIntervention: record.humanIntervention } : {}),
    ...(record.humanInterventionEvidence?.length
      ? { humanInterventionEvidence: record.humanInterventionEvidence }
      : {}),
    ...(record.terminalUncertainty ? { terminalUncertainty: record.terminalUncertainty } : {}),
  });
}

async function recordHumanInterventionEvidence(
  input: ChangeProofExecutionHumanEvidenceInput,
): Promise<ChangeProofExecutionRecord> {
  nonEmpty(input.requestId, "requestId");
  nonEmpty(input.executionId, "executionId");
  nonEmpty(input.proofId, "proofId");
  nonEmpty(input.cellId, "cellId");
  nonEmpty(input.stepId, "stepId");
  nonEmpty(input.actorId, "actorId");
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.evidenceDigest)) {
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_HUMAN_INTERVENTION",
      "Human intervention evidence must be a canonical sha256 digest",
    );
  }
  const existing = await readExecution(input, input.proofId);
  if (!existing) {
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_HUMAN_INTERVENTION",
      "The Proof has no durable execution to resume",
    );
  }
  if (existing.id !== input.executionId || existing.proofId !== input.proofId) {
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_HUMAN_INTERVENTION",
      "Human intervention evidence does not match the exact durable execution",
    );
  }
  if (existing.status !== "paused-human" || !existing.humanIntervention) {
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_HUMAN_INTERVENTION",
      "The Proof is not paused at a resumable human-only step",
    );
  }
  if (
    existing.humanIntervention.cellId !== input.cellId ||
    existing.humanIntervention.stepId !== input.stepId
  ) {
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_HUMAN_INTERVENTION",
      "Human intervention evidence does not match the exact paused cell and step",
    );
  }
  const at = input.at ?? Date.now();
  if (!Number.isSafeInteger(at) || at < existing.createdAt) {
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_HUMAN_INTERVENTION",
      "Human intervention evidence timestamp is invalid",
    );
  }
  const evidence = {
    schemaVersion: 1 as const,
    executionId: existing.id,
    proofId: existing.proofId,
    cellId: input.cellId,
    stepId: input.stepId,
    evidenceDigest: input.evidenceDigest,
    recordedBy: input.actorId,
    recordedAt: at,
    requestId: input.requestId,
  };
  const prior = existing.humanInterventionEvidence?.find(
    (item) => item.requestId === input.requestId,
  );
  if (prior) {
    if (canonicalSha256(prior) !== canonicalSha256(evidence)) {
      throw new ChangeProofExecutionError(
        "PROOF_EXECUTION_HUMAN_INTERVENTION",
        "Human intervention request id is already bound to another evidence intent",
      );
    }
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_HUMAN_INTERVENTION",
      "Human intervention evidence was already recorded",
    );
  }
  return withControlStore((store) =>
    write(
      store,
      normalizeRecord({
        ...existing,
        status: "queued",
        humanIntervention: undefined,
        humanInterventionEvidence: [...(existing.humanInterventionEvidence ?? []), evidence],
        lease: undefined,
        updatedAt: at,
      }),
      updateGuard(existing),
    ),
  );
}

async function ensureStarted(
  input: ChangeProofExecutionSubmitInput,
  options: Required<
    Pick<ChangeProofExecutionCoordinatorOptions, "now" | "maxDurationMs" | "readRun" | "projectRun">
  > &
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
  const existing = await readExecution(input, proof.id);
  let confirmationReceipts;
  try {
    // A resumed coordinator already owns the frozen preview. Reattaching
    // without a second receipt is safe because no new target admission occurs;
    // supplied receipts must still validate against that exact frozen proof.
    confirmationReceipts =
      existing && !input.confirmationReceipts?.length
        ? []
        : validateChangeProofExecutionConfirmations({
            proof: existing?.frozenProof ?? proof,
            receipts: input.confirmationReceipts,
            actorId: input.actorId,
            now: options.now(),
          });
  } catch (error) {
    if (error instanceof ChangeProofConfirmationError) throw error;
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_NOT_READY",
      error instanceof Error ? error.message : "Proof confirmation could not be validated",
    );
  }
  if (confirmationReceipts.length) {
    // Schema and frozen-preview validation are not issuance provenance. Check
    // the durable human-issued record even when this request merely reattaches
    // an existing execution; otherwise a forged receipt could be accepted as
    // an inert retry identity.
    await validateIssuedChangeProofExecutionConfirmations(confirmationReceipts);
  }
  const current = await readChangeVerification(
    { organizationId: input.organizationId, projectId: input.projectId },
    proof.id,
  );
  if (!current)
    throw new ChangeProofExecutionError("PROOF_EXECUTION_NOT_FOUND", "Proof was not found");
  if (existing) {
    if (existing.requestId === input.requestId && existing.requestDigest !== input.requestDigest) {
      throw new ChangeProofExecutionError(
        "PROOF_EXECUTION_CONFLICT",
        "Proof request id is already bound to another execution intent",
      );
    }
    const consumed = existing.confirmationReceipts ?? [];
    if (confirmationReceipts.length) {
      const consumedIds = new Set(consumed.map((receipt) => receipt.receiptId));
      const mismatch = confirmationReceipts.find((receipt) => consumedIds.has(receipt.receiptId));
      if (
        mismatch &&
        !(
          existing.requestId === input.requestId &&
          existing.requestDigest === input.requestDigest &&
          consumed.some(
            (receipt) =>
              receipt.receiptId === mismatch.receiptId &&
              receipt.previewDigest === mismatch.previewDigest &&
              receipt.actorId === mismatch.actorId,
          )
        )
      ) {
        throw new ChangeProofConfirmationError(
          "PROOF_CONFIRMATION_REPLAYED",
          `Confirmation receipt ${mismatch.receiptId} was already consumed`,
        );
      }
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
  // `proof.runIds` is append-only history, not an execution cursor. A manual
  // or unrelated Run may be present there, and its position must never skip a
  // frozen Verification Cell. Reconstruct only cells whose persisted Run
  // proves the exact App Map, target, build, and dimensions; project the Run
  // through the canonical result authority before treating it as complete.
  const priorResults = new Map<
    string,
    {
      runId: string;
      result: Awaited<
        ReturnType<NonNullable<ChangeProofExecutionCoordinatorOptions["projectRun"]>>
      >;
    }
  >();
  for (const runId of current.runIds) {
    const run = await options.readRun(runId);
    if (!run) continue;
    const cellId = changeProofCellIdFromPersistedRun({ proof: current, run });
    if (!cellId || priorResults.has(cellId)) continue;
    try {
      const result = await options.projectRun({ proof: current, run });
      priorResults.set(cellId, { runId, result });
    } catch {
      // A historical Run that cannot be projected is not execution progress.
      // Leave its cell pending; the next durable attempt will either produce
      // a fresh result or end in explicit uncertainty.
    }
  }
  const at = options.now();
  const cells = cases.map((cell) => {
    const prior = priorResults.get(cell.cellId);
    return prior
      ? {
          cell,
          status: prior.result.outcome,
          runId: prior.runId,
          result: prior.result,
          updatedAt: at,
        }
      : { cell, status: "pending" as const, updatedAt: at };
  });
  const nextPending = cells.findIndex((cell) => cell.status === "pending");
  const humanCell =
    nextPending < 0
      ? undefined
      : (() => {
          const candidate = cases[nextPending];
          const frozen = current.selection.cells?.find((cell) => cell.id === candidate?.cellId);
          if (!frozen || frozenCellExecutionRisk(frozen).confirmation !== "human-only") {
            return undefined;
          }
          return candidate;
        })();
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
    ...(input.requestAuthority ? { requestAuthority: clone(input.requestAuthority) } : {}),
    ...(confirmationReceipts.length
      ? {
          confirmationReceipts: confirmationReceipts.map((receipt) => ({
            ...clone(receipt),
            consumedAt: at,
          })),
        }
      : {}),
    ...((input.publication ?? options.publication)
      ? { publication: input.publication ?? options.publication }
      : {}),
    frozenProof: clone(current),
    cells,
    cursor: nextPending < 0 ? cases.length : nextPending,
    total: cases.length,
    deadlineAt: at + options.maxDurationMs,
    status: humanCell ? "paused-human" : "queued",
    ...(humanCell
      ? {
          humanIntervention: humanOnlyInterventionForCell({
            proof: current,
            cellId: humanCell.cellId,
            at,
          }),
        }
      : {}),
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
    if (confirmationReceipts.length) {
      consumeIssuedChangeProofExecutionConfirmations(store, confirmationReceipts, base.createdAt);
    }
    if (!store.insertChangeProofExecution(base)) {
      throw new ChangeProofExecutionError(
        "PROOF_EXECUTION_CONFLICT",
        "Execution admission raced another coordinator",
      );
    }
    publish(
      {
        type: "proof.execution.changed",
        at: base.updatedAt,
        proofId: base.proofId,
        executionId: base.id,
        cursor: base.cursor,
        status: base.status,
      },
      base,
    );
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
  const recoveryRetryMs = Math.max(0, configured.recoveryRetryMs ?? 1_000);
  const scheduleRecoveryRetry =
    configured.scheduleRecoveryRetry ??
    ((callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref?.();
      return timer;
    });
  const scheduledRecovery = new Set<string>();

  const coordinator: ChangeProofExecutionCoordinator = {
    async submit(input) {
      return ensureStarted(input, {
        now,
        maxDurationMs,
        publication: configured.publication,
        readRun,
        projectRun,
      });
    },
    async read(scope, proofId) {
      return readExecution(scope, proofId);
    },
    async recordHumanInterventionEvidence(input) {
      return recordHumanInterventionEvidence(input);
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
        publish(
          {
            type: "proof.execution.changed",
            at: normalized.updatedAt,
            proofId: normalized.proofId,
            executionId: normalized.id,
            cursor: normalized.cursor,
            status: normalized.status,
          },
          normalized,
        );
        return clone(normalized);
      });
      const dispatch = activeDispatches.get(existing.id);
      if (dispatch?.cancel) await Promise.resolve(dispatch.cancel()).catch(() => undefined);
      const current =
        input.transitionProof !== false
          ? await readChangeVerification(input, input.proofId)
          : undefined;
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
    async recover(executor) {
      await coordinator.reconcile(undefined, now());
      const records = await readControlStore((store) =>
        store
          .changeProofExecutions()
          .map(normalizeRecord)
          .filter((record) => record.status === "queued" || record.status === "running"),
      );
      const recovered: ChangeProofExecutionRecord[] = [];
      for (const record of records) {
        const live = await readExecution(record, record.proofId);
        if (!live || ["completed", "cancelled", "uncertain"].includes(live.status)) {
          if (live) recovered.push(live);
          continue;
        }
        const result = await coordinator.run(
          {
            organizationId: live.organizationId,
            projectId: live.projectId,
            proof: live.frozenProof,
            requestId: live.requestId,
            requestDigest: live.requestDigest,
            actorId: live.actorId,
            authority: live.authority,
            ...(live.requestAuthority ? { requestAuthority: live.requestAuthority } : {}),
            ...(live.publication ? { publication: live.publication } : {}),
          },
          executor,
        );
        recovered.push(result);
        // A different live worker is allowed to keep its lease. Do not leave
        // the Proof permanently queued just because this startup raced it;
        // retry after the lease's expiry with a bounded backoff. The timer is
        // deduplicated per execution and unref'd by the default scheduler.
        if (
          result.lease &&
          result.lease.workerId !== workerId &&
          result.lease.expiresAt > now() &&
          !scheduledRecovery.has(result.id)
        ) {
          scheduledRecovery.add(result.id);
          const delayMs = Math.max(recoveryRetryMs, result.lease.expiresAt - now());
          scheduleRecoveryRetry(() => {
            scheduledRecovery.delete(result.id);
            void (async () => {
              try {
                await coordinator.recover?.(executor);
              } catch {
                // Startup recovery is best effort; the next retry or a
                // foreground proof.run will surface a durable failure.
              }
            })();
          }, delayMs);
        }
      }
      return recovered;
    },
    async run(input, executor) {
      let admitted = await ensureStarted(input, {
        now,
        maxDurationMs,
        publication: configured.publication,
        readRun,
        projectRun,
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
      if (["completed", "cancelled", "uncertain", "paused-human"].includes(admitted.status)) {
        return admitted;
      }
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
          onDispatchFencePersisted: configured.onDispatchFencePersisted,
          activeDispatches,
        };
        return await runOne(admitted, input, options, executor);
      } finally {
        active.delete(admitted.id);
      }
    },
  };
  return coordinator;
}

export type ChangeProofExecutionCoordinator = {
  submit(input: ChangeProofExecutionSubmitInput): Promise<ChangeProofExecutionRecord>;
  read(
    scope: ChangeVerificationScope,
    proofId: string,
  ): Promise<ChangeProofExecutionRecord | undefined>;
  recordHumanInterventionEvidence(
    input: ChangeProofExecutionHumanEvidenceInput,
  ): Promise<ChangeProofExecutionRecord>;
  cancel(
    input: ChangeVerificationScope & {
      proofId: string;
      actorId: string;
      reason: string;
      at?: number;
      /** Route-owned lifecycle mutations fence execution first, then persist
       * their caller-bound receipt. Direct coordinator callers keep the
       * default lifecycle transition. */
      transitionProof?: boolean;
    },
  ): Promise<ChangeProofExecutionRecord | undefined>;
  reconcile(scope?: ChangeVerificationScope, at?: number): Promise<ChangeProofExecutionRecord[]>;
  /** Reconcile expired dispatch fences, then autonomously continue every
   * queued/running execution from its frozen authority after server restart. */
  recover?(executor: ChangeProofCellExecutor): Promise<ChangeProofExecutionRecord[]>;
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

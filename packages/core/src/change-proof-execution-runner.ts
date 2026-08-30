import { randomUUID } from "node:crypto";
import type {
  ChangeProofCaseResult,
  ChangeProofExecutionCellStatus,
  ChangeVerification,
} from "@relay/protocol";
import {
  advanceChangeVerification,
  readChangeVerification,
  type ChangeProofPublicationRequest,
} from "./change-verification-store.js";
import { decideChangeVerification } from "./change-proof-decision.js";
import { verifyChangePlanDigest, verifyChangePolicyDigest } from "./change-proof-integrity.js";
import { withControlStore, type ControlStore } from "./collaboration-store.js";
import type { PersistedRun } from "./runs.js";
import {
  ChangeProofExecutionError,
  type ChangeProofCellDispatch,
  type ChangeProofCellExecutor,
  type ChangeProofExecutionRecord,
  type ChangeProofExecutionSubmitInput,
} from "./change-proof-execution-types.js";
import {
  mutationDigest,
  normalizeRecord,
  readExecution,
  updateGuard,
  write,
} from "./change-proof-execution-store.js";

export type ChangeProofExecutionRunOptions = {
  now: () => number;
  workerId: string;
  leaseMs: number;
  readRun: (id: string) => Promise<PersistedRun | null>;
  projectRun: (input: { proof: unknown; run: PersistedRun }) => Promise<ChangeProofCaseResult>;
  publication?: ChangeProofPublicationRequest;
  onDispatchFencePersisted?: (record: ChangeProofExecutionRecord) => Promise<void> | void;
  activeDispatches: Map<string, ActiveDispatch>;
};

type ActiveDispatch = Pick<ChangeProofCellDispatch, "cancel">;

function cellStatusForResult(result: ChangeProofCaseResult): ChangeProofExecutionCellStatus {
  return result.outcome;
}

/** Lifecycle mutations may advance a Proof version while execution is in
 * flight, but they must never replace the immutable plan or policy authority
 * used to dispatch and project a Run. */
function sameFrozenProofAuthority(
  frozen: ChangeVerification,
  current: ChangeVerification,
): boolean {
  try {
    return (
      verifyChangePlanDigest(frozen) === verifyChangePlanDigest(current) &&
      verifyChangePolicyDigest(frozen.policy) === verifyChangePolicyDigest(current.policy) &&
      frozen.planDigest === current.planDigest &&
      frozen.policyDigest === current.policyDigest
    );
  } catch {
    return false;
  }
}

export async function reconcileClaimedRecord(
  record: ChangeProofExecutionRecord,
  readRun: (id: string) => Promise<PersistedRun | null>,
  at: number,
  publication?: ChangeProofPublicationRequest,
): Promise<ChangeProofExecutionRecord> {
  if (!record.lease || record.lease.expiresAt > at) return record;
  const current = record.cells[record.cursor];
  if (!current || (current.status !== "dispatching" && current.status !== "running")) {
    return withControlStore((store) =>
      write(store, { ...record, lease: undefined, updatedAt: at }, updateGuard(record)),
    );
  }
  // A persisted Run is a sufficient commit record. It may have been written by
  // the session process just before this coordinator was stopped.
  if (current.runId) {
    const run = await readRun(current.runId);
    if (run) {
      return withControlStore((store) =>
        write(
          store,
          {
            ...record,
            lease: undefined,
            cells: record.cells.map((cell, index) =>
              index === record.cursor ? { ...cell, status: "running", updatedAt: at } : cell,
            ),
            updatedAt: at,
          },
          updateGuard(record),
        ),
      );
    }
  }
  return markUncertain(
    record,
    "The server stopped after dispatch began and no durable Run manifest was found; Relay will not replay this cell.",
    at,
    { now: () => at, ...(publication ? { publication } : {}) },
    {
      organizationId: record.organizationId,
      projectId: record.projectId,
      proof: record.frozenProof,
      requestId: record.requestId,
      requestDigest: record.requestDigest,
      actorId: record.actorId,
      authority: "confirmed",
    },
    current.runId,
  );
}

function claimRecordInStore(
  store: ControlStore,
  record: ChangeProofExecutionRecord,
  workerId: string,
  at: number,
  leaseMs: number,
): ChangeProofExecutionRecord | undefined {
  const current = store.changeProofExecutionByProof(
    record.organizationId,
    record.projectId,
    record.proofId,
  );
  if (!current)
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_NOT_FOUND",
      "Change Proof execution was not found",
    );
  const parsed = normalizeRecord(current);
  if (
    parsed.status === "completed" ||
    parsed.status === "cancelled" ||
    parsed.status === "uncertain"
  )
    return parsed;
  if (parsed.lease && parsed.lease.expiresAt > at && parsed.lease.workerId !== workerId)
    return undefined;
  const next = {
    ...parsed,
    status: "running" as const,
    lease: { workerId, token: randomUUID(), claimedAt: at, expiresAt: at + leaseMs },
    updatedAt: at,
  };
  return write(store, next, updateGuard(parsed));
}

export async function runOne(
  admitted: ChangeProofExecutionRecord,
  submitInput: ChangeProofExecutionSubmitInput,
  options: ChangeProofExecutionRunOptions,
  executor: ChangeProofCellExecutor,
): Promise<ChangeProofExecutionRecord> {
  const claimed = await withControlStore((store) =>
    claimRecordInStore(store, admitted, options.workerId, options.now(), options.leaseMs),
  );
  // Another server may own the execution lease. Returning its durable state is
  // important: proceeding with the admitted snapshot here would cross the
  // target enqueue seam without authority and could duplicate a cell.
  if (!claimed) {
    const current = await readExecution(submitInput, admitted.proofId);
    if (!current) {
      throw new ChangeProofExecutionError(
        "PROOF_EXECUTION_NOT_FOUND",
        "Change Proof execution disappeared while claiming its worker lease",
      );
    }
    return current;
  }
  let record = claimed;
  // Publication is part of the admitted execution document. Prefer that
  // frozen intent over a process-local option so restart reconciliation and a
  // later worker cannot silently drop or change its outbox destination.
  if (record.publication && !options.publication) options.publication = record.publication;
  if (["completed", "cancelled", "uncertain"].includes(record.status)) return record;
  const heartbeat = setInterval(
    () => {
      void withControlStore((store) => {
        const current = store.changeProofExecutionByProof(
          record.organizationId,
          record.projectId,
          record.proofId,
        );
        if (!current) return;
        const parsed = normalizeRecord(current);
        if (parsed.lease?.workerId !== options.workerId || parsed.status !== "running") return;
        write(
          store,
          {
            ...parsed,
            lease: { ...parsed.lease, expiresAt: options.now() + options.leaseMs },
            updatedAt: options.now(),
          },
          updateGuard(parsed),
        );
      }).catch(() => undefined);
    },
    Math.max(1_000, Math.floor(options.leaseMs / 2)),
  );
  heartbeat.unref?.();
  try {
    while (record.cursor < record.total) {
      const live = await readExecution(submitInput, record.proofId);
      if (!live) {
        record = await markUncertain(
          record,
          "The execution record disappeared while a cell was active.",
          options.now(),
          options,
          submitInput,
        );
        break;
      }
      if (["completed", "cancelled", "uncertain"].includes(live.status)) return live;
      if (!live.lease || live.lease.token !== record.lease?.token) return live;
      record = live;
      const currentCell = record.cells[record.cursor]!;
      // A restart may inherit a cell whose durable Run id was recorded before
      // the coordinator process stopped. Reconcile that manifest instead of
      // crossing the target enqueue seam a second time.
      if (currentCell.status === "running" && currentCell.runId) {
        const recoveredRun = await options.readRun(currentCell.runId);
        if (!recoveredRun) {
          record = await markUncertain(
            record,
            "The dispatched Run manifest was not found during restart reconciliation.",
            options.now(),
            options,
            submitInput,
            currentCell.runId,
          );
          break;
        }
        let recoveredResult: ChangeProofCaseResult;
        try {
          const recoveryProof = await readChangeVerification(submitInput, record.proofId);
          if (recoveryProof && !sameFrozenProofAuthority(record.frozenProof, recoveryProof)) {
            record = await markUncertain(
              record,
              "The persisted Proof plan or policy changed while its Run was awaiting recovery.",
              options.now(),
              options,
              submitInput,
              currentCell.runId,
            );
            break;
          }
          recoveredResult =
            currentCell.result ??
            (await options.projectRun({
              proof: record.frozenProof,
              run: recoveredRun,
            }));
        } catch (error) {
          record = await markUncertain(
            record,
            error instanceof Error
              ? error.message
              : "Recovered Run could not be projected into Proof facts.",
            options.now(),
            options,
            submitInput,
            currentCell.runId,
          );
          break;
        }
        record = await recordRunResult(record, recoveredResult, submitInput, options);
        continue;
      }
      const at = options.now();
      if (at >= record.deadlineAt) {
        record = await markUncertain(
          record,
          "The Proof execution deadline elapsed before the next target dispatch.",
          at,
          options,
          submitInput,
        );
        break;
      }
      if (record.cursor > 0) {
        const proof = await readChangeVerification(submitInput, record.proofId);
        if (proof?.state === "awaiting-expansion") {
          await advanceChangeVerification({
            organizationId: proof.organizationId,
            projectId: proof.projectId,
            proofId: proof.id,
            expectedVersion: proof.version,
            state: "running",
            actorId: submitInput.actorId,
            requestId: `${record.id}:start-required-coverage:${record.cursor}`,
            requestDigest: mutationDigest(record, "start-required-coverage", at),
            action: "start-required-coverage",
            at,
            smallestNextVerification: {
              kind: "expand",
              reason:
                "The Proof pilot passed; the durable coordinator is running required coverage.",
            },
            ...(options.publication ? { publication: options.publication } : {}),
          });
        }
      }
      // Persist dispatching before crossing into the canonical App Map Test
      // enqueue/session path. A process death from here is terminal uncertainty.
      record = await withControlStore((store) =>
        write(
          store,
          {
            ...record,
            cells: record.cells.map((cell, index) =>
              index === record.cursor ? { ...cell, status: "dispatching", updatedAt: at } : cell,
            ),
            updatedAt: at,
          },
          updateGuard(record),
        ),
      );
      await options.onDispatchFencePersisted?.(record);
      // Re-read after the durable `dispatching` fence. Cancellation can land
      // while that write is waiting for the control-store transaction; it
      // must win before the executor crosses target control.
      const admittedDispatch = await readExecution(submitInput, record.proofId);
      if (!admittedDispatch) {
        record = await markUncertain(
          record,
          "The execution record disappeared before cell dispatch.",
          options.now(),
          options,
          submitInput,
        );
        break;
      }
      if (["completed", "cancelled", "uncertain"].includes(admittedDispatch.status)) {
        return admittedDispatch;
      }
      if (!admittedDispatch.lease || admittedDispatch.lease.token !== record.lease?.token) {
        return admittedDispatch;
      }
      record = admittedDispatch;
      let dispatched: ChangeProofCellDispatch;
      try {
        dispatched = await executor({ execution: record, cell: currentCell.cell });
      } catch (error) {
        record = await markUncertain(
          record,
          error instanceof Error ? error.message : "Cell dispatch outcome is unknown.",
          options.now(),
          options,
          submitInput,
        );
        break;
      }
      if (!dispatched.runId.trim()) {
        record = await markUncertain(
          record,
          "Cell dispatch returned no durable Run identity.",
          options.now(),
          options,
          submitInput,
        );
        break;
      }
      const afterDispatch = await readExecution(submitInput, record.proofId);
      if (!afterDispatch) {
        record = await markUncertain(
          record,
          "The execution record disappeared after cell dispatch.",
          options.now(),
          options,
          submitInput,
          dispatched.runId,
        );
        break;
      }
      if (["completed", "cancelled", "uncertain"].includes(afterDispatch.status)) {
        if (dispatched.cancel) await Promise.resolve(dispatched.cancel()).catch(() => undefined);
        record = afterDispatch;
        break;
      }
      if (!afterDispatch.lease || afterDispatch.lease.token !== record.lease?.token) {
        if (dispatched.cancel) await Promise.resolve(dispatched.cancel()).catch(() => undefined);
        record = afterDispatch;
        break;
      }
      record = await withControlStore((store) =>
        write(
          store,
          {
            ...afterDispatch,
            cells: afterDispatch.cells.map((cell, index) =>
              index === afterDispatch.cursor
                ? { ...cell, status: "running", runId: dispatched.runId, updatedAt: options.now() }
                : cell,
            ),
            runIds: [...new Set([...afterDispatch.runIds, dispatched.runId])],
            updatedAt: options.now(),
          },
          updateGuard(afterDispatch),
        ),
      );
      options.activeDispatches.set(record.id, dispatched);
      let run: PersistedRun;
      try {
        run = await waitForCellDispatch(dispatched, record.deadlineAt, options.now);
      } catch (error) {
        if (dispatched.cancel) await Promise.resolve(dispatched.cancel()).catch(() => undefined);
        record = await markUncertain(
          record,
          error instanceof Error ? error.message : "Cell Run outcome is unknown.",
          options.now(),
          options,
          submitInput,
          dispatched.runId,
        );
        break;
      } finally {
        options.activeDispatches.delete(record.id);
      }
      // If the callback returned a manifest under a different id, refuse to
      // infer identity: doing so could attach another cell's Run.
      if (run.id !== dispatched.runId) {
        record = await markUncertain(
          record,
          "Canonical Run identity differed from the dispatched identity.",
          options.now(),
          options,
          submitInput,
          dispatched.runId,
        );
        break;
      }
      let result: ChangeProofCaseResult;
      try {
        const projectionProof = await readChangeVerification(submitInput, record.proofId);
        if (projectionProof && !sameFrozenProofAuthority(record.frozenProof, projectionProof)) {
          record = await markUncertain(
            record,
            "The persisted Proof plan or policy changed before its Run was projected.",
            options.now(),
            options,
            submitInput,
            dispatched.runId,
          );
          break;
        }
        result = await options.projectRun({
          proof: record.frozenProof,
          run,
        });
      } catch (error) {
        record = await markUncertain(
          record,
          error instanceof Error ? error.message : "Run could not be projected into Proof facts.",
          options.now(),
          options,
          submitInput,
          dispatched.runId,
        );
        break;
      }
      record = await recordRunResult(record, result, submitInput, options);
    }
    return record;
  } finally {
    clearInterval(heartbeat);
  }
}

async function waitForCellDispatch(
  dispatch: ChangeProofCellDispatch,
  deadlineAt: number,
  now: () => number,
): Promise<PersistedRun> {
  const remaining = deadlineAt - now();
  if (remaining <= 0)
    throw new Error("The Proof execution deadline elapsed while waiting for the cell Run.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error("The Proof execution deadline elapsed while waiting for the cell Run.")),
        remaining,
      );
    });
    return await Promise.race([dispatch.wait(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function recordRunResult(
  record: ChangeProofExecutionRecord,
  result: ChangeProofCaseResult,
  submitInput: ChangeProofExecutionSubmitInput,
  options: { now: () => number; publication?: ChangeProofPublicationRequest },
): Promise<ChangeProofExecutionRecord> {
  const at = options.now();
  const durable = await readExecution(submitInput, record.proofId);
  if (!durable) {
    return markUncertain(
      record,
      "The execution record disappeared before a durable Run result was recorded.",
      at,
      options,
      submitInput,
      result.runId,
    );
  }
  // Cancellation and lease loss are checked after the canonical Run returns,
  // before any Proof transition. A late result must never resurrect a
  // cancelled execution or let a replaced worker append a second fact.
  if (["completed", "cancelled", "uncertain"].includes(durable.status)) return durable;
  if (!durable.lease || durable.lease.token !== record.lease?.token) {
    throw new ChangeProofExecutionError(
      "PROOF_EXECUTION_LEASE_LOST",
      "Change Proof execution ownership was lost before recording the Run",
    );
  }
  record = durable;
  const current = await readChangeVerification(submitInput, record.proofId);
  if (!current)
    return markUncertain(
      record,
      "Proof disappeared while recording a durable Run.",
      at,
      options,
      submitInput,
      result.runId,
    );
  if (!sameFrozenProofAuthority(record.frozenProof, current)) {
    return markUncertain(
      record,
      "The persisted Proof plan or policy changed before its Run result was recorded.",
      at,
      options,
      submitInput,
      result.runId,
    );
  }
  const cells = record.cells.map((candidate, index) =>
    index === record.cursor
      ? {
          ...candidate,
          status: cellStatusForResult(result),
          result,
          runId: result.runId,
          updatedAt: at,
        }
      : candidate,
  );
  const runIds = [...new Set([...record.runIds, result.runId])];
  const projected = cells.flatMap((candidate) => (candidate.result ? [candidate.result] : []));
  const requiredCases = record.total;
  const decision = (() => {
    try {
      // The canonical decision function remains the sole authority for
      // aggregate Proof state; this module only persists its transition.
      return decideChangeVerification({ proof: current, caseResults: projected });
    } catch (error) {
      throw new ChangeProofExecutionError(
        "PROOF_EXECUTION_CONFLICT",
        error instanceof Error ? error.message : "Run facts could not form a Proof decision",
      );
    }
  })();
  let state: ChangeVerification["state"];
  let action: "record-runs" | "await-expansion";
  if (record.cursor === 0 && result.outcome === "passed" && requiredCases > 1) {
    state = "awaiting-expansion";
    action = "await-expansion";
  } else if (record.cursor + 1 < requiredCases && result.outcome === "passed") {
    state = "running";
    action = "record-runs";
  } else {
    state = decision.state;
    action = "record-runs";
  }
  // The cursor is the next *pending* frozen cell, not the number of Run ids
  // recorded on the Proof. Historical/manual Runs can be out of order (and
  // the admission path may have reconstructed sparse completed cells), so a
  // numeric increment would either replay a completed cell or skip one.
  const nextCursor = cells.findIndex((cell) => cell.status === "pending");
  const normalizedNextCursor = nextCursor < 0 ? cells.length : nextCursor;
  await advanceChangeVerification({
    organizationId: current.organizationId,
    projectId: current.projectId,
    proofId: current.id,
    expectedVersion: current.version,
    state,
    actorId: submitInput.actorId,
    requestId: `${record.id}:${action}:${normalizedNextCursor}`,
    requestDigest: mutationDigest(record, action, at),
    action,
    at,
    runIds,
    evidenceDigests: [...new Set([...current.evidenceDigests, ...result.evidenceDigests])],
    ...(state === "proved"
      ? { smallestNextVerification: decision.smallestNextVerification }
      : state === "rejected" || state === "needs-review" || state === "insufficient-evidence"
        ? {
            firstCausalFailure: decision.firstCausalFailure ?? null,
            coverageGaps: decision.coverageGaps,
            residualRisk: decision.residualRisk,
            smallestNextVerification: decision.smallestNextVerification,
          }
        : {
            smallestNextVerification:
              state === "awaiting-expansion"
                ? {
                    kind: "expand" as const,
                    reason: "The Proof pilot passed; run the smallest remaining required coverage.",
                  }
                : {
                    kind: "expand" as const,
                    reason: "Run the next policy-required Verification Cell.",
                  },
          }),
    ...(options.publication ? { publication: options.publication } : {}),
  });
  const completed =
    state === "proved" ||
    state === "rejected" ||
    state === "needs-review" ||
    state === "insufficient-evidence";
  return withControlStore((store) =>
    write(
      store,
      {
        ...record,
        cells,
        cursor: normalizedNextCursor,
        runIds,
        status: completed ? "completed" : "running",
        lease: completed ? undefined : record.lease,
        updatedAt: at,
      },
      updateGuard(durable),
    ),
  );
}

async function markUncertain(
  record: ChangeProofExecutionRecord,
  reason: string,
  at: number,
  options: { now: () => number; publication?: ChangeProofPublicationRequest },
  submitInput: ChangeProofExecutionSubmitInput,
  runId?: string,
): Promise<ChangeProofExecutionRecord> {
  const durable = await readExecution(submitInput, record.proofId);
  if (durable) {
    if (["completed", "cancelled", "uncertain"].includes(durable.status)) return durable;
    if (durable.lease?.token !== record.lease?.token) return durable;
    record = durable;
  }
  const current = await readChangeVerification(submitInput, record.proofId);
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
      organizationId: current.organizationId,
      projectId: current.projectId,
      proofId: current.id,
      expectedVersion: current.version,
      state: "needs-review",
      actorId: submitInput.actorId,
      requestId: `${record.id}:uncertain:${record.cursor}`,
      requestDigest: mutationDigest(record, "uncertain", at),
      action: "record-decision",
      at,
      coverageGaps: [
        ...current.coverageGaps,
        `Proof execution uncertainty for cell ${record.cells[record.cursor]?.cell.cellId ?? "unknown"}: ${reason}`,
      ].slice(0, 128),
      residualRisk: current.residualRisk,
      smallestNextVerification: {
        kind: "review",
        reason: "Inspect the terminally uncertain Proof cell before any rerun.",
      },
      ...(options.publication ? { publication: options.publication } : {}),
    });
  }
  return withControlStore((store) =>
    write(
      store,
      {
        ...record,
        status: "uncertain",
        lease: undefined,
        terminalUncertainty: {
          cellId: record.cells[record.cursor]?.cell.cellId ?? "unknown",
          reason,
          at,
          ...(runId ? { runId } : {}),
        },
        updatedAt: at,
      },
      durable ? updateGuard(durable) : undefined,
    ),
  );
}

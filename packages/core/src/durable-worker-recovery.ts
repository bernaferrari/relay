/**
 * Resolve durable worker journal rows after a Relay process boundary.
 *
 * A run manifest commits independently from the SQLite journal. Startup must
 * inspect that immutable commit before quarantining an assignment: otherwise a
 * finished run can unnecessarily keep a device or shared host fenced forever.
 */
import {
  currentDurableWorkerInstanceId,
  durableWorkerAssignmentStore,
  type DurableWorkerAssignment,
  type DurableWorkerAssignmentStore,
  type DurableWorkerAssignmentTerminalStatus,
} from "./durable-worker-assignments.js";
import { readPersistedRun } from "./runs.js";

type ManifestTerminalStatus = Exclude<DurableWorkerAssignmentTerminalStatus, "recovery-required">;

const MANIFEST_TERMINAL_STATUSES: readonly ManifestTerminalStatus[] = [
  "ok",
  "error",
  "healed",
  "cancelled",
];

/** Minimal, non-secret projection needed to reconcile a durable assignment. */
export type CommittedDurableRunManifest = {
  id: string;
  status: ManifestTerminalStatus;
};

export type ReadCommittedDurableRunManifest = (
  jobId: string,
) => Promise<CommittedDurableRunManifest | null>;

export type DurableWorkerStartupRecovery = {
  /** Every active/fenced job whose immutable manifest was checked first. */
  inspectedAssignmentIds: string[];
  /** Rows finalized from a valid `.complete`-guarded run manifest. */
  manifestFinalized: DurableWorkerAssignment[];
  /** Rows that had no valid terminal manifest and were quarantined. */
  recoveryRequired: DurableWorkerAssignment[];
  recoveredAt: number;
};

function isManifestTerminalStatus(value: unknown): value is ManifestTerminalStatus {
  return (
    typeof value === "string" &&
    MANIFEST_TERMINAL_STATUSES.includes(value as ManifestTerminalStatus)
  );
}

function requiresStartupRecovery(assignment: DurableWorkerAssignment): boolean {
  if (
    assignment.status === "queued" ||
    assignment.status === "running" ||
    assignment.status === "paused"
  ) {
    return true;
  }
  // A previously quarantined in-flight assignment remains fenced until a
  // reproof releases it. A later-found committed manifest is an equally strong
  // terminal boundary and may release that fence without another device touch.
  return (
    assignment.status === "recovery-required" &&
    Boolean(assignment.execution) &&
    !assignment.recoveryFenceRelease
  );
}

/**
 * `readPersistedRun` accepts schema-v5 reports only after their `.complete`
 * marker's digest matches `run.json`. Older report schemas have no immutable
 * commit marker, so they are intentionally not sufficient to free a target.
 */
async function readCommittedDurableRunManifest(
  jobId: string,
): Promise<CommittedDurableRunManifest | null> {
  const run = await readPersistedRun(jobId);
  if (
    !run ||
    run.schemaVersion !== 5 ||
    run.id !== jobId ||
    !isManifestTerminalStatus(run.status)
  ) {
    return null;
  }
  return { id: run.id, status: run.status };
}

async function safelyReadManifest(
  reader: ReadCommittedDurableRunManifest,
  jobId: string,
): Promise<CommittedDurableRunManifest | null> {
  try {
    const manifest = await reader(jobId);
    if (!manifest || manifest.id !== jobId || !isManifestTerminalStatus(manifest.status)) {
      return null;
    }
    return { id: manifest.id, status: manifest.status };
  } catch {
    // A transient disk/catalog read cannot authorize another input to the
    // target. Treat it exactly like a missing immutable commit and quarantine.
    return null;
  }
}

/**
 * Recover only the durable rows that existed at startup. All of them are
 * manifest-checked before any no-manifest row is quarantined. That ordering is
 * what closes the crash window between manifest commit and journal finalization.
 */
export async function recoverDurableWorkerAssignments(
  input: {
    store?: DurableWorkerAssignmentStore;
    workerInstanceId?: string;
    at?: number;
    readManifest?: ReadCommittedDurableRunManifest;
  } = {},
): Promise<DurableWorkerStartupRecovery> {
  const store = input.store ?? durableWorkerAssignmentStore();
  const workerInstanceId = input.workerInstanceId ?? currentDurableWorkerInstanceId();
  const recoveredAt = input.at ?? Date.now();
  const candidates = store.list().filter(requiresStartupRecovery);
  const reader = input.readManifest ?? readCommittedDurableRunManifest;
  const manifestResults = await Promise.all(
    candidates.map(async (assignment) => ({
      assignment,
      manifest: await safelyReadManifest(reader, assignment.id),
    })),
  );

  const manifestFinalized: DurableWorkerAssignment[] = [];
  const noManifestIds: string[] = [];
  for (const { assignment, manifest } of manifestResults) {
    if (!manifest) {
      noManifestIds.push(assignment.id);
      continue;
    }
    manifestFinalized.push(
      store.finishFromCommittedRunManifest({
        id: assignment.id,
        status: manifest.status,
        at: recoveredAt,
      }),
    );
  }

  const reconciliation = store.reconcileAfterRestart({
    workerInstanceId,
    at: recoveredAt,
    assignmentIds: noManifestIds,
  });
  return {
    inspectedAssignmentIds: candidates.map((assignment) => assignment.id),
    manifestFinalized,
    recoveryRequired: reconciliation.assignments,
    recoveredAt,
  };
}

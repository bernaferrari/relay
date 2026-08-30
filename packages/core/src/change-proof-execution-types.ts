import type {
  ActorKind,
  ChangeProofCaseResult,
  ChangeProofExecutionCancellation,
  ChangeProofExecutionCellStatus,
  ChangeProofExecutionUncertainty,
  ChangeVerification,
  ProjectRole,
} from "@relay/protocol";
import type {
  ChangeProofPublicationRequest,
  ChangeVerificationScope,
} from "./change-verification-store.js";
import type { ChangeProofRunCase } from "./change-proof-live-run.js";
import type { PersistedRun } from "./runs.js";

export const CHANGE_PROOF_EXECUTION_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CHANGE_PROOF_EXECUTION_DURATION_MS = 1_800_000;
export const DEFAULT_CHANGE_PROOF_EXECUTION_LEASE_MS = 60_000;

export type ChangeProofExecutionCell = {
  cell: ChangeProofRunCase;
  status: ChangeProofExecutionCellStatus;
  runId?: string;
  result?: ChangeProofCaseResult;
  updatedAt: number;
};

export type ChangeProofExecutionLease = {
  workerId: string;
  token: string;
  claimedAt: number;
  expiresAt: number;
};

/** Exact request trust boundary captured when proof.run is admitted. Recovery
 * must reuse this scope; synthesizing a local-trusted scope after restart
 * would grant a remote execution authority it never held. */
export type ChangeProofExecutionRequestAuthority = {
  subject: string;
  allowedProjects: string[];
  tokenKind: "local" | "service" | "external";
  localTrusted: boolean;
  role: ProjectRole;
  actorKind: ActorKind;
  externalActorKind?: "human" | "agent";
  leaseId?: string;
  leaseOwnerId?: string;
};

/** Durable implementation document. It intentionally contains the frozen
 * Proof plan and exact per-cell cursor. It is never returned by proof.run;
 * callers receive only the summary projection. */
export type ChangeProofExecutionRecord = {
  schemaVersion: typeof CHANGE_PROOF_EXECUTION_SCHEMA_VERSION;
  id: string;
  organizationId: string;
  projectId: string;
  proofId: string;
  proofVersion: number;
  requestId: string;
  requestDigest: `sha256:${string}`;
  actorId: string;
  authority: "confirmed";
  /** Optional only for parsing records written before authority persistence.
   * Those records are deliberately not recoverable without explicit
   * re-admission. Every newly submitted execution stores this field. */
  requestAuthority?: ChangeProofExecutionRequestAuthority;
  /** Provider publication is captured at admission so a restart cannot lose
   * the terminal outbox intent or consult a later ambient configuration. */
  publication?: ChangeProofPublicationRequest;
  frozenProof: ChangeVerification;
  cells: ChangeProofExecutionCell[];
  cursor: number;
  total: number;
  deadlineAt: number;
  status: "queued" | "running" | "completed" | "cancelled" | "uncertain";
  runIds: string[];
  cancellation?: ChangeProofExecutionCancellation;
  terminalUncertainty?: ChangeProofExecutionUncertainty;
  lease?: ChangeProofExecutionLease;
  createdAt: number;
  updatedAt: number;
};

export type ChangeProofCellDispatch = {
  /** The id is returned before waiting for the target job. Persisting it
   * before `wait` is the restart fence that prevents a second target input. */
  runId: string;
  wait: () => Promise<PersistedRun>;
  /** Best-effort cancellation of the canonical session/provider Run. The
   * durable cancellation fence is authoritative even when this hook is not
   * available or the provider cannot stop immediately. */
  cancel?: () => Promise<void> | void;
};

export type ChangeProofCellExecutor = (input: {
  execution: ChangeProofExecutionRecord;
  cell: ChangeProofRunCase;
}) => Promise<ChangeProofCellDispatch>;

export type ChangeProofExecutionCoordinatorOptions = {
  workerId?: string;
  now?: () => number;
  leaseMs?: number;
  maxDurationMs?: number;
  readRun?: (id: string) => Promise<PersistedRun | null>;
  /** Test/host seam around the canonical immutable Run projection. Production
   * defaults to changeProofCaseResultFromPersistedRun; no caller-supplied
   * verdict is accepted by the public operation. */
  projectRun?: (input: { proof: unknown; run: PersistedRun }) => Promise<ChangeProofCaseResult>;
  /** Deterministic test/embedding seam after `dispatching` is durable and
   * before target control. Production leaves it undefined. */
  onDispatchFencePersisted?: (record: ChangeProofExecutionRecord) => Promise<void> | void;
  /** Delay used by startup recovery when another worker still owns an
   * unexpired execution lease. The retry is scheduled after the lease expiry
   * (or this minimum delay), so recovery does not spin or abandon the Proof. */
  recoveryRetryMs?: number;
  /** Host/test seam for the bounded startup-recovery retry. The production
   * default uses an unref'd timer so a stuck external worker cannot keep a
   * process alive during shutdown. */
  scheduleRecoveryRetry?: (callback: () => void, delayMs: number) => unknown;
  publication?: ChangeProofPublicationRequest;
};

export type ChangeProofExecutionSubmitInput = ChangeVerificationScope & {
  proof: unknown;
  requestId: string;
  requestDigest: `sha256:${string}`;
  actorId: string;
  authority: "confirmed";
  requestAuthority?: ChangeProofExecutionRequestAuthority;
  expectedVersion?: number;
  publication?: ChangeProofPublicationRequest;
};

export class ChangeProofExecutionError extends Error {
  readonly code:
    | "PROOF_EXECUTION_EXISTS"
    | "PROOF_EXECUTION_CONFLICT"
    | "PROOF_EXECUTION_NOT_READY"
    | "PROOF_EXECUTION_NOT_FOUND"
    | "PROOF_EXECUTION_LEASE_LOST";

  constructor(code: ChangeProofExecutionError["code"], message: string) {
    super(message);
    this.name = "ChangeProofExecutionError";
    this.code = code;
  }
}

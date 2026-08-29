import {
  parseChangeVerification,
  type ChangeVerification,
  type ChangeVerificationDecision,
  type ChangeVerificationMutation,
  type ChangeVerificationState,
} from "@relay/protocol";
import { readControlStore, withControlStore } from "./collaboration-store.js";

export type ChangeVerificationScope = {
  organizationId: string;
  projectId: string;
};

export type CreateChangeVerificationInput = ChangeVerificationScope &
  Pick<ChangeVerification, "id" | "change" | "policy" | "requestedBy"> & {
    builds?: ChangeVerification["builds"];
    selection?: ChangeVerification["selection"];
    coverageGaps?: ChangeVerification["coverageGaps"];
    residualRisk?: ChangeVerification["residualRisk"];
    smallestNextVerification?: ChangeVerification["smallestNextVerification"];
    supersedesProofId?: string;
    actorId: string;
    requestId: string;
    requestDigest: ChangeVerification["lastMutation"]["requestDigest"];
    action?: Extract<ChangeVerificationMutation, "start" | "rerun-affected">;
    at: number;
  };

export type AdvanceChangeVerificationInput = ChangeVerificationScope & {
  proofId: string;
  expectedVersion: number;
  state: ChangeVerificationState;
  actorId: string;
  requestId: string;
  requestDigest: ChangeVerification["lastMutation"]["requestDigest"];
  action: Exclude<ChangeVerificationMutation, "start" | "rerun-affected">;
  at: number;
  builds?: ChangeVerification["builds"];
  selection?: ChangeVerification["selection"];
  planApproval?: ChangeVerification["planApproval"] | null;
  cancellation?: ChangeVerification["cancellation"];
  policy?: ChangeVerification["policy"];
  runIds?: ChangeVerification["runIds"];
  evidenceDigests?: ChangeVerification["evidenceDigests"];
  firstCausalFailure?: ChangeVerification["firstCausalFailure"] | null;
  coverageGaps?: ChangeVerification["coverageGaps"];
  residualRisk?: ChangeVerification["residualRisk"];
  smallestNextVerification?: ChangeVerification["smallestNextVerification"] | null;
};

export type SupersedeChangeVerificationInput = ChangeVerificationScope & {
  proofId: string;
  expectedVersion: number;
  replacement: Omit<
    CreateChangeVerificationInput,
    keyof ChangeVerificationScope | "supersedesProofId"
  >;
  actorId: string;
  requestId: string;
  requestDigest: ChangeVerification["lastMutation"]["requestDigest"];
  at: number;
};

export class ChangeVerificationConflictError extends Error {
  readonly code: "PROOF_EXISTS" | "PROOF_STALE" | "PROOF_IMMUTABLE";

  constructor(code: ChangeVerificationConflictError["code"], message: string) {
    super(message);
    this.name = "ChangeVerificationConflictError";
    this.code = code;
  }
}

export class ChangeVerificationNotFoundError extends Error {
  constructor() {
    super("Change Verification not found in this project");
    this.name = "ChangeVerificationNotFoundError";
  }
}

const EMPTY_SELECTION: ChangeVerification["selection"] = {
  affectedJourneys: [],
  targetCases: [],
};

const ALLOWED_TRANSITIONS: Readonly<
  Record<ChangeVerificationState, readonly ChangeVerificationState[]>
> = {
  planning: ["awaiting-build", "ready", "needs-review", "insufficient-evidence", "cancelled"],
  "awaiting-build": ["planning", "ready", "needs-review", "insufficient-evidence", "cancelled"],
  ready: ["running-pilot", "needs-review", "insufficient-evidence", "cancelled"],
  "running-pilot": [
    "awaiting-expansion",
    "running",
    "proved",
    "rejected",
    "needs-review",
    "insufficient-evidence",
    "cancelled",
  ],
  "awaiting-expansion": ["running", "needs-review", "insufficient-evidence", "cancelled"],
  running: ["proved", "rejected", "needs-review", "insufficient-evidence", "cancelled"],
  proved: [],
  rejected: [],
  "needs-review": [
    "planning",
    "awaiting-build",
    "ready",
    "running-pilot",
    "awaiting-expansion",
    "running",
    "cancelled",
  ],
  "insufficient-evidence": [
    "planning",
    "awaiting-build",
    "ready",
    "running-pilot",
    "awaiting-expansion",
    "running",
    "cancelled",
  ],
  cancelled: [],
  superseded: [],
};

function decisionForState(state: ChangeVerificationState): ChangeVerificationDecision | undefined {
  switch (state) {
    case "proved":
    case "rejected":
    case "needs-review":
    case "insufficient-evidence":
      return state;
    default:
      return undefined;
  }
}

function belongsToScope(proof: ChangeVerification, scope: ChangeVerificationScope): boolean {
  return proof.organizationId === scope.organizationId && proof.projectId === scope.projectId;
}

function assertScope(proof: ChangeVerification, scope: ChangeVerificationScope): void {
  if (!belongsToScope(proof, scope)) throw new ChangeVerificationNotFoundError();
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertAppendOnly<T>(before: readonly T[], after: readonly T[], name: string): void {
  if (
    after.length < before.length ||
    before.some((value, index) => !sameValue(value, after[index]))
  ) {
    throw new ChangeVerificationConflictError(
      "PROOF_IMMUTABLE",
      `${name} is append-only once recorded`,
    );
  }
}

function assertExecutablePlan(proof: ChangeVerification): void {
  if (
    !proof.builds.length ||
    !proof.selection.affectedJourneys.length ||
    !proof.selection.targetCases.length
  ) {
    throw new ChangeVerificationConflictError(
      "PROOF_IMMUTABLE",
      `state ${proof.state} requires exact builds, affected journeys, and target cases`,
    );
  }
}

function initialProof(input: CreateChangeVerificationInput): ChangeVerification {
  const builds = input.builds ?? [];
  const state: ChangeVerificationState = builds.length ? "planning" : "awaiting-build";
  return parseChangeVerification({
    schemaVersion: 2,
    id: input.id,
    organizationId: input.organizationId,
    projectId: input.projectId,
    version: 1,
    state,
    change: input.change,
    builds,
    selection: input.selection ?? EMPTY_SELECTION,
    policy: input.policy,
    runIds: [],
    evidenceDigests: [],
    coverageGaps: input.coverageGaps ?? [],
    residualRisk: input.residualRisk ?? [],
    ...(input.smallestNextVerification
      ? { smallestNextVerification: input.smallestNextVerification }
      : {}),
    ...(input.supersedesProofId ? { supersedesProofId: input.supersedesProofId } : {}),
    requestedBy: input.requestedBy,
    updatedBy: input.actorId,
    lastMutation: {
      schemaVersion: 1,
      requestId: input.requestId,
      requestDigest: input.requestDigest,
      action: input.action ?? "start",
      actorId: input.actorId,
      proofId: input.id,
      previousVersion: 0,
      version: 1,
      at: input.at,
    },
    createdAt: input.at,
    updatedAt: input.at,
  });
}

function advancedProof(
  current: ChangeVerification,
  input: AdvanceChangeVerificationInput,
): ChangeVerification {
  if (!ALLOWED_TRANSITIONS[current.state].includes(input.state)) {
    throw new ChangeVerificationConflictError(
      "PROOF_IMMUTABLE",
      `cannot move Change Verification from ${current.state} to ${input.state}`,
    );
  }
  if (input.at < current.updatedAt) {
    throw new ChangeVerificationConflictError(
      "PROOF_IMMUTABLE",
      "Proof updates cannot move backwards in time",
    );
  }
  const planCanChange =
    current.runIds.length === 0 &&
    current.evidenceDigests.length === 0 &&
    current.state !== "ready" &&
    current.state !== "running-pilot" &&
    current.state !== "awaiting-expansion" &&
    current.state !== "running";
  if (
    !planCanChange &&
    ((input.builds && !sameValue(input.builds, current.builds)) ||
      (input.selection && !sameValue(input.selection, current.selection)) ||
      (input.policy && !sameValue(input.policy, current.policy)))
  ) {
    throw new ChangeVerificationConflictError(
      "PROOF_IMMUTABLE",
      "the approved Verification Plan is frozen once execution is ready",
    );
  }
  if (
    current.planApproval &&
    input.planApproval !== undefined &&
    input.planApproval !== null &&
    !sameValue(input.planApproval, current.planApproval)
  ) {
    throw new ChangeVerificationConflictError(
      "PROOF_IMMUTABLE",
      "Verification Plan approval provenance is immutable once recorded",
    );
  }
  const runIds = input.runIds ?? current.runIds;
  const evidenceDigests = input.evidenceDigests ?? current.evidenceDigests;
  assertAppendOnly(current.runIds, runIds, "runIds");
  assertAppendOnly(current.evidenceDigests, evidenceDigests, "evidenceDigests");
  if (
    current.firstCausalFailure &&
    input.firstCausalFailure !== undefined &&
    !sameValue(input.firstCausalFailure, current.firstCausalFailure)
  ) {
    throw new ChangeVerificationConflictError(
      "PROOF_IMMUTABLE",
      "the first causal failure is immutable once recorded",
    );
  }
  const next = parseChangeVerification({
    ...current,
    version: current.version + 1,
    state: input.state,
    builds: input.builds ?? current.builds,
    selection: input.selection ?? current.selection,
    planApproval:
      input.planApproval === null ? undefined : (input.planApproval ?? current.planApproval),
    cancellation: input.cancellation,
    policy: input.policy ?? current.policy,
    runIds,
    evidenceDigests,
    decision: decisionForState(input.state),
    firstCausalFailure:
      input.firstCausalFailure === null
        ? undefined
        : (input.firstCausalFailure ?? current.firstCausalFailure),
    coverageGaps: input.coverageGaps ?? current.coverageGaps,
    residualRisk: input.residualRisk ?? current.residualRisk,
    smallestNextVerification:
      input.smallestNextVerification === null
        ? undefined
        : (input.smallestNextVerification ?? current.smallestNextVerification),
    updatedBy: input.actorId,
    lastMutation: {
      schemaVersion: 1,
      requestId: input.requestId,
      requestDigest: input.requestDigest,
      action: input.action,
      actorId: input.actorId,
      proofId: current.id,
      previousVersion: current.version,
      version: current.version + 1,
      at: input.at,
    },
    updatedAt: input.at,
  });
  if (
    next.state === "ready" ||
    next.state === "running-pilot" ||
    next.state === "awaiting-expansion" ||
    next.state === "running" ||
    next.state === "proved"
  ) {
    assertExecutablePlan(next);
  }
  return next;
}

export async function createChangeVerification(
  input: CreateChangeVerificationInput,
): Promise<ChangeVerification> {
  const proof = initialProof(input);
  return withControlStore((store) => {
    if (!store.insertChangeVerification(proof)) {
      throw new ChangeVerificationConflictError(
        "PROOF_EXISTS",
        "Change Verification already exists",
      );
    }
    return proof;
  });
}

export async function readChangeVerification(
  scope: ChangeVerificationScope,
  proofId: string,
): Promise<ChangeVerification | undefined> {
  return readControlStore((store) => {
    const raw = store.changeVerification(proofId);
    if (!raw) return undefined;
    const proof = parseChangeVerification(raw);
    return belongsToScope(proof, scope) ? proof : undefined;
  });
}

export async function readChangeVerificationHistory(
  scope: ChangeVerificationScope,
  proofId: string,
): Promise<ChangeVerification[]> {
  return readControlStore((store) => {
    const proofs = store.changeVerificationVersions(proofId).map(parseChangeVerification);
    if (proofs.length && !belongsToScope(proofs[0]!, scope)) return [];
    return proofs;
  });
}

export async function listChangeVerifications(
  scope: ChangeVerificationScope,
): Promise<ChangeVerification[]> {
  return readControlStore((store) =>
    store.changeVerifications(scope.organizationId, scope.projectId).map(parseChangeVerification),
  );
}

export async function advanceChangeVerification(
  input: AdvanceChangeVerificationInput,
): Promise<ChangeVerification> {
  return withControlStore((store) => {
    const raw = store.changeVerification(input.proofId);
    if (!raw) throw new ChangeVerificationNotFoundError();
    const current = parseChangeVerification(raw);
    assertScope(current, input);
    if (current.version !== input.expectedVersion) {
      throw new ChangeVerificationConflictError(
        "PROOF_STALE",
        "Change Verification version is stale",
      );
    }
    const next = advancedProof(current, input);
    const result = store.appendChangeVerification(input.expectedVersion, next);
    if (result === "missing") throw new ChangeVerificationNotFoundError();
    if (result === "stale") {
      throw new ChangeVerificationConflictError(
        "PROOF_STALE",
        "Change Verification version is stale",
      );
    }
    return next;
  });
}

export async function supersedeChangeVerification(
  input: SupersedeChangeVerificationInput,
): Promise<{ previous: ChangeVerification; replacement: ChangeVerification }> {
  return withControlStore((store) => {
    const raw = store.changeVerification(input.proofId);
    if (!raw) throw new ChangeVerificationNotFoundError();
    const current = parseChangeVerification(raw);
    assertScope(current, input);
    if (current.version !== input.expectedVersion) {
      throw new ChangeVerificationConflictError(
        "PROOF_STALE",
        "Change Verification version is stale",
      );
    }
    if (current.state === "superseded") {
      throw new ChangeVerificationConflictError(
        "PROOF_IMMUTABLE",
        "Change Verification is already superseded",
      );
    }
    if (
      input.replacement.change.repository !== current.change.repository ||
      input.replacement.change.baseSha !== current.change.headSha ||
      input.replacement.change.headSha === current.change.headSha
    ) {
      throw new ChangeVerificationConflictError(
        "PROOF_IMMUTABLE",
        "a replacement must continue the same repository from the exact prior head",
      );
    }
    const replacement = initialProof({
      ...input.replacement,
      organizationId: input.organizationId,
      projectId: input.projectId,
      supersedesProofId: current.id,
      requestId: input.requestId,
      requestDigest: input.requestDigest,
      action: "rerun-affected",
    });
    if (!store.insertChangeVerification(replacement)) {
      throw new ChangeVerificationConflictError("PROOF_EXISTS", "replacement Proof already exists");
    }
    const previous = parseChangeVerification({
      ...current,
      version: current.version + 1,
      state: "superseded",
      decision: undefined,
      supersededByProofId: replacement.id,
      updatedBy: input.actorId,
      lastMutation: {
        schemaVersion: 1,
        requestId: input.requestId,
        requestDigest: input.requestDigest,
        action: "rerun-affected",
        actorId: input.actorId,
        proofId: current.id,
        previousVersion: current.version,
        version: current.version + 1,
        at: input.at,
      },
      updatedAt: input.at,
    });
    const result = store.appendChangeVerification(input.expectedVersion, previous);
    if (result === "missing") throw new ChangeVerificationNotFoundError();
    if (result === "stale") {
      throw new ChangeVerificationConflictError(
        "PROOF_STALE",
        "Change Verification version is stale",
      );
    }
    return { previous, replacement };
  });
}

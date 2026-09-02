import {
  changeMergeBaseSha,
  changeTestedSha,
  materializeChangeRef,
  type ChangeVerification,
  type ChangeVerificationDecision,
  type ChangeVerificationMutation,
  type ChangeVerificationState,
} from "@relay/protocol";
import { readControlStore, withControlStore } from "./collaboration-store.js";
import {
  materializeChangeVerificationIntegrity,
  verifyDurableChangeVerification,
} from "./change-proof-integrity.js";
import {
  providerCheckForStoredChangeProof,
  providerProgressCheckForStoredChangeProof,
} from "./change-proof-decision.js";
import { enqueueChangeProofPublicationOutboxInStore } from "./change-proof-publication-outbox.js";
import { canonicalSha256 } from "./canonical-json.js";

export type ChangeProofPublicationRequest = {
  provider: "github";
  detailsUrl?: string;
  maxAttempts?: number;
};

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
    publication?: ChangeProofPublicationRequest;
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
  publication?: ChangeProofPublicationRequest;
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
  publication?: ChangeProofPublicationRequest;
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

function changeAssociationDigest(change: ChangeVerification["change"]): string {
  const canonical = materializeChangeRef(change);
  return canonicalSha256({
    repository: canonical.repository,
    pullRequest: canonical.pullRequest ?? null,
    repositoryId: canonical.repositoryId ?? null,
    provider: canonical.provider ?? null,
    targetBranch: canonical.targetBranch ?? null,
    testedKind: canonical.testedKind,
    mergeGroupId: canonical.mergeGroupId ?? null,
    agentClaim: canonical.agentClaim ?? null,
  });
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

function enqueueProofPublication(
  store: Parameters<typeof enqueueChangeProofPublicationOutboxInStore>[0],
  proof: ChangeVerification,
  publication: ChangeProofPublicationRequest | undefined,
): void {
  if (!publication) return;
  const terminal = [
    "proved",
    "rejected",
    "needs-review",
    "insufficient-evidence",
    "cancelled",
    "superseded",
  ].includes(proof.state);
  const active = [
    "planning",
    "awaiting-build",
    "ready",
    "running-pilot",
    "awaiting-expansion",
    "running",
  ].includes(proof.state);
  if (!terminal && !active) return;
  const check = (
    terminal ? providerCheckForStoredChangeProof : providerProgressCheckForStoredChangeProof
  )({
    proof,
    ...(publication.detailsUrl ? { detailsUrl: publication.detailsUrl } : {}),
  });
  enqueueChangeProofPublicationOutboxInStore(store, {
    organizationId: proof.organizationId,
    projectId: proof.projectId,
    proofId: proof.id,
    proofVersion: proof.version,
    provider: publication.provider,
    repository: proof.change.repository,
    headSha: changeTestedSha(proof.change),
    externalId: proof.id,
    check,
    ...(publication.maxAttempts ? { maxAttempts: publication.maxAttempts } : {}),
    createdAt: proof.updatedAt,
  });
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
    proof.selection.affectedJourneys.some(({ appMapRevision }) => appMapRevision === undefined) ||
    !proof.selection.targetCases.length ||
    !proof.selection.cells?.length ||
    !proof.selection.pilotCellId
  ) {
    throw new ChangeVerificationConflictError(
      "PROOF_IMMUTABLE",
      `state ${proof.state} requires exact builds, App Map revisions, affected journeys, target cases, Verification Cells, and an explicit pilot`,
    );
  }
}

function initialProof(input: CreateChangeVerificationInput): ChangeVerification {
  const builds = input.builds ?? [];
  const state: ChangeVerificationState = builds.length ? "planning" : "awaiting-build";
  return materializeChangeVerificationIntegrity({
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
  const sameRunningRecord =
    current.state === "running" && input.state === "running" && input.action === "record-runs";
  if (!ALLOWED_TRANSITIONS[current.state].includes(input.state) && !sameRunningRecord) {
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
  const entersExecutableState =
    input.state === "ready" ||
    input.state === "running-pilot" ||
    input.state === "awaiting-expansion" ||
    input.state === "running" ||
    input.state === "proved";
  const effectiveSelection = input.selection ?? current.selection;
  if (
    entersExecutableState &&
    effectiveSelection.affectedJourneys.some(({ appMapRevision }) => appMapRevision === undefined)
  ) {
    throw new ChangeVerificationConflictError(
      "PROOF_IMMUTABLE",
      `state ${input.state} requires one exact App Map revision for every affected journey`,
    );
  }
  const planChanged =
    (input.builds !== undefined && !sameValue(input.builds, current.builds)) ||
    (input.selection !== undefined && !sameValue(input.selection, current.selection));
  const policyChanged = input.policy !== undefined && !sameValue(input.policy, current.policy);
  const terminalDecision =
    input.state === "proved" ||
    input.state === "rejected" ||
    input.state === "needs-review" ||
    input.state === "insufficient-evidence";
  const next = materializeChangeVerificationIntegrity({
    ...current,
    version: current.version + 1,
    state: input.state,
    builds: input.builds ?? current.builds,
    selection: input.selection ?? current.selection,
    planApproval:
      input.planApproval === null ? undefined : (input.planApproval ?? current.planApproval),
    cancellation: input.cancellation,
    policy: input.policy ?? current.policy,
    ...(planChanged ? { planDigest: undefined } : {}),
    ...(policyChanged ? { policyDigest: undefined } : {}),
    ...(!terminalDecision ? { decisionDigest: undefined } : {}),
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
    enqueueProofPublication(store, proof, input.publication);
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
    const proof = verifyDurableChangeVerification(raw);
    return belongsToScope(proof, scope) ? proof : undefined;
  });
}

export async function readChangeVerificationHistory(
  scope: ChangeVerificationScope,
  proofId: string,
): Promise<ChangeVerification[]> {
  return readControlStore((store) => {
    const proofs = store.changeVerificationVersions(proofId).map(verifyDurableChangeVerification);
    if (proofs.length && !belongsToScope(proofs[0]!, scope)) return [];
    return proofs;
  });
}

export async function listChangeVerifications(
  scope: ChangeVerificationScope,
): Promise<ChangeVerification[]> {
  return readControlStore((store) =>
    store
      .changeVerifications(scope.organizationId, scope.projectId)
      .map(verifyDurableChangeVerification),
  );
}

export async function advanceChangeVerification(
  input: AdvanceChangeVerificationInput,
): Promise<ChangeVerification> {
  return withControlStore((store) => {
    const raw = store.changeVerification(input.proofId);
    if (!raw) throw new ChangeVerificationNotFoundError();
    const current = verifyDurableChangeVerification(raw);
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
    enqueueProofPublication(store, next, input.publication);
    return next;
  });
}

export async function supersedeChangeVerification(
  input: SupersedeChangeVerificationInput,
): Promise<{ previous: ChangeVerification; replacement: ChangeVerification }> {
  return withControlStore((store) => {
    const raw = store.changeVerification(input.proofId);
    if (!raw) throw new ChangeVerificationNotFoundError();
    const current = verifyDurableChangeVerification(raw);
    assertScope(current, input);
    if (current.version !== input.expectedVersion) {
      throw new ChangeVerificationConflictError(
        "PROOF_STALE",
        "Change Verification version is stale",
      );
    }
    if (!["proved", "rejected", "needs-review", "insufficient-evidence"].includes(current.state)) {
      throw new ChangeVerificationConflictError(
        "PROOF_IMMUTABLE",
        "Only a completed Proof can be superseded for an affected-case rerun",
      );
    }
    const priorTestedSha = changeTestedSha(current.change);
    // New ChangeRefs name the superseded revision explicitly, while legacy
    // callers represented the same continuation as baseSha/mergeBaseSha.
    const replacementPreviousSha =
      input.replacement.change.previousHeadSha ?? changeMergeBaseSha(input.replacement.change);
    const replacementTestedSha = changeTestedSha(input.replacement.change);
    const replacementChange = materializeChangeRef(input.replacement.change);
    const continuesSameChange =
      changeAssociationDigest(replacementChange) === changeAssociationDigest(current.change);
    const repeatsUncertainRevision =
      (current.state === "needs-review" || current.state === "insufficient-evidence") &&
      replacementTestedSha === priorTestedSha &&
      canonicalSha256(replacementChange) === canonicalSha256(current.change);
    if (
      !continuesSameChange ||
      (replacementPreviousSha !== priorTestedSha && !repeatsUncertainRevision) ||
      (replacementTestedSha === priorTestedSha && !repeatsUncertainRevision)
    ) {
      throw new ChangeVerificationConflictError(
        "PROOF_IMMUTABLE",
        "a replacement must preserve the source-change association and continue from the exact prior head; only an uncertain or insufficient Proof may repeat that tested revision",
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
    const previous = materializeChangeVerificationIntegrity({
      ...current,
      version: current.version + 1,
      state: "superseded",
      decision: undefined,
      decisionDigest: undefined,
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
    enqueueProofPublication(store, previous, input.publication);
    enqueueProofPublication(store, replacement, input.publication);
    return { previous, replacement };
  });
}

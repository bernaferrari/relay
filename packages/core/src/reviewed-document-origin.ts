import { randomUUID } from "node:crypto";
import type {
  ActorIdentity,
  AppMap,
  LogicalScrollSurface,
  ReviewedDocumentOriginActor,
  ReviewedDocumentOriginApproval,
  ReviewedDocumentOriginBinding,
  ReviewedDocumentOriginExecutionReference,
  ReviewedDocumentOriginInspection,
  ReviewedDocumentOriginLedger,
  ReviewedDocumentOriginProjection,
  ReviewedDocumentOriginRevocation,
  ScrollSurfaceViewport,
} from "@relay/protocol";
import {
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
} from "@relay/protocol";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import { readAppMap } from "./collaboration.js";
import { readControlStore, withControlStore } from "./collaboration-store.js";
import { publish } from "./events.js";
import {
  issueReviewedDocumentOriginProjectionAuthorization,
  reviewedDocumentOriginProjectionAuthorizationIsValid,
} from "./reviewed-document-origin-authority.js";
import {
  canonicalReviewedDocumentOriginBinding,
  reviewedDocumentOriginAppMapDigest,
  reviewedDocumentOriginApprovalEvidenceIsValid,
  reviewedDocumentOriginApprovalPayload,
  reviewedDocumentOriginEvidenceIsComplete,
  reviewedDocumentOriginRawEvidenceIsValid,
  reviewedDocumentOriginRevocationPayload,
  sameReviewedDocumentOriginEvidence,
} from "./reviewed-document-origin-evidence.js";
import {
  issueReviewedDocumentOriginActivationLedger,
  issueReviewedDocumentOriginRevocationLedger,
  reviewedDocumentOriginLedgerHistory,
  reviewedDocumentOriginLedgerHistoryIsActive,
  reviewedDocumentOriginLedgerHistoryIsRevoked,
  reviewedDocumentOriginRevocationTombstoneIsValid,
} from "./reviewed-document-origin-ledger.js";

export {
  reviewedDocumentOriginAppMapDigest,
  reviewedDocumentOriginRawEvidenceIsValid,
} from "./reviewed-document-origin-evidence.js";

export class ReviewedDocumentOriginError extends Error {
  constructor(
    readonly code:
      | "missing-reference"
      | "revision-conflict"
      | "scope-mismatch"
      | "unsupported-platform"
      | "invalid-evidence"
      | "not-found",
    message: string,
  ) {
    super(message);
    this.name = "ReviewedDocumentOriginError";
  }
}

type SurfaceSelection = {
  screenId: string;
  variantId: string;
  captureId: string;
  surface: LogicalScrollSurface;
  variant: AppMap["screenVariants"][string];
};

function appMapKey(projectId: string, appMapId: string): string {
  return `${projectId}:${appMapId}`;
}

function publishReviewedOriginChange(map: AppMap, at: number): void {
  // The sidecar deliberately does not alter portable App Map JSON or its
  // revision, but connected clients still need a durable refresh signal.
  publish({
    type: "resource.updated",
    at,
    projectId: map.projectId,
    resource: "app-map",
    resourceId: map.id,
    revision: map.revision,
  });
}

function sameBinding(
  left: ReviewedDocumentOriginBinding,
  right: ReviewedDocumentOriginBinding,
): boolean {
  return (
    JSON.stringify(canonicalReviewedDocumentOriginBinding(left)) ===
    JSON.stringify(canonicalReviewedDocumentOriginBinding(right))
  );
}

function canonicalProjection(projection: ReviewedDocumentOriginProjection): object {
  return {
    schemaVersion: projection.schemaVersion,
    id: projection.id,
    binding: canonicalReviewedDocumentOriginBinding(projection.binding),
    approval: projection.approval,
    authorization: projection.authorization,
  };
}

function sameProjection(
  left: ReviewedDocumentOriginProjection,
  right: ReviewedDocumentOriginProjection,
): boolean {
  return JSON.stringify(canonicalProjection(left)) === JSON.stringify(canonicalProjection(right));
}

function requireText(value: unknown, field: string, limit: number): string {
  if (typeof value !== "string") {
    throw new ReviewedDocumentOriginError("scope-mismatch", `${field} is required`);
  }
  const text = value.trim();
  if (!text) throw new ReviewedDocumentOriginError("scope-mismatch", `${field} is required`);
  if (text.length > limit) {
    throw new ReviewedDocumentOriginError("scope-mismatch", `${field} exceeds ${limit} characters`);
  }
  return text;
}

function manualActor(actor: ActorIdentity): ReviewedDocumentOriginActor {
  if (actor.actorKind !== "human" && actor.actorKind !== "agent") {
    throw new ReviewedDocumentOriginError(
      "scope-mismatch",
      "Only a human or deliberate agent can create or revoke reviewed-origin authority",
    );
  }
  return { actorId: requireText(actor.actorId, "actor", 128), actorKind: actor.actorKind };
}

function reviewAssertion(value: unknown): typeof REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION {
  if (value !== REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION) {
    throw new ReviewedDocumentOriginError(
      "scope-mismatch",
      `review assertion must be exactly ${REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION}`,
    );
  }
  return REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION;
}

function revokeAssertion(value: unknown): typeof REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION {
  if (value !== REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION) {
    throw new ReviewedDocumentOriginError(
      "scope-mismatch",
      `revoke assertion must be exactly ${REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION}`,
    );
  }
  return REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION;
}

function manualConfirmation(value: unknown): typeof REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION {
  if (value !== REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION) {
    throw new ReviewedDocumentOriginError(
      "scope-mismatch",
      `reviewed-origin confirmation must be exactly ${REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION}`,
    );
  }
  return REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION;
}

function selectSurface(
  map: AppMap,
  input: { screenId: string; variantId: string; captureId: string },
): SurfaceSelection {
  const screen = map.screens[input.screenId];
  const variant = map.screenVariants[input.variantId];
  if (
    !screen ||
    !variant ||
    variant.screenId !== input.screenId ||
    !screen.variantIds.includes(variant.id)
  ) {
    throw new ReviewedDocumentOriginError(
      "missing-reference",
      `Screen ${input.screenId} does not own variant ${input.variantId}`,
    );
  }
  const surface = variant.scrollSurfaces?.find((item) => item.captureId === input.captureId);
  if (!surface) {
    throw new ReviewedDocumentOriginError(
      "missing-reference",
      `Scroll capture ${input.captureId} does not exist on ${input.variantId}`,
    );
  }
  return { ...input, surface, variant };
}

function bindingForSelection(
  map: AppMap,
  selection: SurfaceSelection,
  mapEpoch: string,
): ReviewedDocumentOriginBinding {
  const { surface, variant } = selection;
  if (variant.targetProfile.platform !== "android") {
    throw new ReviewedDocumentOriginError(
      "unsupported-platform",
      "Reviewed document origins currently support Android only",
    );
  }
  const first = surface.viewports[0];
  if (
    surface.targetProfileId !== variant.targetProfile.id ||
    surface.status !== "completed" ||
    surface.reason !== "end-of-content" ||
    !surface.restoredStartViewport ||
    !first ||
    first.index !== 0 ||
    first.offsetY !== 0 ||
    first.appendedHeight !== 0 ||
    !Number.isSafeInteger(first.capturedAt) ||
    !Number.isSafeInteger(first.width) ||
    !Number.isSafeInteger(first.height) ||
    first.width <= 0 ||
    first.height <= 0 ||
    !reviewedDocumentOriginEvidenceIsComplete(first.screenshot, "image/png") ||
    !reviewedDocumentOriginEvidenceIsComplete(first.accessibilityTree, "application/json")
  ) {
    throw new ReviewedDocumentOriginError(
      "invalid-evidence",
      "A reviewed origin requires a completed, restored surface with a complete zero-offset first PNG/tree pair",
    );
  }
  return {
    schemaVersion: 1,
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
    appMapRevision: map.revision,
    appMapDigest: reviewedDocumentOriginAppMapDigest(map),
    mapEpoch,
    screenId: selection.screenId,
    variantId: selection.variantId,
    surfaceId: surface.id,
    captureId: surface.captureId,
    targetProfileId: variant.targetProfile.id,
    platform: "android",
    firstViewport: {
      index: 0,
      offsetY: 0,
      appendedHeight: 0,
      capturedAt: first.capturedAt,
      width: first.width,
      height: first.height,
      screenshot: { ...first.screenshot, mime: "image/png" },
      accessibilityTree: { ...first.accessibilityTree, mime: "application/json" },
    },
  };
}

function bindingMatchesMap(
  map: AppMap,
  binding: ReviewedDocumentOriginBinding,
  mapEpoch: string | undefined,
): boolean {
  if (
    binding.schemaVersion !== 1 ||
    binding.organizationId !== map.organizationId ||
    binding.projectId !== map.projectId ||
    binding.appMapId !== map.id ||
    binding.appMapRevision !== map.revision ||
    binding.appMapDigest !== reviewedDocumentOriginAppMapDigest(map) ||
    !mapEpoch ||
    binding.mapEpoch !== mapEpoch ||
    binding.platform !== "android"
  ) {
    return false;
  }
  try {
    const selection = selectSurface(map, binding);
    const expected = bindingForSelection(map, selection, mapEpoch);
    return sameBinding(binding, expected);
  } catch {
    return false;
  }
}

type StoredLedgerEvents = {
  events: ReviewedDocumentOriginLedger[];
  revocationTombstone?: ReviewedDocumentOriginLedger;
};

/** Synchronous structural check for conflict detection inside the SQLite
 * write transaction. Runtime authorization below also verifies every HMAC and
 * immutable evidence blob before treating an active event as authority. */
function activeLedgerFor(
  projection: ReviewedDocumentOriginProjection,
  stored: StoredLedgerEvents | undefined,
): ReviewedDocumentOriginLedger | undefined {
  const history = stored && reviewedDocumentOriginLedgerHistory(stored.events);
  if (
    !history ||
    history.state !== "active" ||
    stored.revocationTombstone ||
    history.latest.projectionId !== projection.id
  ) {
    return undefined;
  }
  return history.latest;
}

async function currentMapForBinding(
  binding: ReviewedDocumentOriginBinding,
): Promise<AppMap | undefined> {
  const map = await readAppMap(binding.projectId, binding.appMapId);
  return map?.organizationId === binding.organizationId ? map : undefined;
}

async function exactStoredProjection(
  projection: ReviewedDocumentOriginProjection,
): Promise<{ map: AppMap; mapEpoch: string; ledger: ReviewedDocumentOriginLedger } | undefined> {
  const map = await currentMapForBinding(projection.binding);
  if (!map) return undefined;
  const state = await readControlStore((store) => ({
    mapEpoch: store.reviewedDocumentOriginMapEpoch(appMapKey(map.projectId, map.id)),
    projection: store.reviewedDocumentOriginProjection(projection.id),
    events: store.reviewedDocumentOriginLedgerEvents(projection.id),
    revocationTombstone: store.reviewedDocumentOriginRevocationTombstone(projection.id),
  }));
  const ledger = await reviewedDocumentOriginLedgerHistoryIsActive({
    projection,
    events: state.events,
    revocationTombstone: state.revocationTombstone,
  });
  if (
    !state.mapEpoch ||
    !state.projection ||
    !sameProjection(state.projection, projection) ||
    !bindingMatchesMap(map, projection.binding, state.mapEpoch) ||
    !ledger
  ) {
    return undefined;
  }
  return { map, mapEpoch: state.mapEpoch, ledger };
}

async function projectionIsActiveAndUsable(
  projection: ReviewedDocumentOriginProjection,
  expectedMap?: AppMap,
): Promise<boolean> {
  try {
    const stored = await exactStoredProjection(projection);
    if (
      !stored ||
      (expectedMap && !bindingMatchesMap(expectedMap, projection.binding, stored.mapEpoch))
    ) {
      return false;
    }
    return Boolean(
      (await reviewedDocumentOriginProjectionAuthorizationIsValid(projection)) &&
      (await reviewedDocumentOriginApprovalEvidenceIsValid(projection)) &&
      (await reviewedDocumentOriginRawEvidenceIsValid(projection.binding)),
    );
  } catch {
    return false;
  }
}

function matchingCurrentProjection(
  projections: ReviewedDocumentOriginProjection[],
  ledgers: Map<string, StoredLedgerEvents>,
  binding: ReviewedDocumentOriginBinding,
):
  | { projection: ReviewedDocumentOriginProjection; ledger: ReviewedDocumentOriginLedger }
  | undefined {
  for (const projection of projections) {
    const ledger = activeLedgerFor(projection, ledgers.get(projection.id));
    if (sameBinding(projection.binding, binding) && ledger) {
      return { projection, ledger };
    }
  }
  return undefined;
}

export async function reviewDocumentOrigin(input: {
  appMap: AppMap;
  screenId: string;
  variantId: string;
  captureId: string;
  expectedRevision: number;
  actor: ActorIdentity;
  reason: string;
  assertion: string;
  confirmation: string;
  at?: number;
}): Promise<{
  projection: ReviewedDocumentOriginProjection;
  ledger: ReviewedDocumentOriginLedger;
  alreadyActive: boolean;
}> {
  if (input.appMap.revision !== input.expectedRevision) {
    throw new ReviewedDocumentOriginError(
      "revision-conflict",
      `Expected App Map revision ${input.expectedRevision}, current revision is ${input.appMap.revision}`,
    );
  }
  const at = input.at ?? Date.now();
  const approvalBase: Omit<ReviewedDocumentOriginApproval, "evidence"> = {
    actor: manualActor(input.actor),
    reason: requireText(input.reason, "reason", 1_000),
    assertion: reviewAssertion(input.assertion),
    confirmation: manualConfirmation(input.confirmation),
    at,
  };
  const mapKey = appMapKey(input.appMap.projectId, input.appMap.id);
  const mapEpoch = await withControlStore((store) =>
    store.ensureReviewedDocumentOriginMapEpoch(mapKey, randomUUID(), at),
  );
  const selection = selectSurface(input.appMap, input);
  const binding = bindingForSelection(input.appMap, selection, mapEpoch);
  if (!(await reviewedDocumentOriginRawEvidenceIsValid(binding))) {
    throw new ReviewedDocumentOriginError(
      "invalid-evidence",
      "The first raw PNG/tree pair is missing, corrupt, or no longer inspectable",
    );
  }
  const current = await readAppMap(input.appMap.projectId, input.appMap.id);
  if (!current || reviewedDocumentOriginAppMapDigest(current) !== binding.appMapDigest) {
    throw new ReviewedDocumentOriginError(
      "revision-conflict",
      "The App Map changed while this origin was being reviewed; reload and inspect it again",
    );
  }
  const existing = await readControlStore((store) => {
    const projections = store.reviewedDocumentOriginProjections(mapKey);
    const ledgers = new Map(
      projections.map((item) => [
        item.id,
        {
          events: store.reviewedDocumentOriginLedgerEvents(item.id),
          revocationTombstone: store.reviewedDocumentOriginRevocationTombstone(item.id),
        },
      ]),
    );
    return matchingCurrentProjection(projections, ledgers, binding);
  });
  if (existing) {
    if (await projectionIsActiveAndUsable(existing.projection, input.appMap)) {
      return { ...existing, alreadyActive: true };
    }
    throw new ReviewedDocumentOriginError(
      "scope-mismatch",
      "The existing reviewed-origin lifecycle fails immutable authorization checks and cannot be reactivated",
    );
  }

  const projectionId = `reviewed-origin-${randomUUID()}`;
  const approvalEvidence = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt: at,
    data: JSON.stringify(
      reviewedDocumentOriginApprovalPayload({ id: projectionId, binding, approval: approvalBase }),
    ),
    mime: "application/json",
  });
  if (!approvalEvidence.sha256 || approvalEvidence.bytes === undefined) {
    throw new Error("Reviewed document-origin approval evidence has no immutable digest");
  }
  const unsignedProjection = {
    schemaVersion: 1 as const,
    id: projectionId,
    binding,
    approval: {
      ...approvalBase,
      evidence: {
        id: approvalEvidence.id,
        uri: approvalEvidence.uri,
        sha256: approvalEvidence.sha256,
        mime: "application/json" as const,
        bytes: approvalEvidence.bytes,
      },
    },
  };
  const projection: ReviewedDocumentOriginProjection = {
    ...unsignedProjection,
    authorization: await issueReviewedDocumentOriginProjectionAuthorization(unsignedProjection),
  };
  const { pending, active: ledger } = await issueReviewedDocumentOriginActivationLedger({
    projectionId,
    at,
  });
  const result = await withControlStore((store) => {
    const currentMap = store.appMap(mapKey);
    const currentEpoch = store.reviewedDocumentOriginMapEpoch(mapKey);
    if (
      !currentMap ||
      !currentEpoch ||
      !bindingMatchesMap(currentMap, binding, currentEpoch) ||
      currentEpoch !== binding.mapEpoch
    ) {
      throw new ReviewedDocumentOriginError(
        "revision-conflict",
        "The App Map changed while this origin was being reviewed; reload and inspect it again",
      );
    }
    const projections = store.reviewedDocumentOriginProjections(mapKey);
    const ledgers = new Map(
      projections.map((item) => [
        item.id,
        {
          events: store.reviewedDocumentOriginLedgerEvents(item.id),
          revocationTombstone: store.reviewedDocumentOriginRevocationTombstone(item.id),
        },
      ]),
    );
    const active = matchingCurrentProjection(projections, ledgers, binding);
    if (active) return { ...active, alreadyActive: true };
    store.insertReviewedDocumentOriginProjection(mapKey, projection);
    store.appendReviewedDocumentOriginLedgerEvent(mapKey, binding.mapEpoch, pending);
    store.appendReviewedDocumentOriginLedgerEvent(mapKey, binding.mapEpoch, ledger);
    publishReviewedOriginChange(currentMap, at);
    return { projection, ledger, alreadyActive: false };
  });
  if (
    result.alreadyActive &&
    !(await projectionIsActiveAndUsable(result.projection, input.appMap))
  ) {
    throw new ReviewedDocumentOriginError(
      "scope-mismatch",
      "The existing reviewed-origin lifecycle fails immutable authorization checks and cannot be reactivated",
    );
  }
  return result;
}

export async function revokeReviewedDocumentOrigin(input: {
  appMap: AppMap;
  screenId: string;
  variantId: string;
  captureId: string;
  projectionId: string;
  expectedRevision: number;
  actor: ActorIdentity;
  reason: string;
  assertion: string;
  confirmation: string;
  at?: number;
}): Promise<{
  projection: ReviewedDocumentOriginProjection;
  ledger: ReviewedDocumentOriginLedger;
  alreadyRevoked: boolean;
}> {
  if (input.appMap.revision !== input.expectedRevision) {
    throw new ReviewedDocumentOriginError(
      "revision-conflict",
      `Expected App Map revision ${input.expectedRevision}, current revision is ${input.appMap.revision}`,
    );
  }
  // Resolve current user intent before reading an older projection. A removed
  // capture cannot be accidentally revoked through a mismatched path.
  selectSurface(input.appMap, input);
  const at = input.at ?? Date.now();
  const decisionBase: Omit<ReviewedDocumentOriginRevocation, "evidence"> = {
    actor: manualActor(input.actor),
    reason: requireText(input.reason, "reason", 1_000),
    assertion: revokeAssertion(input.assertion),
    confirmation: manualConfirmation(input.confirmation),
    at,
  };
  const mapKey = appMapKey(input.appMap.projectId, input.appMap.id);
  const existing = await readControlStore((store) => ({
    projection: store.reviewedDocumentOriginProjection(input.projectionId),
    events: store.reviewedDocumentOriginLedgerEvents(input.projectionId),
    revocationTombstone: store.reviewedDocumentOriginRevocationTombstone(input.projectionId),
  }));
  if (
    !existing.projection ||
    existing.projection.binding.projectId !== input.appMap.projectId ||
    existing.projection.binding.appMapId !== input.appMap.id ||
    existing.projection.binding.screenId !== input.screenId ||
    existing.projection.binding.variantId !== input.variantId ||
    existing.projection.binding.captureId !== input.captureId ||
    !existing.events.length
  ) {
    throw new ReviewedDocumentOriginError(
      "not-found",
      `Reviewed origin ${input.projectionId} not found`,
    );
  }
  const history = reviewedDocumentOriginLedgerHistory(existing.events);
  const alreadyRevoked = await reviewedDocumentOriginLedgerHistoryIsRevoked({
    projection: existing.projection,
    events: existing.events,
    revocationTombstone: existing.revocationTombstone,
  });
  if (alreadyRevoked) {
    return { projection: existing.projection, ledger: alreadyRevoked, alreadyRevoked: true };
  }
  const tombstone = await reviewedDocumentOriginRevocationTombstoneIsValid({
    projection: existing.projection,
    tombstone: existing.revocationTombstone,
  });
  if (tombstone) {
    return { projection: existing.projection, ledger: tombstone, alreadyRevoked: true };
  }
  const activeLedger = await reviewedDocumentOriginLedgerHistoryIsActive({
    projection: existing.projection,
    events: existing.events,
    revocationTombstone: existing.revocationTombstone,
  });
  if (!history || history.state !== "active" || !history.active || !activeLedger) {
    throw new ReviewedDocumentOriginError(
      "scope-mismatch",
      "Reviewed origin does not have an active append-only lifecycle to revoke",
    );
  }
  const revocationEvidence = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt: at,
    data: JSON.stringify(
      reviewedDocumentOriginRevocationPayload(existing.projection, decisionBase),
    ),
    mime: "application/json",
  });
  // The immutable payload records the decision and exact signed binding; the
  // ledger then binds that content-addressed blob without a self-hash cycle.
  if (!revocationEvidence.sha256 || revocationEvidence.bytes === undefined) {
    throw new Error("Reviewed document-origin revocation evidence has no immutable digest");
  }
  const revocation: ReviewedDocumentOriginRevocation = {
    ...decisionBase,
    evidence: {
      id: revocationEvidence.id,
      uri: revocationEvidence.uri,
      sha256: revocationEvidence.sha256,
      mime: "application/json",
      bytes: revocationEvidence.bytes,
    },
  };
  const ledger = await issueReviewedDocumentOriginRevocationLedger({
    active: activeLedger,
    revocation,
  });
  return withControlStore((store) => {
    const currentMap = store.appMap(mapKey);
    const current = store.reviewedDocumentOriginProjection(input.projectionId);
    const currentEpoch = store.reviewedDocumentOriginMapEpoch(mapKey);
    const currentEvents = store.reviewedDocumentOriginLedgerEvents(input.projectionId);
    const currentTombstone = store.reviewedDocumentOriginRevocationTombstone(input.projectionId);
    const currentHistory = reviewedDocumentOriginLedgerHistory(currentEvents);
    if (
      !currentMap ||
      currentMap.revision !== input.expectedRevision ||
      !current ||
      !currentEpoch ||
      !sameProjection(current, existing.projection!) ||
      !bindingMatchesMap(currentMap, current.binding, currentEpoch) ||
      currentEpoch !== current.binding.mapEpoch ||
      currentTombstone ||
      !currentHistory ||
      currentHistory.state !== "active" ||
      !currentHistory.active ||
      currentHistory.active.authorization.signature !== activeLedger.authorization.signature
    ) {
      throw new ReviewedDocumentOriginError(
        "revision-conflict",
        "The App Map or reviewed origin changed while revocation was being recorded",
      );
    }
    store.appendReviewedDocumentOriginLedgerEvent(mapKey, current.binding.mapEpoch, ledger);
    store.insertReviewedDocumentOriginRevocationTombstone(mapKey, current.binding.mapEpoch, ledger);
    publishReviewedOriginChange(currentMap, at);
    return { projection: current, ledger, alreadyRevoked: false };
  });
}

export async function inspectReviewedDocumentOrigin(input: {
  appMap: AppMap;
  screenId: string;
  variantId: string;
  captureId: string;
}): Promise<ReviewedDocumentOriginInspection> {
  // Inspection is an audit read, not an authorization attempt. Preserve a
  // revoked/pending lineage even when a later App Map edit removed its capture.
  const key = appMapKey(input.appMap.projectId, input.appMap.id);
  const state = await readControlStore((store) => {
    const projections = store.reviewedDocumentOriginProjections(key).filter((projection) => {
      const binding = projection.binding;
      return (
        binding &&
        binding.screenId === input.screenId &&
        binding.variantId === input.variantId &&
        binding.captureId === input.captureId
      );
    });
    return {
      mapEpoch: store.reviewedDocumentOriginMapEpoch(key),
      projections,
      ledgers: new Map(
        projections.map((projection) => [
          projection.id,
          {
            events: store.reviewedDocumentOriginLedgerEvents(projection.id),
            revocationTombstone: store.reviewedDocumentOriginRevocationTombstone(projection.id),
          },
        ]),
      ),
    };
  });
  return {
    appMapId: input.appMap.id,
    screenId: input.screenId,
    variantId: input.variantId,
    captureId: input.captureId,
    lineage: state.projections.map((projection) => {
      let currentBinding = false;
      try {
        currentBinding = bindingMatchesMap(input.appMap, projection.binding, state.mapEpoch);
      } catch {
        // Local audit rows can outlive a partial disk failure. Inspection
        // remains readable; only authorization needs to fail closed.
      }
      const stored = state.ledgers.get(projection.id);
      const ledgerEvents = stored?.events ?? [];
      const ledger = ledgerEvents.at(-1);
      return {
        projection,
        ...(ledger ? { ledger } : {}),
        ledgerEvents,
        ...(stored?.revocationTombstone ? { revocationTombstone: stored.revocationTombstone } : {}),
        currentBinding,
      };
    }),
  };
}

/** Server compilation supplies only projections it has already re-opened and
 * verified. The pure compiler remains conservative when no local sidecar is
 * provided, and a forged option still fails at runtime against the ledger. */
export function reviewedDocumentOriginReferenceForSurface(input: {
  appMap: AppMap;
  screenId: string;
  variantId: string;
  surface: LogicalScrollSurface;
  projections: readonly ReviewedDocumentOriginProjection[] | undefined;
}): ReviewedDocumentOriginExecutionReference | undefined {
  if (!input.projections?.length) return undefined;
  const first = input.surface.viewports[0];
  if (!first) return undefined;
  const projection = input.projections.find((candidate) => {
    const binding = candidate.binding;
    return (
      binding.organizationId === input.appMap.organizationId &&
      binding.projectId === input.appMap.projectId &&
      binding.appMapId === input.appMap.id &&
      binding.appMapRevision === input.appMap.revision &&
      binding.appMapDigest === reviewedDocumentOriginAppMapDigest(input.appMap) &&
      binding.platform === "android" &&
      binding.screenId === input.screenId &&
      binding.variantId === input.variantId &&
      binding.surfaceId === input.surface.id &&
      binding.captureId === input.surface.captureId &&
      binding.targetProfileId === input.surface.targetProfileId &&
      binding.firstViewport.index === first.index &&
      binding.firstViewport.offsetY === first.offsetY &&
      binding.firstViewport.appendedHeight === first.appendedHeight &&
      binding.firstViewport.capturedAt === first.capturedAt &&
      binding.firstViewport.width === first.width &&
      binding.firstViewport.height === first.height &&
      sameReviewedDocumentOriginEvidence(binding.firstViewport.screenshot, first.screenshot) &&
      sameReviewedDocumentOriginEvidence(
        binding.firstViewport.accessibilityTree,
        first.accessibilityTree,
      )
    );
  });
  return projection ? { schemaVersion: 1, projection: structuredClone(projection) } : undefined;
}

export async function activeReviewedDocumentOriginsForAppMap(
  map: AppMap,
): Promise<ReviewedDocumentOriginProjection[]> {
  const key = appMapKey(map.projectId, map.id);
  const projections = await readControlStore((store) =>
    store.reviewedDocumentOriginProjections(key),
  );
  const usable = await Promise.all(
    projections.map(async (projection) =>
      (await projectionIsActiveAndUsable(projection, map)) ? projection : undefined,
    ),
  );
  return usable.filter((value): value is ReviewedDocumentOriginProjection => value !== undefined);
}

/** Runtime re-check for every capture-surface execution. It requires both a
 * byte-identical local projection and an active local ledger, so revocation or
 * an App Map replacement blocks a recipe compiled minutes earlier. */
export async function reviewedDocumentOriginExecutionReferenceIsActive(input: {
  reference: ReviewedDocumentOriginExecutionReference | undefined;
  origin: ScrollSurfaceViewport;
  targetProfileId: string;
  screenId: string;
  variantId: string;
  surfaceId: string;
  captureId: string;
}): Promise<boolean> {
  const reference = input.reference;
  const projection = reference?.projection;
  const binding = projection?.binding;
  if (
    reference?.schemaVersion !== 1 ||
    !projection ||
    !binding ||
    binding.platform !== "android" ||
    binding.targetProfileId !== input.targetProfileId ||
    binding.screenId !== input.screenId ||
    binding.variantId !== input.variantId ||
    binding.surfaceId !== input.surfaceId ||
    binding.captureId !== input.captureId ||
    input.origin.index !== 0 ||
    input.origin.offsetY !== 0 ||
    input.origin.appendedHeight !== 0 ||
    binding.firstViewport.index !== input.origin.index ||
    binding.firstViewport.offsetY !== input.origin.offsetY ||
    binding.firstViewport.appendedHeight !== input.origin.appendedHeight ||
    binding.firstViewport.capturedAt !== input.origin.capturedAt ||
    binding.firstViewport.width !== input.origin.width ||
    binding.firstViewport.height !== input.origin.height ||
    !sameReviewedDocumentOriginEvidence(
      binding.firstViewport.screenshot,
      input.origin.screenshot,
    ) ||
    !sameReviewedDocumentOriginEvidence(
      binding.firstViewport.accessibilityTree,
      input.origin.accessibilityTree,
    )
  ) {
    return false;
  }
  return projectionIsActiveAndUsable(projection);
}

/** A revoked decision must have readable immutable evidence too; inspection
 * callers can use this diagnostic helper without treating evidence loss as an
 * implicit reactivation. */
export async function reviewedDocumentOriginRevocationEvidenceIsValid(input: {
  projection: ReviewedDocumentOriginProjection;
  ledger: ReviewedDocumentOriginLedger;
}): Promise<boolean> {
  return Boolean(
    await reviewedDocumentOriginRevocationTombstoneIsValid({
      projection: input.projection,
      tombstone: input.ledger,
    }),
  );
}

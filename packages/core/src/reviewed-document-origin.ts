import { randomUUID } from "node:crypto";
import type {
  ActorIdentity,
  AppMap,
  LogicalScrollSurface,
  ReviewedDocumentOriginBinding,
  ReviewedDocumentOriginDecision,
  ReviewedDocumentOriginExecutionReference,
  ReviewedDocumentOriginInspection,
  ReviewedDocumentOriginLedger,
  ReviewedDocumentOriginProjection,
  ScrollSurfaceViewport,
} from "@relay/protocol";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import { readAppMap } from "./collaboration.js";
import { readControlStore, withControlStore } from "./collaboration-store.js";
import { publish } from "./events.js";
import {
  issueReviewedDocumentOriginLedgerAuthorization,
  issueReviewedDocumentOriginProjectionAuthorization,
  reviewedDocumentOriginLedgerAuthorizationIsValid,
  reviewedDocumentOriginProjectionAuthorizationIsValid,
} from "./reviewed-document-origin-authority.js";
import {
  canonicalReviewedDocumentOriginBinding,
  reviewedDocumentOriginAppMapDigest,
  reviewedDocumentOriginApprovalEvidenceIsValid,
  reviewedDocumentOriginApprovalPayload,
  reviewedDocumentOriginEvidenceIsComplete,
  reviewedDocumentOriginRawEvidenceIsValid,
  reviewedDocumentOriginRevocationEvidenceIsValid as revocationEvidenceIsValid,
  reviewedDocumentOriginRevocationPayload,
  sameReviewedDocumentOriginEvidence,
} from "./reviewed-document-origin-evidence.js";

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

function activeLedgerFor(
  projection: ReviewedDocumentOriginProjection,
  ledger: ReviewedDocumentOriginLedger | undefined,
): ledger is ReviewedDocumentOriginLedger {
  return Boolean(
    ledger &&
    ledger.schemaVersion === 1 &&
    ledger.projectionId === projection.id &&
    ledger.status === "active" &&
    Number.isSafeInteger(ledger.createdAt) &&
    Number.isSafeInteger(ledger.activatedAt),
  );
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
    ledger: store.reviewedDocumentOriginLedger(projection.id),
  }));
  if (
    !state.mapEpoch ||
    !state.projection ||
    !sameProjection(state.projection, projection) ||
    !bindingMatchesMap(map, projection.binding, state.mapEpoch) ||
    !activeLedgerFor(projection, state.ledger)
  ) {
    return undefined;
  }
  return { map, mapEpoch: state.mapEpoch, ledger: state.ledger };
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
      (await reviewedDocumentOriginLedgerAuthorizationIsValid(stored.ledger)) &&
      (await reviewedDocumentOriginApprovalEvidenceIsValid(projection)) &&
      (await reviewedDocumentOriginRawEvidenceIsValid(projection.binding)),
    );
  } catch {
    return false;
  }
}

function matchingCurrentProjection(
  projections: ReviewedDocumentOriginProjection[],
  ledgers: Map<string, ReviewedDocumentOriginLedger | undefined>,
  binding: ReviewedDocumentOriginBinding,
):
  | { projection: ReviewedDocumentOriginProjection; ledger: ReviewedDocumentOriginLedger }
  | undefined {
  for (const projection of projections) {
    const ledger = ledgers.get(projection.id);
    if (sameBinding(projection.binding, binding) && activeLedgerFor(projection, ledger)) {
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
      projections.map((item) => [item.id, store.reviewedDocumentOriginLedger(item.id)]),
    );
    return matchingCurrentProjection(projections, ledgers, binding);
  });
  if (existing) return { ...existing, alreadyActive: true };

  const actor: ActorIdentity = {
    actorId: requireText(input.actor.actorId, "actor", 128),
    actorKind: input.actor.actorKind,
  };
  if (!["human", "agent", "system"].includes(actor.actorKind)) {
    throw new ReviewedDocumentOriginError("scope-mismatch", "actor kind is unsupported");
  }
  const projectionId = `reviewed-origin-${randomUUID()}`;
  const approvalBase = {
    actor,
    reason: requireText(input.reason, "reason", 1_000),
    assertion: requireText(input.assertion, "assertion", 4_000),
    at,
  };
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
  const unsignedLedger = {
    schemaVersion: 1 as const,
    projectionId,
    status: "active" as const,
    createdAt: at,
    activatedAt: at,
  };
  const ledger: ReviewedDocumentOriginLedger = {
    ...unsignedLedger,
    authorization: await issueReviewedDocumentOriginLedgerAuthorization(unsignedLedger),
  };
  return withControlStore((store) => {
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
      projections.map((item) => [item.id, store.reviewedDocumentOriginLedger(item.id)]),
    );
    const active = matchingCurrentProjection(projections, ledgers, binding);
    if (active) return { ...active, alreadyActive: true };
    store.insertReviewedDocumentOriginProjection(mapKey, projection);
    store.upsertReviewedDocumentOriginLedger(mapKey, binding.mapEpoch, ledger);
    publishReviewedOriginChange(currentMap, at);
    return { projection, ledger, alreadyActive: false };
  });
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
  const mapKey = appMapKey(input.appMap.projectId, input.appMap.id);
  const existing = await readControlStore((store) => ({
    projection: store.reviewedDocumentOriginProjection(input.projectionId),
    ledger: store.reviewedDocumentOriginLedger(input.projectionId),
  }));
  if (
    !existing.projection ||
    existing.projection.binding.projectId !== input.appMap.projectId ||
    existing.projection.binding.appMapId !== input.appMap.id ||
    existing.projection.binding.screenId !== input.screenId ||
    existing.projection.binding.variantId !== input.variantId ||
    existing.projection.binding.captureId !== input.captureId ||
    !existing.ledger
  ) {
    throw new ReviewedDocumentOriginError(
      "not-found",
      `Reviewed origin ${input.projectionId} not found`,
    );
  }
  if (existing.ledger.status === "revoked") {
    return { projection: existing.projection, ledger: existing.ledger, alreadyRevoked: true };
  }
  const at = input.at ?? Date.now();
  const decisionBase = {
    actor: {
      actorId: requireText(input.actor.actorId, "actor", 128),
      actorKind: input.actor.actorKind,
    },
    reason: requireText(input.reason, "reason", 1_000),
    assertion: requireText(input.assertion, "assertion", 4_000),
    at,
  } satisfies Omit<ReviewedDocumentOriginDecision, "evidence">;
  if (!["human", "agent", "system"].includes(decisionBase.actor.actorKind)) {
    throw new ReviewedDocumentOriginError("scope-mismatch", "actor kind is unsupported");
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
  const revocation: ReviewedDocumentOriginDecision = {
    ...decisionBase,
    evidence: {
      id: revocationEvidence.id,
      uri: revocationEvidence.uri,
      sha256: revocationEvidence.sha256,
      mime: "application/json",
      bytes: revocationEvidence.bytes,
    },
  };
  const unsignedLedger = {
    schemaVersion: 1 as const,
    projectionId: existing.projection.id,
    status: "revoked" as const,
    createdAt: existing.ledger.createdAt,
    ...(existing.ledger.activatedAt !== undefined
      ? { activatedAt: existing.ledger.activatedAt }
      : {}),
    revocation,
  };
  const ledger: ReviewedDocumentOriginLedger = {
    ...unsignedLedger,
    authorization: await issueReviewedDocumentOriginLedgerAuthorization(unsignedLedger),
  };
  return withControlStore((store) => {
    const currentMap = store.appMap(mapKey);
    const current = store.reviewedDocumentOriginProjection(input.projectionId);
    const currentLedger = store.reviewedDocumentOriginLedger(input.projectionId);
    if (
      !currentMap ||
      currentMap.revision !== input.expectedRevision ||
      !current ||
      !currentLedger
    ) {
      throw new ReviewedDocumentOriginError(
        "revision-conflict",
        "The App Map or reviewed origin changed while revocation was being recorded",
      );
    }
    if (currentLedger.status === "revoked") {
      return { projection: current, ledger: currentLedger, alreadyRevoked: true };
    }
    store.upsertReviewedDocumentOriginLedger(mapKey, current.binding.mapEpoch, ledger);
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
          store.reviewedDocumentOriginLedger(projection.id),
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
      const ledger = state.ledgers.get(projection.id);
      return { projection, ...(ledger ? { ledger } : {}), currentBinding };
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
    input.ledger.status === "revoked" &&
    input.ledger.revocation &&
    (await reviewedDocumentOriginLedgerAuthorizationIsValid(input.ledger)) &&
    (await revocationEvidenceIsValid(input)),
  );
}

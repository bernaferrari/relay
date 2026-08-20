import type {
  ReviewedDocumentOriginExecutionReference,
  ReviewedDocumentOriginProjection,
  ScrollSurfaceEvidence,
  ScrollSurfaceViewport,
} from "@relay/protocol";
import { isNumber, isObject, isString, stepErr } from "./recipe-validation-primitives.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;

function evidence<Mime extends "image/png" | "application/json">(
  value: unknown,
  mime: Mime,
): (ScrollSurfaceEvidence & { mime: Mime }) | undefined {
  if (!isObject(value) || Array.isArray(value)) return undefined;
  return isString(value.id) &&
    value.id.trim() &&
    isString(value.uri) &&
    isString(value.sha256) &&
    SHA256.test(value.sha256) &&
    value.uri === `relay-evidence://${value.sha256}` &&
    value.mime === mime &&
    isNumber(value.bytes) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0
    ? { id: value.id, uri: value.uri, sha256: value.sha256, mime, bytes: value.bytes }
    : undefined;
}

function requiredText(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

/** Parser-only structural validation. The runner still requires an exact
 * local projection, active signed ledger, App Map digest, and reopened CAS
 * bytes before it turns this declarative reference into a fling capability. */
export function parseReviewedDocumentOriginExecutionReference(
  value: unknown,
  index: number,
  origin: ScrollSurfaceViewport,
  scope: { screenId: string; variantId: string; surfaceId: string; captureId: string },
): ReviewedDocumentOriginExecutionReference {
  const reference = isObject(value) && !Array.isArray(value) ? value : undefined;
  const projection =
    reference && isObject(reference.projection) && !Array.isArray(reference.projection)
      ? reference.projection
      : undefined;
  const binding =
    projection && isObject(projection.binding) && !Array.isArray(projection.binding)
      ? projection.binding
      : undefined;
  const first =
    binding && isObject(binding.firstViewport) && !Array.isArray(binding.firstViewport)
      ? binding.firstViewport
      : undefined;
  const approval =
    projection && isObject(projection.approval) && !Array.isArray(projection.approval)
      ? projection.approval
      : undefined;
  const actor =
    approval && isObject(approval.actor) && !Array.isArray(approval.actor)
      ? approval.actor
      : undefined;
  const authorization =
    projection && isObject(projection.authorization) && !Array.isArray(projection.authorization)
      ? projection.authorization
      : undefined;
  const screenshot = evidence(first?.screenshot, "image/png");
  const accessibilityTree = evidence(first?.accessibilityTree, "application/json");
  const approvalEvidence = evidence(approval?.evidence, "application/json");
  const valid = Boolean(
    reference &&
    projection &&
    binding &&
    first &&
    approval &&
    actor &&
    authorization &&
    reference.schemaVersion === 1 &&
    projection.schemaVersion === 1 &&
    requiredText(projection.id) &&
    binding.schemaVersion === 1 &&
    [
      binding.organizationId,
      binding.projectId,
      binding.appMapId,
      binding.appMapDigest,
      binding.mapEpoch,
      binding.screenId,
      binding.variantId,
      binding.surfaceId,
      binding.captureId,
      binding.targetProfileId,
    ].every(requiredText) &&
    SHA256.test(binding.appMapDigest as string) &&
    isNumber(binding.appMapRevision) &&
    Number.isSafeInteger(binding.appMapRevision) &&
    binding.platform === "android" &&
    binding.screenId === scope.screenId &&
    binding.variantId === scope.variantId &&
    binding.surfaceId === scope.surfaceId &&
    binding.captureId === scope.captureId &&
    first.index === 0 &&
    first.offsetY === 0 &&
    first.appendedHeight === 0 &&
    first.capturedAt === origin.capturedAt &&
    first.width === origin.width &&
    first.height === origin.height &&
    screenshot &&
    accessibilityTree &&
    screenshot.sha256 === origin.screenshot.sha256 &&
    accessibilityTree.sha256 === origin.accessibilityTree.sha256 &&
    requiredText(actor.actorId) &&
    ["human", "agent", "system"].includes(actor.actorKind as string) &&
    requiredText(approval.reason) &&
    requiredText(approval.assertion) &&
    isNumber(approval.at) &&
    Number.isSafeInteger(approval.at) &&
    approvalEvidence &&
    authorization.schemaVersion === 1 &&
    authorization.issuer === "relay-local-reviewed-origin" &&
    isString(authorization.signature) &&
    SIGNATURE.test(authorization.signature),
  );
  if (
    !valid ||
    !reference ||
    !projection ||
    !binding ||
    !first ||
    !approval ||
    !actor ||
    !authorization ||
    !screenshot ||
    !accessibilityTree ||
    !approvalEvidence
  ) {
    throw stepErr(
      index,
      "capture-surface.reviewedDocumentOrigin must bind this exact first raw viewport",
    );
  }
  const parsedProjection: ReviewedDocumentOriginProjection = {
    schemaVersion: 1,
    id: projection.id as string,
    binding: {
      schemaVersion: 1,
      organizationId: binding.organizationId as string,
      projectId: binding.projectId as string,
      appMapId: binding.appMapId as string,
      appMapRevision: binding.appMapRevision as number,
      appMapDigest: binding.appMapDigest as string,
      mapEpoch: binding.mapEpoch as string,
      screenId: binding.screenId as string,
      variantId: binding.variantId as string,
      surfaceId: binding.surfaceId as string,
      captureId: binding.captureId as string,
      targetProfileId: binding.targetProfileId as string,
      platform: "android",
      firstViewport: {
        index: 0,
        offsetY: 0,
        appendedHeight: 0,
        capturedAt: origin.capturedAt,
        width: origin.width,
        height: origin.height,
        screenshot,
        accessibilityTree,
      },
    },
    approval: {
      actor: {
        actorId: actor.actorId as string,
        actorKind: actor.actorKind as "human" | "agent" | "system",
      },
      reason: approval.reason as string,
      assertion: approval.assertion as string,
      at: approval.at as number,
      evidence: approvalEvidence,
    },
    authorization: {
      schemaVersion: 1,
      issuer: "relay-local-reviewed-origin",
      signature: authorization.signature as string,
    },
  };
  return { schemaVersion: 1, projection: parsedProjection };
}

/** Runtime authorization boundary for the one high-distance Android restore.
 *
 * Both native capture receipts and reviewed-origin overlays converge here, but
 * never substitute for each other: native proof is preferred; a reviewed
 * overlay must reopen its server-owned projection, signed lifecycle ledger,
 * current map binding, and CAS evidence at execution time.
 */
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import {
  documentOriginAttestationAuthorizationIsValid,
  type DocumentOriginAttestationAuthorization,
  type DocumentOriginAttestationBinding,
} from "./document-origin-attestation-authority.js";
import { mintValidatedFrozenDocumentOrigin } from "./frozen-document-origin-capability.js";
import { reviewedDocumentOriginExecutionReferenceIsActive } from "./reviewed-document-origin.js";
import type { RecipeStep } from "./recipes.js";
import { observeScreenIdentity } from "./screen-identity.js";
import type { ValidatedFrozenDocumentOrigin } from "./scrollable-survey.js";

type CaptureSurfaceStep = Extract<RecipeStep, { kind: "capture-surface" }>;

function evidenceBytesMatch(bytes: Buffer, evidence: { sha256: string; bytes: number }): boolean {
  return (
    bytes.byteLength === evidence.bytes &&
    createHash("sha256").update(bytes).digest("hex") === evidence.sha256
  );
}

function isSnapshotNode(value: unknown): value is SnapshotNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frozenScreenshotMatchesViewport(
  image: Buffer,
  origin: CaptureSurfaceStep["documentOrigin"],
): boolean {
  if (!origin) return false;
  try {
    const decoded = PNG.sync.read(image);
    return decoded.width === origin.width && decoded.height === origin.height;
  } catch {
    return false;
  }
}

function frozenDocumentOriginGeometryIsValid(
  origin: CaptureSurfaceStep["documentOrigin"],
): boolean {
  return Boolean(
    origin &&
    origin.index === 0 &&
    origin.offsetY === 0 &&
    origin.appendedHeight === 0 &&
    Number.isSafeInteger(origin.capturedAt) &&
    Number.isSafeInteger(origin.width) &&
    Number.isSafeInteger(origin.height) &&
    origin.width > 0 &&
    origin.height > 0,
  );
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function evidenceSha256(value: unknown): string | undefined {
  const sha256 = objectRecord(value)?.sha256;
  return typeof sha256 === "string" && /^[a-f0-9]{64}$/u.test(sha256) ? sha256 : undefined;
}

type RuntimeEvidenceReference = {
  id: string;
  uri: string;
  sha256: string;
  mime: "application/json";
  bytes: number;
};

function attestationEvidence(value: unknown): RuntimeEvidenceReference | undefined {
  const evidence = objectRecord(value);
  const sha256 = evidenceSha256(evidence);
  if (
    !evidence ||
    !sha256 ||
    typeof evidence.id !== "string" ||
    !evidence.id.trim() ||
    evidence.uri !== `relay-evidence://${sha256}` ||
    evidence.mime !== "application/json" ||
    typeof evidence.bytes !== "number" ||
    !Number.isSafeInteger(evidence.bytes) ||
    evidence.bytes < 0
  ) {
    return undefined;
  }
  return {
    id: evidence.id,
    uri: evidence.uri,
    sha256,
    mime: "application/json",
    bytes: evidence.bytes,
  };
}

function attestationAuthorization(
  value: unknown,
): DocumentOriginAttestationAuthorization | undefined {
  const authorization = objectRecord(value);
  if (
    !authorization ||
    authorization.schemaVersion !== 1 ||
    authorization.issuer !== "relay-local-capture" ||
    typeof authorization.signature !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(authorization.signature)
  ) {
    return undefined;
  }
  return { schemaVersion: 1, issuer: "relay-local-capture", signature: authorization.signature };
}

function frozenDocumentOriginProofIsValid(step: CaptureSurfaceStep): boolean {
  const origin = objectRecord(step.documentOrigin);
  const proof = objectRecord(step.documentOriginProof);
  const firstViewport = objectRecord(proof?.firstViewport);
  const screenshotSha256 = evidenceSha256(origin?.screenshot);
  const accessibilityTreeSha256 = evidenceSha256(origin?.accessibilityTree);
  const attestation = attestationEvidence(proof?.attestation);
  const authorization = attestationAuthorization(proof?.authorization);
  return Boolean(
    origin &&
    proof &&
    firstViewport &&
    screenshotSha256 &&
    accessibilityTreeSha256 &&
    attestation &&
    authorization &&
    proof.schemaVersion === 1 &&
    proof.method === "frozen-origin-match" &&
    firstViewport.screenshotSha256 === screenshotSha256 &&
    firstViewport.accessibilityTreeSha256 === accessibilityTreeSha256,
  );
}

async function frozenDocumentOriginAttestationIsValid(
  step: CaptureSurfaceStep,
  origin: NonNullable<CaptureSurfaceStep["documentOrigin"]>,
  targetProfileId: string,
): Promise<boolean> {
  const proof = objectRecord(step.documentOriginProof);
  const attestation = attestationEvidence(proof?.attestation);
  const authorization = attestationAuthorization(proof?.authorization);
  if (!attestation || !authorization || !targetProfileId.trim()) return false;
  const bytes = await readAuthoringEvidence(attestation.sha256);
  if (!bytes || !evidenceBytesMatch(bytes, attestation)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return false;
  }
  const payload = objectRecord(parsed);
  const terminal = objectRecord(payload?.terminal);
  const firstViewport = objectRecord(payload?.firstViewport);
  const terminalViewport = objectRecord(payload?.terminalViewport);
  const terminalCapturedAt = terminalViewport?.capturedAt;
  const terminalWidth = terminalViewport?.width;
  const terminalHeight = terminalViewport?.height;
  const terminalScreenshotSha256 = terminalViewport?.screenshotSha256;
  const terminalAccessibilityTreeSha256 = terminalViewport?.accessibilityTreeSha256;
  if (
    !payload ||
    !terminal ||
    !firstViewport ||
    !terminalViewport ||
    payload.schemaVersion !== 1 ||
    payload.kind !== "relay.document-origin-attestation" ||
    payload.method !== "frozen-origin-match" ||
    payload.targetProfileId !== targetProfileId ||
    payload.surfaceId !== step.surfaceId ||
    payload.capturedAt !== origin.capturedAt ||
    terminal.status !== "completed" ||
    terminal.reason !== "end-of-content" ||
    terminal.restoredStartViewport !== true ||
    firstViewport.index !== 0 ||
    firstViewport.offsetY !== 0 ||
    firstViewport.appendedHeight !== 0 ||
    firstViewport.capturedAt !== origin.capturedAt ||
    firstViewport.width !== origin.width ||
    firstViewport.height !== origin.height ||
    firstViewport.screenshotSha256 !== origin.screenshot.sha256 ||
    firstViewport.accessibilityTreeSha256 !== origin.accessibilityTree.sha256 ||
    typeof terminalCapturedAt !== "number" ||
    !Number.isSafeInteger(terminalCapturedAt) ||
    typeof terminalWidth !== "number" ||
    !Number.isSafeInteger(terminalWidth) ||
    typeof terminalHeight !== "number" ||
    !Number.isSafeInteger(terminalHeight) ||
    terminalWidth <= 0 ||
    terminalHeight <= 0 ||
    typeof terminalScreenshotSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(terminalScreenshotSha256) ||
    typeof terminalAccessibilityTreeSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(terminalAccessibilityTreeSha256)
  ) {
    return false;
  }
  const binding: DocumentOriginAttestationBinding = {
    attestationSha256: attestation.sha256,
    targetProfileId,
    surfaceId: step.surfaceId,
    firstViewport: {
      index: 0,
      offsetY: 0,
      appendedHeight: 0,
      capturedAt: origin.capturedAt,
      width: origin.width,
      height: origin.height,
      screenshotSha256: origin.screenshot.sha256,
      accessibilityTreeSha256: origin.accessibilityTree.sha256,
    },
    terminalViewport: {
      capturedAt: terminalCapturedAt,
      width: terminalWidth,
      height: terminalHeight,
      screenshotSha256: terminalScreenshotSha256,
      accessibilityTreeSha256: terminalAccessibilityTreeSha256,
    },
  };
  return documentOriginAttestationAuthorizationIsValid(binding, authorization);
}

function isFrozenInspectableSnapshot(
  value: unknown,
): value is { nodes: SnapshotNode[]; foregroundApp?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { inspectable?: unknown }).inspectable === true &&
    Array.isArray((value as { nodes?: unknown }).nodes) &&
    (value as { nodes: unknown[] }).nodes.every(isSnapshotNode) &&
    ((value as { foregroundApp?: unknown }).foregroundApp === undefined ||
      typeof (value as { foregroundApp?: unknown }).foregroundApp === "string")
  );
}

/** Missing, malformed, stale, or revoked proof merely disables the fast path;
 * it never turns into a hidden fallback gesture or a device mutation. */
export async function loadFrozenDocumentOriginForCaptureSurface(
  step: CaptureSurfaceStep,
  serial: string,
  targetProfileId: string,
): Promise<ValidatedFrozenDocumentOrigin | undefined> {
  const origin = step.documentOrigin;
  if (!origin || step.baselineTrust !== "trusted" || !frozenDocumentOriginGeometryIsValid(origin)) {
    return undefined;
  }
  const authorized = step.documentOriginProof
    ? frozenDocumentOriginProofIsValid(step) &&
      (await frozenDocumentOriginAttestationIsValid(step, origin, targetProfileId))
    : step.reviewedDocumentOrigin
      ? await reviewedDocumentOriginExecutionReferenceIsActive({
          reference: step.reviewedDocumentOrigin,
          origin,
          targetProfileId,
          screenId: step.screenId,
          variantId: step.variantId,
          surfaceId: step.surfaceId,
          captureId: step.baselineCaptureId,
        })
      : false;
  if (!authorized) return undefined;
  const [image, tree] = await Promise.all([
    readAuthoringEvidence(origin.screenshot.sha256),
    readAuthoringEvidence(origin.accessibilityTree.sha256),
  ]);
  if (
    !image ||
    !tree ||
    !evidenceBytesMatch(image, origin.screenshot) ||
    !evidenceBytesMatch(tree, origin.accessibilityTree) ||
    !frozenScreenshotMatchesViewport(image, origin)
  ) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(tree.toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isFrozenInspectableSnapshot(parsed)) return undefined;
  const nodes = parsed.nodes;
  return mintValidatedFrozenDocumentOrigin({
    screenshot: {
      base64: image.toString("base64"),
      width: origin.width,
      height: origin.height,
      capturedAt: origin.capturedAt,
    },
    snapshot: {
      serial,
      capturedAt: origin.capturedAt,
      nodes,
      interactive: nodes.filter((node) => node.hittable === true),
      bounds: { width: origin.width, height: origin.height },
      inspectable: true,
      source: "sdk",
      ...(parsed.foregroundApp?.trim() ? { foregroundApp: parsed.foregroundApp } : {}),
      screenIdentity: observeScreenIdentity(nodes),
    },
  });
}

export function captureSurfaceBaselineDisposition(
  step: CaptureSurfaceStep,
  frozenDocumentOrigin: ValidatedFrozenDocumentOrigin | undefined,
): { requiresRecapture: boolean; reason?: string } {
  if (step.baselineTrust === "trusted" && !frozenDocumentOrigin) {
    return {
      requiresRecapture: true,
      reason: step.documentOrigin
        ? "The frozen document-origin evidence is unavailable or invalid, so this comparison must be recaptured and reviewed."
        : "A trusted baseline lacks frozen document-origin evidence, so this comparison must be recaptured and reviewed.",
    };
  }
  return {
    requiresRecapture: step.baselineTrust === "recapture-required",
    ...(step.baselineTrustReason ? { reason: step.baselineTrustReason } : {}),
  };
}

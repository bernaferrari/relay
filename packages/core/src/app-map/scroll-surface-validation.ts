import type {
  LogicalScrollSurface,
  ScreenVariant,
  ScrollSurfaceCapturePolicy,
  ScrollSurfaceEvidence,
} from "@relay/protocol";
import { appMapFail } from "./errors.js";
import {
  finiteTimestamp,
  identifier,
  objectValue,
  optionalText,
  requiredText,
  safeInteger,
} from "./validation-primitives.js";

const reasons = new Set([
  "end-of-content",
  "screen-changed",
  "inspection-unavailable",
  "missing-page-anchor",
  "seam-ambiguous",
  "dimension-changed",
  "scroll-failed",
  "restore-failed",
  "start-viewport-unproven",
  "limit-reached",
]);

function assertEvidence(
  value: unknown,
  expectedMime: ScrollSurfaceEvidence["mime"],
  label: string,
): void {
  const evidence = objectValue(value, label);
  identifier(evidence.id, `${label}.id`);
  requiredText(evidence.uri, `${label}.uri`, 2_048);
  if (
    typeof evidence.uri !== "string" ||
    !/^relay-evidence:\/\/[a-f0-9]{64}$/u.test(evidence.uri)
  ) {
    appMapFail("invalid-map", `${label}.uri must be a Relay evidence resource`);
  }
  if (
    typeof evidence.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(evidence.sha256) ||
    evidence.uri !== `relay-evidence://${evidence.sha256}`
  ) {
    appMapFail("invalid-map", `${label}.sha256 must match its evidence URI`);
  }
  if (evidence.mime !== expectedMime) appMapFail("invalid-map", `${label}.mime is unsupported`);
  safeInteger(evidence.bytes, `${label}.bytes`);
}

function assertPositiveInteger(value: unknown, label: string): void {
  safeInteger(value, label);
  if (value === 0) appMapFail("invalid-map", `${label} must be positive`);
}

export function assertScrollSurfaceCapturePolicy(
  policy: ScrollSurfaceCapturePolicy,
  label: string,
): void {
  objectValue(policy, label);
  if (policy.captureMode !== "viewport" && policy.captureMode !== "full-surface") {
    appMapFail("invalid-map", `${label}.captureMode is unsupported`);
  }
  if (!(["default", "recommended", "explicit"] as unknown[]).includes(policy.source)) {
    appMapFail("invalid-map", `${label}.source is unsupported`);
  }
  requiredText(policy.reason, `${label}.reason`, 512);
  finiteTimestamp(policy.decidedAt, `${label}.decidedAt`);
}

export function assertLogicalScrollSurface(
  surface: LogicalScrollSurface,
  variant: ScreenVariant,
  label: string,
): void {
  objectValue(surface, label);
  if (surface.schemaVersion !== 1) appMapFail("invalid-map", `${label}.schemaVersion must be 1`);
  identifier(surface.id, `${label}.id`);
  identifier(surface.captureId, `${label}.captureId`);
  if (surface.targetProfileId !== variant.targetProfile.id) {
    appMapFail("scope-mismatch", `${label} belongs to another target profile`);
  }
  finiteTimestamp(surface.capturedAt, `${label}.capturedAt`);
  assertScrollSurfaceCapturePolicy(surface.capturePolicy, `${label}.capturePolicy`);
  if (surface.capturePolicy.captureMode !== "full-surface") {
    appMapFail("invalid-map", `${label}.capturePolicy must select full-surface`);
  }
  if (surface.status !== "completed" && surface.status !== "stopped") {
    appMapFail("invalid-map", `${label}.status is unsupported`);
  }
  if (!reasons.has(surface.reason)) appMapFail("invalid-map", `${label}.reason is unsupported`);
  requiredText(surface.message, `${label}.message`, 1_024);
  if (typeof surface.restoredStartViewport !== "boolean") {
    appMapFail("invalid-map", `${label}.restoredStartViewport must be boolean`);
  }
  if (
    !Array.isArray(surface.viewports) ||
    surface.viewports.length === 0 ||
    surface.viewports.length > 13
  ) {
    appMapFail("invalid-map", `${label}.viewports must contain between 1 and 13 items`);
  }
  let previousOffset = -1;
  surface.viewports.forEach((viewport, index) => {
    objectValue(viewport, `${label}.viewports[${index}]`);
    safeInteger(viewport.index, `${label}.viewports[${index}].index`);
    if (viewport.index !== index) {
      appMapFail("invalid-map", `${label}.viewports[${index}].index must be sequential`);
    }
    safeInteger(viewport.offsetY, `${label}.viewports[${index}].offsetY`);
    safeInteger(viewport.appendedHeight, `${label}.viewports[${index}].appendedHeight`);
    finiteTimestamp(viewport.capturedAt, `${label}.viewports[${index}].capturedAt`);
    assertPositiveInteger(viewport.width, `${label}.viewports[${index}].width`);
    assertPositiveInteger(viewport.height, `${label}.viewports[${index}].height`);
    if ((index === 0 && viewport.offsetY !== 0) || viewport.offsetY <= previousOffset) {
      appMapFail("invalid-map", `${label}.viewports offsets must increase from zero`);
    }
    previousOffset = viewport.offsetY;
    assertEvidence(viewport.screenshot, "image/png", `${label}.viewports[${index}].screenshot`);
    assertEvidence(
      viewport.accessibilityTree,
      "application/json",
      `${label}.viewports[${index}].accessibilityTree`,
    );
  });
  if (surface.documentOriginProof !== undefined) {
    const proof = objectValue(surface.documentOriginProof, `${label}.documentOriginProof`);
    if (proof.schemaVersion !== 1 || proof.method !== "frozen-origin-match") {
      appMapFail("invalid-map", `${label}.documentOriginProof is unsupported`);
    }
    assertEvidence(
      proof.attestation,
      "application/json",
      `${label}.documentOriginProof.attestation`,
    );
    const authorization = objectValue(
      proof.authorization,
      `${label}.documentOriginProof.authorization`,
    );
    if (
      authorization.schemaVersion !== 1 ||
      authorization.issuer !== "relay-local-capture" ||
      typeof authorization.signature !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(authorization.signature)
    ) {
      appMapFail("invalid-map", `${label}.documentOriginProof.authorization is unsupported`);
    }
    const firstViewport = surface.viewports[0]!;
    const first = objectValue(proof.firstViewport, `${label}.documentOriginProof.firstViewport`);
    if (
      typeof first.screenshotSha256 !== "string" ||
      typeof first.accessibilityTreeSha256 !== "string" ||
      first.screenshotSha256 !== firstViewport.screenshot.sha256 ||
      first.accessibilityTreeSha256 !== firstViewport.accessibilityTree.sha256
    ) {
      appMapFail(
        "invalid-map",
        `${label}.documentOriginProof must bind the first raw viewport evidence`,
      );
    }
    if (
      surface.status !== "completed" ||
      surface.reason !== "end-of-content" ||
      !surface.restoredStartViewport
    ) {
      appMapFail(
        "invalid-map",
        `${label}.documentOriginProof requires a completed, restored surface`,
      );
    }
  }
  if (surface.diagnosticViewports !== undefined) {
    if (!Array.isArray(surface.diagnosticViewports) || surface.diagnosticViewports.length > 6) {
      appMapFail("invalid-map", `${label}.diagnosticViewports must contain at most 6 items`);
    }
    surface.diagnosticViewports.forEach((viewport, index) => {
      objectValue(viewport, `${label}.diagnosticViewports[${index}]`);
      safeInteger(viewport.index, `${label}.diagnosticViewports[${index}].index`);
      safeInteger(viewport.offsetY, `${label}.diagnosticViewports[${index}].offsetY`);
      safeInteger(viewport.appendedHeight, `${label}.diagnosticViewports[${index}].appendedHeight`);
      if (viewport.appendedHeight !== 0) {
        appMapFail(
          "invalid-map",
          `${label}.diagnosticViewports[${index}].appendedHeight must be zero`,
        );
      }
      finiteTimestamp(viewport.capturedAt, `${label}.diagnosticViewports[${index}].capturedAt`);
      assertPositiveInteger(viewport.width, `${label}.diagnosticViewports[${index}].width`);
      assertPositiveInteger(viewport.height, `${label}.diagnosticViewports[${index}].height`);
      assertEvidence(
        viewport.screenshot,
        "image/png",
        `${label}.diagnosticViewports[${index}].screenshot`,
      );
      assertEvidence(
        viewport.accessibilityTree,
        "application/json",
        `${label}.diagnosticViewports[${index}].accessibilityTree`,
      );
    });
  }
  if (surface.composite) {
    assertEvidence(surface.composite, "image/png", `${label}.composite`);
    assertPositiveInteger(surface.composite.width, `${label}.composite.width`);
    assertPositiveInteger(surface.composite.height, `${label}.composite.height`);
  }
  assertEvidence(surface.mergedTree, "application/json", `${label}.mergedTree`);
  safeInteger(surface.mergedTree.nodeCount, `${label}.mergedTree.nodeCount`);
  if (surface.semanticIndex !== undefined) {
    objectValue(surface.semanticIndex, `${label}.semanticIndex`);
    if (surface.semanticIndex.schemaVersion !== 1) {
      appMapFail("invalid-map", `${label}.semanticIndex.schemaVersion must be 1`);
    }
    assertPositiveInteger(
      surface.semanticIndex.documentHeight,
      `${label}.semanticIndex.documentHeight`,
    );
    assertPositiveInteger(
      surface.semanticIndex.viewportHeight,
      `${label}.semanticIndex.viewportHeight`,
    );
    if (
      !Array.isArray(surface.semanticIndex.anchors) ||
      surface.semanticIndex.anchors.length > 2_048
    ) {
      appMapFail("invalid-map", `${label}.semanticIndex.anchors must contain at most 2048 items`);
    }
    let previousY = -1;
    surface.semanticIndex.anchors.forEach((anchor, index) => {
      objectValue(anchor, `${label}.semanticIndex.anchors[${index}]`);
      safeInteger(anchor.order, `${label}.semanticIndex.anchors[${index}].order`);
      safeInteger(anchor.documentY, `${label}.semanticIndex.anchors[${index}].documentY`);
      if (anchor.order !== index || anchor.documentY < previousY) {
        appMapFail(
          "invalid-map",
          `${label}.semanticIndex.anchors must have sequential order and increasing geometry`,
        );
      }
      if (
        !anchor.target ||
        typeof anchor.target !== "object" ||
        ![
          anchor.target.identifier,
          anchor.target.ref,
          anchor.target.label,
          anchor.target.text,
        ].some((value) => typeof value === "string" && value.trim().length > 0)
      ) {
        appMapFail("invalid-map", `${label}.semanticIndex.anchors[${index}] needs a target`);
      }
      optionalText(anchor.label, `${label}.semanticIndex.anchors[${index}].label`, 512);
      optionalText(anchor.role, `${label}.semanticIndex.anchors[${index}].role`, 160);
      optionalText(anchor.value, `${label}.semanticIndex.anchors[${index}].value`, 512);
      if (anchor.enabled !== undefined && typeof anchor.enabled !== "boolean") {
        appMapFail(
          "invalid-map",
          `${label}.semanticIndex.anchors[${index}].enabled must be boolean`,
        );
      }
      if (anchor.selected !== undefined && typeof anchor.selected !== "boolean") {
        appMapFail(
          "invalid-map",
          `${label}.semanticIndex.anchors[${index}].selected must be boolean`,
        );
      }
      previousY = anchor.documentY;
    });
  }
  assertEvidence(surface.manifest, "application/json", `${label}.manifest`);
  const evidence = [
    ...surface.viewports.flatMap((viewport) => [viewport.screenshot, viewport.accessibilityTree]),
    ...(surface.diagnosticViewports ?? []).flatMap((viewport) => [
      viewport.screenshot,
      viewport.accessibilityTree,
    ]),
    ...(surface.documentOriginProof ? [surface.documentOriginProof.attestation] : []),
    ...(surface.composite ? [surface.composite] : []),
    surface.mergedTree,
    surface.manifest,
  ];
  for (const item of evidence) {
    if (!variant.evidenceIds.includes(item.id) || !variant.evidenceUris?.includes(item.uri)) {
      appMapFail("missing-reference", `${label} evidence ${item.id} is not owned by its variant`);
    }
  }
}

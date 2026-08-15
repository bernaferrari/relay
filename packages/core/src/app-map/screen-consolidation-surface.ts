import type { LogicalScrollSurface } from "@relay/protocol";
import { appMapFail } from "./errors.js";
import type { AppMap } from "./model.js";

export function logicalSurfaceEvidence(surface: LogicalScrollSurface) {
  return [
    ...surface.viewports.flatMap((viewport) => [viewport.screenshot, viewport.accessibilityTree]),
    surface.mergedTree,
    surface.manifest,
  ];
}

export function validateConsolidationSurface(
  map: AppMap,
  screenIds: Set<string>,
  surface: LogicalScrollSurface,
): void {
  if (surface.composite) {
    appMapFail("invalid-map", "An imported seam-ambiguous surface cannot claim a composite image");
  }
  if (surface.status !== "stopped" || surface.reason !== "seam-ambiguous") {
    appMapFail(
      "invalid-map",
      "Imported viewport evidence must remain seam-ambiguous until stitching is proven",
    );
  }
  if (surface.viewports.length < 2) {
    appMapFail(
      "invalid-map",
      "An imported logical surface requires at least two ordered viewports",
    );
  }
  const variants = [...screenIds].flatMap((screenId) =>
    map.screens[screenId]!.variantIds.map((variantId) => map.screenVariants[variantId]!),
  );
  if (!variants.some((variant) => variant.targetProfile.id === surface.targetProfileId)) {
    appMapFail(
      "scope-mismatch",
      `Imported surface target profile ${surface.targetProfileId} is not owned by the merged screens`,
    );
  }
  const ownedIds = new Set(variants.flatMap((variant) => variant.evidenceIds));
  const ownedUris = new Set(variants.flatMap((variant) => variant.evidenceUris ?? []));
  let priorOffset = -1;
  let width: number | undefined;
  let height: number | undefined;
  for (const [index, viewport] of surface.viewports.entries()) {
    if (
      !Number.isSafeInteger(viewport.index) ||
      !Number.isSafeInteger(viewport.offsetY) ||
      viewport.index !== index ||
      viewport.offsetY <= priorOffset ||
      (index === 0 && viewport.offsetY !== 0)
    ) {
      appMapFail(
        "invalid-map",
        "Imported viewport indexes and offsets must be strictly ordered from zero",
      );
    }
    if (
      !Number.isSafeInteger(viewport.width) ||
      !Number.isSafeInteger(viewport.height) ||
      !Number.isSafeInteger(viewport.appendedHeight) ||
      viewport.width <= 0 ||
      viewport.height <= 0 ||
      viewport.appendedHeight <= 0 ||
      viewport.appendedHeight > viewport.height
    ) {
      appMapFail("invalid-map", `Imported viewport ${index} has invalid dimensions`);
    }
    width ??= viewport.width;
    height ??= viewport.height;
    if (viewport.width !== width || viewport.height !== height) {
      appMapFail("invalid-map", "Imported viewport dimensions must be identical");
    }
    for (const evidence of [viewport.screenshot, viewport.accessibilityTree]) {
      if (!ownedIds.has(evidence.id) || !ownedUris.has(evidence.uri)) {
        appMapFail(
          "scope-mismatch",
          `Raw viewport evidence ${evidence.id} is not owned by the merged Screen Variants`,
        );
      }
    }
    priorOffset = viewport.offsetY;
  }
  for (const evidence of logicalSurfaceEvidence(surface)) {
    if (
      !/^[a-f0-9]{64}$/u.test(evidence.sha256) ||
      !Number.isSafeInteger(evidence.bytes) ||
      evidence.bytes < 0
    ) {
      appMapFail("invalid-map", `Imported evidence ${evidence.id} has invalid content metadata`);
    }
    if (evidence.uri !== `relay-evidence://${evidence.sha256}`) {
      appMapFail(
        "invalid-map",
        `Imported evidence ${evidence.id} must use its content-addressed Relay evidence URI`,
      );
    }
  }
}

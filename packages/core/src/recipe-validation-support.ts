import type {
  RecipeParameter,
  RecipeStep,
  RecordedStepEvidence,
  ScrollSurfaceDocumentOriginProof,
  ScrollSurfaceEvidence,
  ScrollSurfaceViewport,
  StepTarget,
} from "@relay/protocol";
import { parseCampaignCheck } from "./recipe-validation-campaign.js";
import { parseRecordedEvidence } from "./recipe-validation-evidence.js";
import {
  MAX_WAIT_MS,
  isNumber,
  isObject,
  isString,
  parseStepPoint,
  parseTarget,
  stepErr,
  targetHasStrategy,
} from "./recipe-validation-primitives.js";
export { parsePoint } from "./recipe-validation-primitives.js";

const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function validateRecipeParameters(value: unknown): RecipeParameter[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("parameters must be an array");
  if (value.length > 32) throw new Error("parameters are limited to 32 per reusable flow");
  const names = new Set<string>();
  const parameters = value.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`parameters[${index}] must be an object`);
    if (!isString(raw.name) || !PARAMETER_NAME.test(raw.name)) {
      throw new Error(`parameters[${index}].name is invalid`);
    }
    if (names.has(raw.name)) throw new Error(`parameters contain duplicate name ${raw.name}`);
    names.add(raw.name);
    if (raw.label !== undefined && !isString(raw.label))
      throw new Error(`parameters[${index}].label must be a string`);
    if (raw.description !== undefined && !isString(raw.description))
      throw new Error(`parameters[${index}].description must be a string`);
    if (raw.default !== undefined && !isString(raw.default))
      throw new Error(`parameters[${index}].default must be a string`);
    if (raw.required !== undefined && typeof raw.required !== "boolean")
      throw new Error(`parameters[${index}].required must be a boolean`);
    return {
      name: raw.name,
      ...(isString(raw.label) && raw.label.trim() ? { label: raw.label.trim() } : {}),
      ...(isString(raw.description) && raw.description.trim()
        ? { description: raw.description.trim() }
        : {}),
      ...(isString(raw.default) ? { default: raw.default } : {}),
      ...(raw.required === true ? { required: true } : {}),
    };
  });
  return parameters.length ? parameters : undefined;
}

function parseTourRuntimeOptions(
  raw: Record<string, unknown>,
  index: number,
): Pick<Extract<RecipeStep, { kind: "tour" }>, "returnAfterLast" | "scrollSearch"> {
  if (raw.returnAfterLast !== undefined && typeof raw.returnAfterLast !== "boolean") {
    throw stepErr(index, "tour.returnAfterLast must be a boolean");
  }
  if (raw.scrollSearch === undefined) {
    return raw.returnAfterLast === false ? { returnAfterLast: false } : {};
  }
  if (!isObject(raw.scrollSearch)) {
    throw stepErr(index, "tour.scrollSearch must be an object");
  }
  const maxScrolls = raw.scrollSearch.maxScrolls;
  const amount = raw.scrollSearch.amount;
  if (
    maxScrolls !== undefined &&
    (!Number.isInteger(maxScrolls) || Number(maxScrolls) < 1 || Number(maxScrolls) > 64)
  ) {
    throw stepErr(index, "tour.scrollSearch.maxScrolls must be an integer from 1 to 64");
  }
  if (
    amount !== undefined &&
    (!isNumber(amount) || Number(amount) < 0.25 || Number(amount) > 0.85)
  ) {
    throw stepErr(index, "tour.scrollSearch.amount must be between 0.25 and 0.85");
  }
  return {
    ...(raw.returnAfterLast === false ? { returnAfterLast: false } : {}),
    scrollSearch: {
      ...(maxScrolls === undefined ? {} : { maxScrolls: Number(maxScrolls) }),
      ...(amount === undefined ? {} : { amount: Number(amount) }),
    },
  };
}

function parseScrollRuntimeOptions(
  raw: Record<string, unknown>,
  index: number,
): Pick<Extract<RecipeStep, { kind: "scroll" }>, "until" | "maxAttempts"> {
  if (
    raw.maxAttempts !== undefined &&
    (!isNumber(raw.maxAttempts) ||
      !Number.isInteger(raw.maxAttempts) ||
      raw.maxAttempts < 1 ||
      raw.maxAttempts > 48)
  ) {
    throw stepErr(index, "scroll.maxAttempts must be an integer from 1 to 48");
  }
  let until: Extract<RecipeStep, { kind: "scroll" }>["until"];
  if (raw.until !== undefined) {
    if (!isObject(raw.until)) throw stepErr(index, "scroll.until must be an object");
    if (
      !isString(raw.until.screenId) ||
      !raw.until.screenId.trim() ||
      !isString(raw.until.screenTitle) ||
      !raw.until.screenTitle.trim() ||
      !isString(raw.until.fingerprint) ||
      !/^[a-f0-9]{64}$/u.test(raw.until.fingerprint)
    ) {
      throw stepErr(index, "scroll.until needs a mapped screen identity");
    }
    if (
      raw.until.aliases !== undefined &&
      (!Array.isArray(raw.until.aliases) ||
        !raw.until.aliases.every((alias) => isString(alias) && /^[a-f0-9]{64}$/u.test(alias)))
    ) {
      throw stepErr(index, "scroll.until.aliases must be SHA-256 fingerprints");
    }
    if (
      raw.until.observations !== undefined &&
      (!Array.isArray(raw.until.observations) ||
        raw.until.observations.length > 256 ||
        !raw.until.observations.every(
          (observation) =>
            isObject(observation) &&
            isString(observation.fingerprint) &&
            /^[a-f0-9]{64}$/u.test(observation.fingerprint) &&
            Array.isArray(observation.nodes) &&
            Array.isArray(observation.volatileSignals),
        ))
    ) {
      throw stepErr(index, "scroll.until.observations must be semantic observations");
    }
    until = structuredClone(raw.until) as NonNullable<typeof until>;
  }
  return {
    ...(until ? { until } : {}),
    ...(raw.maxAttempts !== undefined ? { maxAttempts: raw.maxAttempts } : {}),
  };
}

function parseScrollStep(
  raw: Record<string, unknown>,
  index: number,
  note?: string,
): Extract<RecipeStep, { kind: "scroll" }> {
  if (raw.direction !== "down" && raw.direction !== "up") {
    throw stepErr(index, 'scroll requires direction: "down" | "up"');
  }
  if (raw.amount !== undefined && !isNumber(raw.amount)) {
    throw stepErr(index, "scroll.amount must be a number");
  }
  return {
    kind: "scroll",
    direction: raw.direction,
    ...(raw.amount !== undefined ? { amount: raw.amount } : {}),
    ...parseScrollRuntimeOptions(raw, index),
    ...(note ? { note } : {}),
  };
}

function parseRevealStep(
  raw: Record<string, unknown>,
  index: number,
  note?: string,
): Extract<RecipeStep, { kind: "reveal" }> {
  const target = parseTarget(raw.target, index, "target");
  if (!target.identifier && !target.ref && !target.label && !target.text) {
    throw stepErr(index, "reveal requires a semantic identifier/ref/label/text target");
  }
  if (
    raw.direction !== undefined &&
    raw.direction !== "up" &&
    raw.direction !== "down" &&
    raw.direction !== "auto"
  ) {
    throw stepErr(index, 'reveal.direction must be "up", "down", or "auto"');
  }
  if (raw.maxAttempts !== undefined && (!isNumber(raw.maxAttempts) || raw.maxAttempts < 1)) {
    throw stepErr(index, "reveal.maxAttempts must be a positive number");
  }
  let navigation: Extract<RecipeStep, { kind: "reveal" }>["navigation"];
  if (raw.navigation !== undefined) {
    if (
      !Array.isArray(raw.navigation) ||
      raw.navigation.length === 0 ||
      raw.navigation.length > 32
    ) {
      throw stepErr(index, "reveal.navigation must contain between 1 and 32 semantic plans");
    }
    navigation = raw.navigation.map((candidate, planIndex) => {
      if (!isObject(candidate))
        throw stepErr(index, `reveal.navigation[${planIndex}] must be an object`);
      if (
        candidate.schemaVersion !== 1 ||
        !isString(candidate.surfaceId) ||
        !candidate.surfaceId.trim() ||
        !isString(candidate.captureId) ||
        !candidate.captureId.trim() ||
        !Number.isInteger(candidate.documentHeight) ||
        Number(candidate.documentHeight) < 1 ||
        !Number.isInteger(candidate.viewportHeight) ||
        Number(candidate.viewportHeight) < 1 ||
        !Number.isInteger(candidate.targetOrder) ||
        !Number.isInteger(candidate.targetDocumentY) ||
        !Array.isArray(candidate.anchors) ||
        candidate.anchors.length > 2_048
      ) {
        throw stepErr(index, `reveal.navigation[${planIndex}] is invalid`);
      }
      const anchors = candidate.anchors.map((rawAnchor, anchorIndex) => {
        if (
          !isObject(rawAnchor) ||
          rawAnchor.order !== anchorIndex ||
          !Number.isInteger(rawAnchor.documentY) ||
          Number(rawAnchor.documentY) < 0
        ) {
          throw stepErr(
            index,
            `reveal.navigation[${planIndex}].anchors[${anchorIndex}] is invalid`,
          );
        }
        const anchorTarget = parseTarget(
          rawAnchor.target,
          index,
          `navigation[${planIndex}].anchors[${anchorIndex}].target`,
        );
        if (
          !anchorTarget.identifier &&
          !anchorTarget.ref &&
          !anchorTarget.label &&
          !anchorTarget.text
        ) {
          throw stepErr(
            index,
            `reveal.navigation[${planIndex}].anchors[${anchorIndex}] needs a semantic target`,
          );
        }
        return { order: anchorIndex, documentY: Number(rawAnchor.documentY), target: anchorTarget };
      });
      if (!anchors.some((anchor) => anchor.order === candidate.targetOrder)) {
        throw stepErr(index, `reveal.navigation[${planIndex}].targetOrder is not indexed`);
      }
      return {
        schemaVersion: 1 as const,
        surfaceId: candidate.surfaceId.trim(),
        captureId: candidate.captureId.trim(),
        documentHeight: Number(candidate.documentHeight),
        viewportHeight: Number(candidate.viewportHeight),
        targetOrder: Number(candidate.targetOrder),
        targetDocumentY: Number(candidate.targetDocumentY),
        anchors,
      };
    });
  }
  return {
    kind: "reveal",
    target,
    ...(raw.direction !== undefined ? { direction: raw.direction } : {}),
    ...(raw.maxAttempts !== undefined ? { maxAttempts: raw.maxAttempts } : {}),
    ...(navigation ? { navigation } : {}),
    ...(note ? { note } : {}),
  };
}

function parseTapRuntimeOptions(
  raw: Record<string, unknown>,
  index: number,
): Pick<
  Extract<RecipeStep, { kind: "tap" }>,
  | "fallbackTargets"
  | "gesture"
  | "tapCount"
  | "intervalMs"
  | "durationMs"
  | "expectedApp"
  | "navigationContract"
> {
  let fallbackTargets: StepTarget[] | undefined;
  if (raw.fallbackTargets !== undefined) {
    if (!Array.isArray(raw.fallbackTargets) || raw.fallbackTargets.length > 8) {
      throw stepErr(index, "tap.fallbackTargets must contain at most 8 targets");
    }
    fallbackTargets = raw.fallbackTargets.map((fallback, fallbackIndex) => {
      const parsed = parseTarget(fallback, index, `fallbackTargets[${fallbackIndex}]`);
      if (!targetHasStrategy(parsed)) {
        throw stepErr(
          index,
          `tap.fallbackTargets[${fallbackIndex}] must contain a semantic or coordinate target`,
        );
      }
      return parsed;
    });
  }
  if (raw.gesture !== undefined && !["single", "multi", "hold"].includes(String(raw.gesture))) {
    throw stepErr(index, 'tap.gesture must be "single", "multi", or "hold"');
  }
  if (
    raw.tapCount !== undefined &&
    (!Number.isInteger(raw.tapCount) || Number(raw.tapCount) < 2 || Number(raw.tapCount) > 10)
  ) {
    throw stepErr(index, "tap.tapCount must be an integer between 2 and 10");
  }
  if (
    raw.intervalMs !== undefined &&
    (!isNumber(raw.intervalMs) || raw.intervalMs < 20 || raw.intervalMs > 2_000)
  ) {
    throw stepErr(index, "tap.intervalMs must be between 20 and 2000");
  }
  if (
    raw.durationMs !== undefined &&
    (!isNumber(raw.durationMs) || raw.durationMs < 100 || raw.durationMs > 10_000)
  ) {
    throw stepErr(index, "tap.durationMs must be between 100 and 10000");
  }
  if (raw.expectedApp !== undefined && !isString(raw.expectedApp)) {
    throw stepErr(index, "tap.expectedApp must be a string");
  }
  let navigationContract: Extract<RecipeStep, { kind: "tap" }>["navigationContract"];
  if (raw.navigationContract !== undefined) {
    if (!isObject(raw.navigationContract)) {
      throw stepErr(index, "tap.navigationContract must be an object");
    }
    const contract = raw.navigationContract;
    if (
      !isString(contract.connectionId) ||
      !isString(contract.expectedScreenId) ||
      !isString(contract.expectedFingerprint) ||
      !/^[a-f0-9]{64}$/u.test(contract.expectedFingerprint) ||
      !Array.isArray(contract.evidenceIds) ||
      !contract.evidenceIds.every(isString)
    ) {
      throw stepErr(
        index,
        "tap.navigationContract requires connection, destination proof, and evidence",
      );
    }
    navigationContract = {
      connectionId: contract.connectionId,
      expectedScreenId: contract.expectedScreenId,
      expectedFingerprint: contract.expectedFingerprint,
      evidenceIds: [...contract.evidenceIds],
    };
  }
  return {
    ...(fallbackTargets?.length ? { fallbackTargets } : {}),
    ...(raw.gesture !== undefined ? { gesture: raw.gesture as "single" | "multi" | "hold" } : {}),
    ...(raw.tapCount !== undefined ? { tapCount: raw.tapCount as number } : {}),
    ...(raw.intervalMs !== undefined ? { intervalMs: raw.intervalMs as number } : {}),
    ...(raw.durationMs !== undefined ? { durationMs: raw.durationMs as number } : {}),
    ...(isString(raw.expectedApp) ? { expectedApp: raw.expectedApp } : {}),
    ...(navigationContract ? { navigationContract } : {}),
  };
}

function parseCaptureSurfaceStep(
  raw: Record<string, unknown>,
  index: number,
  note?: string,
): Extract<RecipeStep, { kind: "capture-surface" }> {
  if (
    !isString(raw.screenId) ||
    !raw.screenId.trim() ||
    !isString(raw.screenTitle) ||
    !raw.screenTitle.trim() ||
    !isString(raw.variantId) ||
    !raw.variantId.trim() ||
    !isString(raw.surfaceId) ||
    !raw.surfaceId.trim() ||
    !isString(raw.baselineCaptureId) ||
    !raw.baselineCaptureId.trim() ||
    !isString(raw.reason) ||
    !raw.reason.trim()
  ) {
    throw stepErr(index, "capture-surface requires screen, variant, surface, baseline, and reason");
  }
  if (
    raw.maxScrolls !== undefined &&
    (!isNumber(raw.maxScrolls) ||
      !Number.isInteger(raw.maxScrolls) ||
      raw.maxScrolls < 1 ||
      raw.maxScrolls > 12)
  ) {
    throw stepErr(index, "capture-surface.maxScrolls must be an integer from 1 to 12");
  }
  if (raw.forceRecapture !== undefined && typeof raw.forceRecapture !== "boolean") {
    throw stepErr(index, "capture-surface.forceRecapture must be a boolean");
  }
  if (
    raw.baselineTrust !== undefined &&
    raw.baselineTrust !== "trusted" &&
    raw.baselineTrust !== "recapture-required"
  ) {
    throw stepErr(index, "capture-surface.baselineTrust must be trusted or recapture-required");
  }
  if (raw.baselineTrustReason !== undefined && !isString(raw.baselineTrustReason)) {
    throw stepErr(index, "capture-surface.baselineTrustReason must be a string");
  }
  const documentOrigin =
    isObject(raw.documentOrigin) && !Array.isArray(raw.documentOrigin)
      ? raw.documentOrigin
      : undefined;
  if (raw.documentOrigin !== undefined && !documentOrigin) {
    throw stepErr(index, "capture-surface.documentOrigin must be an object");
  }
  const documentOriginProof =
    isObject(raw.documentOriginProof) && !Array.isArray(raw.documentOriginProof)
      ? raw.documentOriginProof
      : undefined;
  if (raw.documentOriginProof !== undefined && !documentOriginProof) {
    throw stepErr(index, "capture-surface.documentOriginProof must be an object");
  }
  const originEvidence = <Mime extends "image/png" | "application/json">(
    value: unknown,
    mime: Mime,
  ): (ScrollSurfaceEvidence & { mime: Mime }) | undefined => {
    if (!isObject(value) || Array.isArray(value)) return undefined;
    return isString(value.id) &&
      value.id.trim().length > 0 &&
      isString(value.uri) &&
      isString(value.sha256) &&
      /^[a-f0-9]{64}$/u.test(value.sha256) &&
      value.uri === `relay-evidence://${value.sha256}` &&
      isString(value.mime) &&
      value.mime === mime &&
      isNumber(value.bytes) &&
      Number.isSafeInteger(value.bytes) &&
      value.bytes >= 0
      ? {
          id: value.id,
          uri: value.uri,
          sha256: value.sha256,
          mime,
          bytes: value.bytes,
        }
      : undefined;
  };
  let parsedDocumentOrigin: ScrollSurfaceViewport | undefined;
  let parsedDocumentOriginProof: ScrollSurfaceDocumentOriginProof | undefined;
  if (documentOrigin) {
    const screenshot = originEvidence(documentOrigin.screenshot, "image/png");
    const accessibilityTree = originEvidence(documentOrigin.accessibilityTree, "application/json");
    const numbers = [
      documentOrigin.index,
      documentOrigin.offsetY,
      documentOrigin.appendedHeight,
      documentOrigin.capturedAt,
      documentOrigin.width,
      documentOrigin.height,
    ];
    if (
      !screenshot ||
      !accessibilityTree ||
      !numbers.every((value) => isNumber(value) && Number.isSafeInteger(value)) ||
      documentOrigin.index !== 0 ||
      documentOrigin.offsetY !== 0 ||
      documentOrigin.appendedHeight !== 0 ||
      (documentOrigin.width as number) <= 0 ||
      (documentOrigin.height as number) <= 0
    ) {
      throw stepErr(index, "capture-surface.documentOrigin must be a complete first viewport");
    }
    if (raw.baselineTrust !== "trusted") {
      throw stepErr(index, "capture-surface.documentOrigin requires a trusted baseline");
    }
    const firstViewport = documentOriginProof?.firstViewport;
    if (
      !documentOriginProof ||
      documentOriginProof.schemaVersion !== 1 ||
      documentOriginProof.method !== "frozen-origin-match" ||
      !isObject(firstViewport) ||
      !isString(firstViewport.screenshotSha256) ||
      !isString(firstViewport.accessibilityTreeSha256) ||
      firstViewport.screenshotSha256 !== screenshot.sha256 ||
      firstViewport.accessibilityTreeSha256 !== accessibilityTree.sha256
    ) {
      throw stepErr(
        index,
        "capture-surface.documentOriginProof must bind the frozen first viewport evidence",
      );
    }
    parsedDocumentOrigin = {
      index: 0,
      offsetY: 0,
      appendedHeight: 0,
      capturedAt: documentOrigin.capturedAt as number,
      width: documentOrigin.width as number,
      height: documentOrigin.height as number,
      screenshot,
      accessibilityTree,
    };
    parsedDocumentOriginProof = {
      schemaVersion: 1,
      method: "frozen-origin-match",
      firstViewport: {
        screenshotSha256: screenshot.sha256,
        accessibilityTreeSha256: accessibilityTree.sha256,
      },
    };
  } else if (documentOriginProof) {
    throw stepErr(index, "capture-surface.documentOriginProof requires documentOrigin");
  }
  const baseline =
    isObject(raw.baseline) && !Array.isArray(raw.baseline) ? raw.baseline : undefined;
  return {
    kind: "capture-surface",
    screenId: raw.screenId.trim(),
    screenTitle: raw.screenTitle.trim(),
    variantId: raw.variantId.trim(),
    surfaceId: raw.surfaceId.trim(),
    baselineCaptureId: raw.baselineCaptureId.trim(),
    reason: raw.reason.trim(),
    ...(isNumber(raw.maxScrolls) ? { maxScrolls: raw.maxScrolls } : {}),
    ...(raw.forceRecapture === true ? { forceRecapture: true } : {}),
    ...(raw.baselineTrust === "trusted" || raw.baselineTrust === "recapture-required"
      ? { baselineTrust: raw.baselineTrust }
      : {}),
    ...(isString(raw.baselineTrustReason) && raw.baselineTrustReason.trim()
      ? { baselineTrustReason: raw.baselineTrustReason.trim() }
      : {}),
    ...(parsedDocumentOrigin
      ? {
          documentOrigin: parsedDocumentOrigin,
        }
      : {}),
    ...(parsedDocumentOriginProof ? { documentOriginProof: parsedDocumentOriginProof } : {}),
    ...(baseline && isNumber(baseline.semanticNodeCount)
      ? {
          baseline: {
            ...(isNumber(baseline.compositeWidth)
              ? { compositeWidth: baseline.compositeWidth }
              : {}),
            ...(isNumber(baseline.compositeHeight)
              ? { compositeHeight: baseline.compositeHeight }
              : {}),
            semanticNodeCount: baseline.semanticNodeCount,
          },
        }
      : {}),
    ...(note ? { note } : {}),
  };
}

function parseStepMetadata(
  raw: Record<string, unknown>,
  index: number,
): {
  id?: string;
  group?: string;
  evidence?: RecordedStepEvidence;
  note?: string;
  optional?: boolean;
  check?: RecipeStep["check"];
  when?: RecipeStep["when"];
} {
  const metadata: {
    id?: string;
    group?: string;
    evidence?: RecordedStepEvidence;
    note?: string;
    optional?: boolean;
    check?: RecipeStep["check"];
    when?: RecipeStep["when"];
  } = {};
  if (raw.id !== undefined) {
    if (!isString(raw.id) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(raw.id)) {
      throw stepErr(index, "id must use letters, numbers, hyphens, and underscores only");
    }
    metadata.id = raw.id;
  }
  if (raw.group !== undefined) {
    if (!isString(raw.group) || raw.group.trim().length === 0 || raw.group.trim().length > 96) {
      throw stepErr(index, "group must be a non-empty string of at most 96 characters");
    }
    metadata.group = raw.group.trim();
  }
  if (raw.evidence !== undefined) metadata.evidence = parseRecordedEvidence(raw.evidence, index);
  if (isString(raw.note) && raw.note.trim()) metadata.note = raw.note;
  if (raw.optional !== undefined) {
    if (typeof raw.optional !== "boolean") throw stepErr(index, "optional must be a boolean");
    metadata.optional = raw.optional;
  }
  const check = parseCampaignCheck(raw, index);
  if (check) metadata.check = check;
  if (raw.when !== undefined) {
    if (!isObject(raw.when)) throw stepErr(index, "when must be an object");
    if (!(raw.when.condition === "present" || raw.when.condition === "absent")) {
      throw stepErr(index, 'when.condition must be "present" or "absent"');
    }
    const target = parseTarget(raw.when.target, index, "when.target");
    if (!target.identifier && !target.ref && !target.label && !target.text) {
      throw stepErr(index, "when.target must contain identifier, ref, label, or text");
    }
    let region: NonNullable<RecipeStep["when"]>["region"];
    if (raw.when.region !== undefined) {
      if (!isObject(raw.when.region)) throw stepErr(index, "when.region must be an object");
      const parsed: NonNullable<RecipeStep["when"]>["region"] = {};
      for (const key of ["minX", "maxX", "minY", "maxY"] as const) {
        const value = raw.when.region[key];
        if (value === undefined) continue;
        if (!isNumber(value) || value < 0 || value > 1) {
          throw stepErr(index, `when.region.${key} must be between 0 and 1`);
        }
        parsed[key] = value;
      }
      if (parsed.minX !== undefined && parsed.maxX !== undefined && parsed.minX >= parsed.maxX) {
        throw stepErr(index, "when.region.minX must be less than maxX");
      }
      if (parsed.minY !== undefined && parsed.maxY !== undefined && parsed.minY >= parsed.maxY) {
        throw stepErr(index, "when.region.minY must be less than maxY");
      }
      region = parsed;
    }
    metadata.when = {
      target,
      condition: raw.when.condition,
      ...(region ? { region } : {}),
    };
  }
  return metadata;
}

/**
 * Validate an unknown steps array field-by-field. Throws `Error` naming the
 * first invalid step index and why. Returns the narrowed `RecipeStep[]`.
 */

export {
  MAX_WAIT_MS,
  PARAMETER_NAME,
  isNumber,
  isObject,
  isString,
  parseRecordedEvidence,
  parseStepMetadata,
  parseStepPoint,
  parseTarget,
  parseCaptureSurfaceStep,
  parseScrollRuntimeOptions,
  parseScrollStep,
  parseRevealStep,
  parseTapRuntimeOptions,
  parseTourRuntimeOptions,
  stepErr,
  targetHasStrategy,
};

/**
 * Offline selector assessment for one compiled Test step.
 *
 * The caller owns recipe traversal and finding aggregation; this module owns
 * the immutable selector/raw-tree decision for one step.
 */
import type {
  AppMapCompiledRawAccessibilityTargetProfile,
  AppMapCompiledRawAccessibilityVariant,
  NormalizedSemanticNode,
  OfflineTestPreflightEvidenceSource,
  OfflineTestPreflightFinding,
  OfflineTestPreflightSelector,
  RecipeStep,
} from "@relay/protocol";
import { preflightSemanticActivation } from "./device-target-resolution.js";
import type { SnapshotNode } from "./device.js";
import { goneSelectorAssessment } from "./offline-test-preflight-gone-selector.js";
import {
  rawCandidateLedger,
  rawSourceMetadata,
  rawSourceReferences,
  type OfflineTestPreflightRawEvidenceStatus,
  type OfflineTestPreflightRawSource,
} from "./offline-test-preflight-raw.js";
import {
  rawVariantLabel,
  rawVariantScopeLabels,
  scopeRawSourcesToRuntimeVariant,
} from "./offline-test-preflight-variant-scope.js";
import {
  boundedCandidates,
  excludesDynamicContent,
  matchesTarget,
  revealPositions,
  targetDescription,
  targetSummary,
  uniqueReferences,
} from "./offline-test-preflight-selector-utils.js";

export type SelectorAssessment = {
  selector: OfflineTestPreflightSelector;
  findings: OfflineTestPreflightFinding[];
  rawEvidenceRecapture?: {
    status: OfflineTestPreflightRawEvidenceStatus;
    sources: OfflineTestPreflightEvidenceSource[];
    variantScope?: OfflineTestPreflightSelector["rawVariantScope"];
  };
};

export function selectorAssessment(input: {
  recipeId: string;
  step: Extract<RecipeStep, { kind: "tap" | "reveal" | "expect" | "wait-for" }>;
  screenId?: string;
  screenTitle?: string;
  observations: readonly { nodes: NormalizedSemanticNode[] }[];
  rawSources?: readonly OfflineTestPreflightRawSource[];
  rawEvidenceReferences?: readonly string[];
  rawEvidenceStatus?: OfflineTestPreflightRawEvidenceStatus;
  rawEvidenceDeclared?: boolean;
  rawVariants?: readonly AppMapCompiledRawAccessibilityVariant[];
  rawTargetProfiles?: readonly AppMapCompiledRawAccessibilityTargetProfile[];
  selectedTargetProfileId?: string;
  postTextMutation?: boolean;
}): SelectorAssessment {
  const {
    recipeId,
    step,
    screenId,
    screenTitle,
    observations,
    rawSources = [],
    rawEvidenceReferences,
    rawEvidenceStatus,
    rawEvidenceDeclared = false,
    rawVariants,
    rawTargetProfiles,
    selectedTargetProfileId,
    postTextMutation = false,
  } = input;
  const target = step.target;
  const checksGone =
    step.kind === "expect" &&
    step.condition === "gone" &&
    !target.relation &&
    Boolean(target.identifier || target.label || target.text);
  const description = targetDescription(target);
  const hasReviewedFallback =
    target.point?.fallbackPolicy === "reviewed" ||
    Boolean(target.point?.relativeTo) ||
    (step.kind === "tap" && Boolean(step.fallbackTargets?.length));
  const selectorBase = {
    recipeId,
    ...(step.id ? { recipeStepId: step.id } : {}),
    ...(screenId ? { screenId } : {}),
    stepKind: step.kind,
    target: targetSummary(target),
    ...(step.kind === "reveal" && revealPositions(step)
      ? { revealPositions: revealPositions(step) }
      : {}),
  } satisfies Omit<OfflineTestPreflightSelector, "status" | "evidence">;
  const normalizedReferences = uniqueReferences(
    screenId ? [`screen:${screenId}:observation`] : ["compiled:screen-observation"],
  );
  const rawSourcesMetadata = rawSourceMetadata(rawSources, rawEvidenceReferences ?? []);
  const rawReferences =
    rawSourceReferences(rawSourcesMetadata).length > 0
      ? rawSourceReferences(rawSourcesMetadata)
      : screenId
        ? [`screen:${screenId}:raw-accessibility-tree`]
        : ["compiled:raw-accessibility-tree"];
  const rawEvidence = {
    kind: "raw-accessibility-tree" as const,
    references: rawReferences,
    ...(rawSourcesMetadata.length ? { sources: rawSourcesMetadata } : {}),
  };
  const revealReferences = uniqueReferences(
    (step.kind === "reveal" ? revealPositions(step) : [])?.map(
      (position) => `surface:${position.surfaceId}#capture:${position.captureId}`,
    ) ?? [],
  );
  if (excludesDynamicContent(screenTitle, step)) {
    return {
      selector: {
        ...selectorBase,
        status: "excluded-dynamic-content",
        evidence: { kind: "dynamic-content-policy", references: [] },
        detail:
          "Shared Conversations content is intentionally dynamic; only its reviewed shell and entry/exit controls are checked.",
      },
      findings: [],
    };
  }
  if (
    target.point &&
    !target.identifier &&
    !target.ref &&
    !target.label &&
    !target.text &&
    !target.relation
  ) {
    return {
      selector: {
        ...selectorBase,
        status: "point-only",
        evidence: { kind: "none", references: [] },
        detail:
          "Only a recorded coordinate is available; no semantic target can be replayed offline.",
      },
      findings: [
        {
          severity: "warning",
          code: "point-only-selector",
          recipeId,
          ...(step.id ? { recipeStepId: step.id } : {}),
          message: `${description} has only a coordinate fallback; it cannot be proven across layout or locale changes.`,
        },
      ],
    };
  }
  const availableRawSources = rawSources.filter(
    (source): source is OfflineTestPreflightRawSource & { nodes: ReadonlyArray<SnapshotNode> } =>
      Boolean(source.nodes?.length),
  );
  if (!rawEvidenceStatus && availableRawSources.length) {
    const variantScope = scopeRawSourcesToRuntimeVariant({
      sources: availableRawSources,
      target,
      ...(rawVariants ? { variants: rawVariants } : {}),
      ...(rawTargetProfiles ? { targetProfiles: rawTargetProfiles } : {}),
      ...(selectedTargetProfileId ? { selectedTargetProfileId } : {}),
    });
    const allAttempts = availableRawSources.map((source) => ({
      source,
      attempt: preflightSemanticActivation([...source.nodes], target),
    }));
    const resolutions = new Map<
      OfflineTestPreflightRawSource,
      { bounds: { x: number; y: number; width: number; height: number } }
    >(
      allAttempts.flatMap(({ source, attempt }) =>
        attempt.status === "proven" ? [[source, attempt.resolution] as const] : [],
      ),
    );
    const rawLedger = rawCandidateLedger({
      sources: availableRawSources,
      target,
      resolutions,
    });
    const variantScopeFields = variantScope.scope
      ? { rawVariantScope: structuredClone(variantScope.scope) }
      : {};
    const sourceIsSelectedVariant = (source: OfflineTestPreflightRawSource): boolean => {
      const selected = variantScope.scope?.selectedVariant;
      const sourceVariant = source.source.variant;
      return Boolean(
        selected &&
        sourceVariant &&
        selected.id === sourceVariant.id &&
        selected.targetProfileId === sourceVariant.targetProfileId &&
        selected.targetId === sourceVariant.targetId &&
        selected.platform === sourceVariant.platform &&
        selected.viewport?.width === sourceVariant.viewport?.width &&
        selected.viewport?.height === sourceVariant.viewport?.height,
      );
    };
    const usesStableCrossVariantMethod = (
      source: OfflineTestPreflightRawSource,
      attempt: (typeof allAttempts)[number]["attempt"],
    ): boolean => {
      if (variantScope.state !== "selected" || sourceIsSelectedVariant(source)) return true;
      if (attempt.status !== "proven") return true;
      return attempt.resolution.method === (target.relation ? "relation" : "identifier");
    };
    const canUseScopedAttempt = (
      source: OfflineTestPreflightRawSource,
      attempt: (typeof allAttempts)[number]["attempt"],
    ): boolean =>
      variantScope.compatibleSources.includes(source) &&
      usesStableCrossVariantMethod(source, attempt);
    const candidateLabels = rawVariantScopeLabels(variantScope.scope);
    if (variantScope.state === "selection-required") {
      const detail = `Raw evidence spans multiple target/locale variants (${candidateLabels || "unknown variants"}). Select a runtime target profile before Relay can prove this selector; it will not infer locale from visible text.`;
      return {
        selector: {
          ...selectorBase,
          status: "variant-selection-required",
          evidence: rawEvidence,
          ...variantScopeFields,
          ...(rawLedger.candidates.length ? { rawCandidates: rawLedger.candidates } : {}),
          ...(rawLedger.count ? { rawCandidateCount: rawLedger.count } : {}),
          detail,
        },
        findings: [
          {
            severity: "blocker",
            code: "raw-evidence-variant-selection-required",
            recipeId,
            ...(step.id ? { recipeStepId: step.id } : {}),
            ...(screenId ? { screenId } : {}),
            ...(rawSourcesMetadata.length ? { evidence: rawSourcesMetadata } : {}),
            message: `${description} cannot be proven until a runtime target profile is selected; frozen candidates are ${candidateLabels || "unidentified"}.`,
          },
        ],
      };
    }
    if (variantScope.state === "selection-missing") {
      const detail = `Selected runtime target profile ${selectedTargetProfileId} does not resolve to one frozen target identity for this screen. Retarget preflight to ${candidateLabels || "a captured variant"}, or repair or recapture the selected profile.`;
      return {
        selector: {
          ...selectorBase,
          status: "variant-incompatible",
          evidence: rawEvidence,
          ...variantScopeFields,
          ...(rawLedger.candidates.length ? { rawCandidates: rawLedger.candidates } : {}),
          ...(rawLedger.count ? { rawCandidateCount: rawLedger.count } : {}),
          detail,
        },
        findings: [
          {
            severity: "blocker",
            code: "raw-evidence-variant-recapture-required",
            recipeId,
            ...(step.id ? { recipeStepId: step.id } : {}),
            ...(screenId ? { screenId } : {}),
            ...(rawSourcesMetadata.length ? { evidence: rawSourcesMetadata } : {}),
            message: `${description} cannot resolve selected target profile ${selectedTargetProfileId} to one frozen target identity; retarget preflight, or repair or recapture that profile before relying on offline raw evidence.`,
          },
        ],
      };
    }
    const attempts = allAttempts.filter(({ source, attempt }) =>
      canUseScopedAttempt(source, attempt),
    );
    const presenceSources = attempts.filter(
      ({ source }) => variantScope.state !== "selected" || sourceIsSelectedVariant(source),
    );
    if (checksGone && presenceSources.length) {
      return goneSelectorAssessment({
        base: {
          ...selectorBase,
          ...variantScopeFields,
          ...(rawLedger.candidates.length ? { rawCandidates: rawLedger.candidates } : {}),
          ...(rawLedger.count ? { rawCandidateCount: rawLedger.count } : {}),
        },
        evidence: rawEvidence,
        observations: presenceSources.map(({ source }) => ({
          nodes: source.nodes!.map((node) => ({ ...node, role: node.role ?? node.type ?? "" })),
        })),
      });
    }
    const proven = attempts.find((attempt) => attempt.attempt.status === "proven");
    if (proven?.attempt.status === "proven") {
      return {
        selector: {
          ...selectorBase,
          status: "resolved",
          evidence: rawEvidence,
          ...variantScopeFields,
          ...(rawLedger.candidates.length ? { rawCandidates: rawLedger.candidates } : {}),
          ...(rawLedger.count ? { rawCandidateCount: rawLedger.count } : {}),
          resolution: {
            method: proven.attempt.resolution.method,
            ...(proven.attempt.resolution.activation
              ? { activation: proven.attempt.resolution.activation }
              : {}),
            snapshotBounds: { ...proven.attempt.resolution.bounds },
            provenance: structuredClone(proven.source.source),
          },
        },
        findings: [],
      };
    }
    const incompatibleProven = allAttempts.find(
      ({ source, attempt }) => !canUseScopedAttempt(source, attempt) && attempt.status === "proven",
    );
    if (
      variantScope.state === "selected" &&
      (incompatibleProven !== undefined || attempts.length === 0)
    ) {
      const selected = variantScope.scope?.selectedVariant;
      const selectedLabel = selected
        ? rawVariantLabel(selected)
        : (selectedTargetProfileId ?? "selected profile");
      const incompatible = (variantScope.scope?.candidates ?? [])
        .filter((candidate) => candidate.compatibility === "incompatible")
        .map((candidate) => `${rawVariantLabel(candidate.variant)}: ${candidate.reason}`)
        .join(", ");
      const detail = incompatibleProven
        ? `Only an incompatible raw Variant proves this selector. ${selectedLabel} remains the selected runtime Variant; ${incompatible || "the candidate crosses an unproven variant boundary"}.`
        : `No compatible raw tree is available for selected runtime Variant ${selectedLabel}; ${incompatible || "capture or retarget is required"}.`;
      return {
        selector: {
          ...selectorBase,
          status: "variant-incompatible",
          evidence: rawEvidence,
          ...variantScopeFields,
          ...(rawLedger.candidates.length ? { rawCandidates: rawLedger.candidates } : {}),
          ...(rawLedger.count ? { rawCandidateCount: rawLedger.count } : {}),
          detail,
        },
        findings: [
          {
            severity: "blocker",
            code: "raw-evidence-variant-recapture-required",
            recipeId,
            ...(step.id ? { recipeStepId: step.id } : {}),
            ...(screenId ? { screenId } : {}),
            ...(rawSourcesMetadata.length ? { evidence: rawSourcesMetadata } : {}),
            message: `${description} is not proven for selected runtime Variant ${selectedLabel}; recapture that Variant or retarget this selector to an explicit stable identifier/relation.`,
          },
        ],
      };
    }
    const blockedAttempts = attempts
      .map(({ attempt }) => attempt)
      .filter(
        (attempt): attempt is Extract<typeof attempt, { status: "blocked" }> =>
          attempt.status === "blocked",
      );
    const ambiguous = blockedAttempts.find((attempt) => attempt.code === "ambiguous");
    const headingOnly = blockedAttempts.find((attempt) => attempt.code === "heading-only-noop");
    const detail = ambiguous?.detail ?? headingOnly?.detail ?? blockedAttempts[0]?.detail;
    const needsPostTextCheck =
      postTextMutation &&
      step.kind === "tap" &&
      !ambiguous &&
      !target.relation &&
      attempts.some(({ source }) => {
        if (variantScope.state === "selected" && !sourceIsSelectedVariant(source)) return false;
        const matches = (source.nodes ?? []).filter(
          (node) =>
            matchesTarget([{ ...node, role: node.role ?? node.type ?? "" }], target).length > 0,
        );
        const candidate = matches.length === 1 ? matches[0] : undefined;
        return Boolean(
          candidate?.enabled === false &&
          candidate.hittable === true &&
          candidate.rect &&
          candidate.rect.width > 0 &&
          candidate.rect.height > 0,
        );
      });
    return {
      selector: {
        ...selectorBase,
        status: ambiguous ? "ambiguous" : "absent",
        evidence: rawEvidence,
        ...variantScopeFields,
        ...(rawLedger.candidates.length ? { rawCandidates: rawLedger.candidates } : {}),
        ...(rawLedger.count ? { rawCandidateCount: rawLedger.count } : {}),
        detail,
      },
      findings: [
        {
          severity: needsPostTextCheck || hasReviewedFallback ? "warning" : "blocker",
          code: ambiguous ? "selector-ambiguous" : "selector-absent",
          recipeId,
          ...(step.id ? { recipeStepId: step.id } : {}),
          ...(rawSourcesMetadata.length ? { evidence: rawSourcesMetadata } : {}),
          message: needsPostTextCheck
            ? `${description} is disabled in the saved initial screen. A preceding text entry may enable it; Relay must resolve and check it again before clicking.`
            : `${description} cannot be activated from frozen raw accessibility evidence${detail ? `: ${detail}` : ""}${hasReviewedFallback ? "; a reviewed fallback needs live confirmation" : ""}.`,
        },
      ],
    };
  }

  const flattenedMatches = observations.flatMap((observation) =>
    matchesTarget(observation.nodes, target),
  );
  const rawScreenWasDeclared =
    rawEvidenceDeclared || rawSources.length > 0 || rawSourcesMetadata.length > 0;
  const unavailableRawEvidence =
    rawEvidenceStatus ??
    (rawScreenWasDeclared && availableRawSources.length === 0
      ? rawSources.length
        ? "unreadable"
        : "missing"
      : undefined);
  if (unavailableRawEvidence) {
    const unavailableVariantScope = scopeRawSourcesToRuntimeVariant({
      sources: rawSources,
      target,
      ...(rawVariants ? { variants: rawVariants } : {}),
      ...(rawTargetProfiles ? { targetProfiles: rawTargetProfiles } : {}),
      ...(selectedTargetProfileId ? { selectedTargetProfileId } : {}),
    });
    const unavailableVariantScopeFields = unavailableVariantScope.scope
      ? { rawVariantScope: structuredClone(unavailableVariantScope.scope) }
      : {};
    if (unavailableVariantScope.state === "selection-required") {
      const candidates = rawVariantScopeLabels(unavailableVariantScope.scope);
      return {
        selector: {
          ...selectorBase,
          status: "variant-selection-required",
          evidence: rawEvidence,
          ...unavailableVariantScopeFields,
          detail: `No raw accessibility tree can be scoped until a runtime target profile is selected from ${candidates || "the frozen Variants"}. Relay will not infer locale from visible text.`,
        },
        findings: [
          {
            severity: "blocker",
            code: "raw-evidence-variant-selection-required",
            recipeId,
            ...(step.id ? { recipeStepId: step.id } : {}),
            ...(screenId ? { screenId } : {}),
            ...(rawSourcesMetadata.length ? { evidence: rawSourcesMetadata } : {}),
            message: `${description} cannot be proven until a runtime target profile is selected; frozen candidates are ${candidates || "unidentified"}.`,
          },
        ],
      };
    }
    if (unavailableVariantScope.state === "selection-missing") {
      const candidates = rawVariantScopeLabels(unavailableVariantScope.scope);
      return {
        selector: {
          ...selectorBase,
          status: "variant-incompatible",
          evidence: rawEvidence,
          ...unavailableVariantScopeFields,
          detail: `Selected runtime target profile ${selectedTargetProfileId} does not resolve to one frozen target identity for this screen. Retarget preflight to ${candidates || "a captured variant"}, or repair or recapture the selected profile.`,
        },
        findings: [
          {
            severity: "blocker",
            code: "raw-evidence-variant-recapture-required",
            recipeId,
            ...(step.id ? { recipeStepId: step.id } : {}),
            ...(screenId ? { screenId } : {}),
            ...(rawSourcesMetadata.length ? { evidence: rawSourcesMetadata } : {}),
            message: `${description} cannot resolve selected target profile ${selectedTargetProfileId} to one frozen target identity; retarget preflight, or repair or recapture that profile before relying on offline raw evidence.`,
          },
        ],
      };
    }
    const selectedVariant = unavailableVariantScope.scope?.selectedVariant;
    const detail =
      unavailableRawEvidence === "missing"
        ? `No immutable raw accessibility tree is available for this selector${selectedVariant ? ` on selected runtime Variant ${rawVariantLabel(selectedVariant)}` : ""}.`
        : unavailableRawEvidence === "unreadable"
          ? `The immutable raw accessibility tree failed its byte, hash, or JSON integrity check${selectedVariant ? ` for selected runtime Variant ${rawVariantLabel(selectedVariant)}` : ""}.`
          : `The immutable raw accessibility tree is not bound to this Variant's current observation${selectedVariant ? ` for selected runtime Variant ${rawVariantLabel(selectedVariant)}` : ""}.`;
    return {
      selector: {
        ...selectorBase,
        status: "raw-evidence-unavailable",
        evidence: rawEvidence,
        ...unavailableVariantScopeFields,
        detail,
      },
      findings: [],
      rawEvidenceRecapture: {
        status: unavailableRawEvidence,
        sources: rawSourcesMetadata,
        ...(unavailableVariantScope.scope
          ? { variantScope: structuredClone(unavailableVariantScope.scope) }
          : {}),
      },
    };
  }
  if (!observations.length) {
    return {
      selector: {
        ...selectorBase,
        status: "source-observation-missing",
        evidence: {
          kind: step.kind === "reveal" && revealReferences.length ? "reveal-plan" : "none",
          references: step.kind === "reveal" ? revealReferences : [],
        },
        detail: "No frozen source accessibility observation is available for this selector.",
      },
      findings: [
        {
          severity: "warning",
          code: "source-observation-missing",
          recipeId,
          ...(step.id ? { recipeStepId: step.id } : {}),
          message: `${description} has no frozen source accessibility observation for offline verification.`,
        },
      ],
    };
  }

  // Preserve every occurrence. The normalized identity projection deliberately
  // omits geometry and parentage, so two identical rows are still ambiguous
  // offline; collapsing them would turn an unsafe activation into a fake pass.
  const matches = flattenedMatches;
  if (checksGone)
    return goneSelectorAssessment({
      base: selectorBase,
      evidence: { kind: "screen-observation", references: normalizedReferences },
      observations,
    });
  if (!matches.length) {
    return {
      selector: {
        ...selectorBase,
        status: "absent",
        evidence: {
          kind:
            step.kind === "reveal" && revealReferences.length
              ? "reveal-plan"
              : "screen-observation",
          references:
            step.kind === "reveal" && revealReferences.length
              ? revealReferences
              : normalizedReferences,
        },
      },
      findings: [
        {
          severity: hasReviewedFallback ? "warning" : "blocker",
          code: "selector-absent",
          recipeId,
          ...(step.id ? { recipeStepId: step.id } : {}),
          message: `${description} is absent from every frozen source accessibility observation${hasReviewedFallback ? "; a reviewed fallback needs live confirmation" : ""}.`,
        },
      ],
    };
  }
  if (target.relation) {
    return {
      selector: {
        ...selectorBase,
        status: "needs-raw-tree",
        evidence: {
          kind:
            step.kind === "reveal" && revealReferences.length
              ? "reveal-plan"
              : "screen-observation",
          references:
            step.kind === "reveal" && revealReferences.length
              ? revealReferences
              : normalizedReferences,
        },
        candidates: boundedCandidates(matches),
        detail:
          "The sibling relationship needs raw-tree structure before it can be proved offline.",
      },
      findings: [
        {
          severity: "warning",
          code: "selector-needs-raw-tree",
          recipeId,
          ...(step.id ? { recipeStepId: step.id } : {}),
          message: `${description} has a visible anchor, but its sibling relationship needs a raw accessibility tree to prove offline.`,
          candidates: boundedCandidates(matches),
        },
      ],
    };
  }
  if (matches.length > 1) {
    return {
      selector: {
        ...selectorBase,
        status: "ambiguous",
        evidence: {
          kind:
            step.kind === "reveal" && revealReferences.length
              ? "reveal-plan"
              : "screen-observation",
          references:
            step.kind === "reveal" && revealReferences.length
              ? revealReferences
              : normalizedReferences,
        },
        candidates: boundedCandidates(matches),
        detail: `${matches.length} frozen semantic candidates matched.`,
      },
      findings: [
        {
          // The normalized evidence deliberately drops bounds and parentage. It
          // can flag repeated copy, but it cannot prove that two copies are two
          // independently tappable rows (Compose frequently emits a heading and
          // a row). Raw-tree geometry is required before this becomes a block.
          severity: "warning",
          code: "selector-ambiguous",
          recipeId,
          ...(step.id ? { recipeStepId: step.id } : {}),
          message: `${description} matches ${matches.length} frozen semantic candidates and needs raw-tree geometry to distinguish them${hasReviewedFallback ? "; a reviewed fallback also exists" : ""}.`,
          candidates: boundedCandidates(matches),
        },
      ],
    };
  }
  return {
    selector: {
      ...selectorBase,
      status: "resolved",
      evidence: {
        kind:
          step.kind === "reveal" && revealReferences.length ? "reveal-plan" : "screen-observation",
        references:
          step.kind === "reveal" && revealReferences.length
            ? revealReferences
            : normalizedReferences,
      },
      candidates: boundedCandidates(matches),
    },
    findings: [],
  };
}

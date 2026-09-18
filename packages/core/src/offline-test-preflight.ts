import type {
  AppMapCompiledRawAccessibilityTargetProfile,
  AppMapCompiledRawAccessibilityVariant,
  AppMapCompiledTest,
  NormalizedSemanticNode,
  OfflineTestPreflightCursor,
  OfflineTestPreflightEvidenceSource,
  OfflineTestPreflightFinding,
  OfflineTestPreflightReport,
  OfflineTestPreflightReturn,
  OfflineTestPreflightSelector,
  RecipeStep,
} from "@relay/protocol";
import { preflightSemanticActivation } from "./device-target-resolution.js";
import { compileExecutionRisk } from "./execution-risk-compiler.js";
import { offlineTestPlanDigest } from "./offline-test-preflight-digest.js";
import { selectorAssessment } from "./offline-test-preflight-selector-assessment.js";
import type { SnapshotNode } from "./device.js";
import {
  rawCandidateLedger,
  rawSourceMetadata,
  rawSourceReferences,
  rawSourcesForScreen,
  uniqueEvidenceSources,
  type OfflineTestPreflightEvidence,
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
  isDynamicSharedConversations,
  matchesTarget,
  observationsFromNavigation,
  revealPositions,
  targetDescription,
  targetSummary,
  uniqueReferences,
} from "./offline-test-preflight-selector-utils.js";

export type { OfflineTestPreflightFinding, OfflineTestPreflightReport };
export type {
  OfflineTestPreflightEvidence,
  OfflineTestPreflightRawSource,
} from "./offline-test-preflight-raw.js";
export type OfflineTestPreflightOptions = {
  targetProfileId?: string;
};

/** Analyze one compiled graph Test using only its frozen plan and captured
 * source observations. This is intentionally a preflight, not an emulator:
 * it refuses to infer missing geometry or product state, and reports exactly
 * what still needs a device rather than producing a fictional pass. */
export function preflightCompiledAppMapTestOffline(
  plan: AppMapCompiledTest,
  evidence: OfflineTestPreflightEvidence = {},
  options: OfflineTestPreflightOptions = {},
): OfflineTestPreflightReport {
  const findings: OfflineTestPreflightFinding[] = [];
  const selectors: OfflineTestPreflightSelector[] = [];
  const cursorTimeline: OfflineTestPreflightCursor[] = [];
  const returns: OfflineTestPreflightReturn[] = [];
  const rawEvidenceFindings = new Map<string, { index: number; selector: boolean }>();
  const recordRawEvidenceRecapture = (input: {
    screenId: string;
    screenTitle: string;
    recipeId: string;
    recipeStepId?: string;
    status: OfflineTestPreflightRawEvidenceStatus;
    severity: "warning" | "blocker";
    sources: OfflineTestPreflightEvidenceSource[];
    variantScope?: OfflineTestPreflightSelector["rawVariantScope"];
    /** Prefer selector repair, but an expect-screen still establishes a blocker. */
    selector?: boolean;
  }) => {
    const selectedVariant = input.variantScope?.selectedVariant;
    const selectedSuffix = selectedVariant
      ? ` for selected runtime Variant ${rawVariantLabel(selectedVariant)}`
      : "";
    const message =
      input.status === "missing"
        ? `${input.screenTitle} has no immutable raw accessibility tree${selectedSuffix}; recapture this screen before relying on offline geometry.`
        : input.status === "unreadable"
          ? `${input.screenTitle}'s frozen raw accessibility tree is unavailable or corrupt${selectedSuffix}; recapture this screen before relying on offline geometry.`
          : `${input.screenTitle}'s frozen raw accessibility tree is not bound to its current observation${selectedSuffix}; recapture this screen before relying on offline geometry.`;
    const finding: OfflineTestPreflightFinding = {
      severity: input.severity,
      code: "raw-evidence-recapture-required",
      recipeId: input.recipeId,
      ...(input.recipeStepId ? { recipeStepId: input.recipeStepId } : {}),
      screenId: input.screenId,
      message,
      ...(input.sources.length ? { evidence: uniqueEvidenceSources(input.sources) } : {}),
    };
    const existing = rawEvidenceFindings.get(input.screenId);
    if (!existing) {
      rawEvidenceFindings.set(input.screenId, {
        index: findings.length,
        selector: input.selector === true,
      });
      findings.push(finding);
      return;
    }
    // Upgrade one compact repair when a declared source has no usable raw tree.
    if (
      input.severity === "blocker" &&
      (findings[existing.index]?.severity !== "blocker" ||
        (input.selector === true && !existing.selector))
    ) {
      findings[existing.index] = finding;
      rawEvidenceFindings.set(input.screenId, {
        index: existing.index,
        selector: input.selector === true,
      });
    }
  };
  let checkedSelectors = 0;
  const destEndRecipes = new Set(plan.destEndRecipeIds ?? []);
  const recipes = Object.entries(plan.recipes).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [, recipe] of recipes) {
    let observations: Array<{ nodes: NormalizedSemanticNode[] }> = [];
    let sourceScreenId: string | undefined;
    let sourceScreenTitle: string | undefined;
    let postTextMutation = false;
    const destEndRecipe = destEndRecipes.has(recipe.id);
    for (const [stepIndex, step] of recipe.steps.entries()) {
      if (step.kind === "expect-screen") {
        postTextMutation = false;
        observations = step.observations ?? [];
        sourceScreenId = step.screenId;
        sourceScreenTitle = step.screenTitle;
        const rawEvidenceStatus = evidence.rawEvidenceStatusByScreenId?.[sourceScreenId];
        // Shared Conversations excludes passive dynamic content, not entry/exit controls.
        if (rawEvidenceStatus && !isDynamicSharedConversations(step.screenTitle)) {
          recordRawEvidenceRecapture({
            screenId: sourceScreenId,
            screenTitle: step.screenTitle,
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            status: rawEvidenceStatus,
            severity: "blocker",
            sources: rawSourceMetadata(
              rawSourcesForScreen(evidence, sourceScreenId),
              evidence.rawEvidenceReferencesByScreenId?.[sourceScreenId] ?? [],
            ),
          });
        }
        if (step.returnRequirement) {
          const returnContract: OfflineTestPreflightReturn = {
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            connectionId: step.returnRequirement.connectionId,
            // The expectation's screen is the only reviewed return target.
            sourceScreenId: step.returnRequirement.destinationScreenId,
            destinationScreenId: step.screenId,
            status: "review-required",
          };
          returns.push(returnContract);
          cursorTimeline.push({
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            stepIndex,
            state: "return-required",
            screenId: step.screenId,
            screenTitle: step.screenTitle,
            reason: `Return from ${returnContract.sourceScreenId} to ${returnContract.destinationScreenId} needs an explicit reviewed inverse for ${returnContract.connectionId}.`,
          });
          findings.push({
            severity: "blocker",
            code: "unresolved-return",
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            screenId: step.screenId,
            message: `A reviewed return is still required before ${step.screenTitle}; Relay will not invent Back navigation.`,
          });
        } else {
          cursorTimeline.push({
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            stepIndex,
            state: "expected",
            screenId: step.screenId,
            screenTitle: step.screenTitle,
            reason: `${step.screenTitle} is the next declared screen expectation; a device run must still prove it.`,
          });
        }
        continue;
      }
      if (
        step.kind === "tap" ||
        step.kind === "reveal" ||
        step.kind === "expect" ||
        step.kind === "wait-for"
      ) {
        checkedSelectors += 1;
        const navigationObservations =
          step.kind === "reveal" ? observationsFromNavigation(step.navigation) : [];
        const sourceObservations = observations.length ? observations : navigationObservations;
        const sourceRawSources = rawSourcesForScreen(evidence, sourceScreenId);
        const assessment = selectorAssessment({
          recipeId: recipe.id,
          step,
          ...(sourceScreenId ? { screenId: sourceScreenId } : {}),
          ...(sourceScreenTitle ? { screenTitle: sourceScreenTitle } : {}),
          observations: sourceObservations,
          ...(sourceRawSources.length ? { rawSources: sourceRawSources } : {}),
          ...(sourceScreenId && plan.rawAccessibilityVariantsByScreenId?.[sourceScreenId]
            ? { rawVariants: plan.rawAccessibilityVariantsByScreenId[sourceScreenId] }
            : {}),
          ...(plan.rawAccessibilityTargetProfiles
            ? { rawTargetProfiles: plan.rawAccessibilityTargetProfiles }
            : {}),
          ...(options.targetProfileId ? { selectedTargetProfileId: options.targetProfileId } : {}),
          ...(sourceScreenId && evidence.rawEvidenceReferencesByScreenId?.[sourceScreenId]
            ? { rawEvidenceReferences: evidence.rawEvidenceReferencesByScreenId[sourceScreenId] }
            : {}),
          ...(sourceScreenId && evidence.rawEvidenceStatusByScreenId?.[sourceScreenId]
            ? { rawEvidenceStatus: evidence.rawEvidenceStatusByScreenId[sourceScreenId] }
            : {}),
          ...(sourceScreenId &&
          (Object.hasOwn(evidence.rawSourcesByScreenId ?? {}, sourceScreenId) ||
            Object.hasOwn(evidence.rawObservationsByScreenId ?? {}, sourceScreenId) ||
            Object.hasOwn(evidence.rawEvidenceReferencesByScreenId ?? {}, sourceScreenId) ||
            Object.hasOwn(evidence.rawEvidenceStatusByScreenId ?? {}, sourceScreenId))
            ? { rawEvidenceDeclared: true }
            : {}),
          postTextMutation,
        });
        selectors.push(assessment.selector);
        findings.push(...assessment.findings);
        if (step.kind === "tap" || step.kind === "reveal") postTextMutation = false;
        if (assessment.rawEvidenceRecapture && sourceScreenId) {
          recordRawEvidenceRecapture({
            screenId: sourceScreenId,
            screenTitle: sourceScreenTitle ?? sourceScreenId,
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            status: assessment.rawEvidenceRecapture.status,
            severity: "blocker",
            sources: assessment.rawEvidenceRecapture.sources,
            ...(assessment.rawEvidenceRecapture.variantScope
              ? { variantScope: assessment.rawEvidenceRecapture.variantScope }
              : {}),
            selector: true,
          });
        }
        if (navigationObservations.length) observations = navigationObservations;
        if (step.kind === "tap") {
          cursorTimeline.push({
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            stepIndex,
            state: "unknown",
            reason:
              "A tap can change navigation; the cursor remains unknown until a later screen expectation is proved at runtime.",
          });
          if (destEndRecipe) {
            // Dest-end chrome stays on the origin identity. Later Speed/Submit
            // selectors must use the dest-end destination tree or live wait-for,
            // never the origin unique-variant raw tree.
            sourceScreenId = undefined;
            sourceScreenTitle = undefined;
            observations = plan.destEndObservationsByRecipeId?.[recipe.id] ?? [];
          }
        }
        continue;
      }
      if (step.kind === "type") postTextMutation = true;
      if (
        step.kind === "key" ||
        step.kind === "swipe" ||
        step.kind === "app" ||
        step.kind === "offline" ||
        step.kind === "settings"
      ) {
        postTextMutation = false;
        cursorTimeline.push({
          recipeId: recipe.id,
          ...(step.id ? { recipeStepId: step.id } : {}),
          stepIndex,
          state: "unknown",
          reason: `${step.kind} can change navigation; the cursor remains unknown until a later screen expectation is proved at runtime.`,
        });
        if (destEndRecipe) {
          // Dest-end app/key/swipe/offline/settings can leave the origin
          // identity. Later wait-for must use dest-end observations or live
          // wait-for, never the origin unique-variant raw tree.
          sourceScreenId = undefined;
          sourceScreenTitle = undefined;
          observations = plan.destEndObservationsByRecipeId?.[recipe.id] ?? [];
        }
      }
      if (step.kind === "capture-surface" && step.baselineTrust === "recapture-required") {
        findings.push({
          severity: "warning",
          code: "surface-recapture-required",
          recipeId: recipe.id,
          ...(step.id ? { recipeStepId: step.id } : {}),
          screenId: step.screenId,
          message:
            step.baselineTrustReason ??
            `${step.screenTitle} has an incomplete logical-surface baseline and requires recapture.`,
        });
      }
    }
  }
  const scopedRawBlockerScreens = new Set(
    findings
      .filter(
        (finding) =>
          finding.severity === "blocker" &&
          finding.code.startsWith("raw-evidence-variant-") &&
          Boolean(finding.screenId),
      )
      .map((finding) => finding.screenId!),
  );
  const compactFindings = findings.filter(
    (finding, index) =>
      !(
        finding.code === "raw-evidence-recapture-required" &&
        finding.screenId &&
        scopedRawBlockerScreens.has(finding.screenId)
      ) &&
      findings.findIndex(
        (other) =>
          other.severity === finding.severity &&
          other.code === finding.code &&
          other.recipeStepId === finding.recipeStepId &&
          other.screenId === finding.screenId &&
          other.message === finding.message,
      ) === index,
  );
  const excludedDynamicSelectors = selectors.filter(
    (selector) => selector.status === "excluded-dynamic-content",
  ).length;
  return {
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: plan.appMapId,
    appMapRevision: plan.appMapRevision,
    testId: plan.test.id,
    planDigest: offlineTestPlanDigest(plan),
    executionRisk: compileExecutionRisk({ kind: "compiled-test", test: plan }),
    summary: {
      recipes: recipes.length,
      checkedSelectors,
      resolvedSelectors: selectors.filter((selector) => selector.status === "resolved").length,
      ...(excludedDynamicSelectors ? { excludedDynamicSelectors } : {}),
      unknownCursorTransitions: cursorTimeline.filter((cursor) => cursor.state === "unknown")
        .length,
      reviewRequiredReturns: returns.length,
      blockers: compactFindings.filter((finding) => finding.severity === "blocker").length,
      warnings: compactFindings.filter((finding) => finding.severity === "warning").length,
    },
    selectors,
    cursorTimeline,
    returns,
    findings: compactFindings,
  };
}

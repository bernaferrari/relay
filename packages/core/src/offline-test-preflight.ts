import type {
  AppMapCompiledTest,
  NormalizedSemanticNode,
  OfflineTestPreflightCursor,
  OfflineTestPreflightFinding,
  OfflineTestPreflightReport,
  OfflineTestPreflightReturn,
  OfflineTestPreflightSelector,
  RecipeStep,
  StepTarget,
} from "@relay/protocol";
import { createHash } from "node:crypto";
import { preflightSemanticActivation } from "./device-target-resolution.js";
import type { SnapshotNode } from "./device.js";

export type { OfflineTestPreflightFinding, OfflineTestPreflightReport };

/** Immutable raw accessibility snapshots keyed by the authored source screen.
 * The caller owns evidence loading; this module stays device-free and never
 * reads current App Map state by itself. */
export type OfflineTestPreflightEvidence = {
  rawObservationsByScreenId?: Readonly<Record<string, ReadonlyArray<ReadonlyArray<SnapshotNode>>>>;
  /** Durable references for the supplied raw observations. Preflight never
   * opens them; it only carries the frozen provenance into its report. */
  rawEvidenceReferencesByScreenId?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** A frozen tree reference existed but cannot be used now, or the frozen
   * Variant predates raw-tree capture. This is a recapture request, never a
   * reason to guess from flattened semantics. */
  rawEvidenceStatusByScreenId?: Readonly<Record<string, "missing" | "unreadable">>;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function targetDescription(target: StepTarget): string {
  if (target.relation?.kind === "following-row") {
    return `the row following ${targetDescription(target.relation.anchor)}`;
  }
  return (
    target.identifier ??
    target.ref ??
    target.label ??
    target.text ??
    (target.point ? "point" : "target")
  );
}

function candidate(node: NormalizedSemanticNode) {
  return {
    role: node.role,
    ...(node.identifier ? { identifier: node.identifier } : {}),
    ...(node.label ? { label: node.label } : {}),
    ...(node.value ? { value: node.value } : {}),
  };
}

function compareCandidates(left: NormalizedSemanticNode, right: NormalizedSemanticNode): number {
  const key = (node: NormalizedSemanticNode) =>
    [node.role, node.identifier ?? "", node.label ?? "", node.value ?? ""].join("\u0000");
  const leftKey = key(left);
  const rightKey = key(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function boundedCandidates(nodes: readonly NormalizedSemanticNode[]) {
  return [...nodes].sort(compareCandidates).slice(0, 5).map(candidate);
}

function uniqueReferences(references: readonly string[]): string[] {
  return [...new Set(references.filter((reference) => reference.trim()))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function targetSummary(target: StepTarget): OfflineTestPreflightSelector["target"] {
  return {
    ...(target.identifier ? { identifier: target.identifier } : {}),
    ...(target.ref ? { ref: target.ref } : {}),
    ...(target.label ? { label: target.label } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(target.text ? { text: target.text } : {}),
    ...(target.relation ? { relation: structuredClone(target.relation) } : {}),
    ...(target.point ? { hasPointFallback: true } : {}),
  };
}

function revealPositions(
  step: Extract<RecipeStep, { kind: "reveal" }>,
): NonNullable<OfflineTestPreflightSelector["revealPositions"]> | undefined {
  const positions = (step.navigation ?? [])
    .map((navigation) => ({
      surfaceId: navigation.surfaceId,
      captureId: navigation.captureId,
      targetOrder: navigation.targetOrder,
      targetDocumentY: navigation.targetDocumentY,
      direction: step.direction ?? "auto",
    }))
    .sort(
      (left, right) =>
        left.targetDocumentY - right.targetDocumentY ||
        (left.surfaceId < right.surfaceId ? -1 : left.surfaceId > right.surfaceId ? 1 : 0) ||
        (left.captureId < right.captureId ? -1 : left.captureId > right.captureId ? 1 : 0),
    );
  return positions.length ? positions : undefined;
}

function observationsFromNavigation(
  navigation: Extract<RecipeStep, { kind: "reveal" }>["navigation"],
): Array<{ nodes: NormalizedSemanticNode[] }> {
  return (navigation ?? []).map((plan) => ({
    nodes: plan.anchors.map((anchor) => ({
      role: anchor.role ?? "unknown",
      ...(anchor.target.identifier ? { identifier: anchor.target.identifier } : {}),
      ...((anchor.label ?? anchor.target.label)
        ? { label: anchor.label ?? anchor.target.label }
        : {}),
      ...(anchor.value ? { value: anchor.value } : {}),
      ...(anchor.enabled !== undefined ? { enabled: anchor.enabled } : {}),
    })),
  }));
}

function matchesTarget(nodes: readonly NormalizedSemanticNode[], target: StepTarget) {
  const semantic = target.relation?.anchor ?? target;
  const role = normalize(semantic.role);
  const candidates = nodes.filter((node) => !role || normalize(node.role) === role);
  // Runtime resolution intentionally tries durable identifiers first, then
  // visible copy. Requiring every authored hint to match simultaneously makes
  // an identifier refresh look like a broken control even when its reviewed
  // label fallback is present.
  const strategies: Array<(node: NormalizedSemanticNode) => boolean> = [];
  const identifier = normalize(semantic.identifier);
  const label = normalize(semantic.label);
  const text = normalize(semantic.text);
  if (identifier) strategies.push((node) => normalize(node.identifier) === identifier);
  if (label) strategies.push((node) => normalize(node.label) === label);
  if (text) {
    strategies.push((node) =>
      [node.label, node.value, node.identifier].some((value) => normalize(value)?.includes(text)),
    );
  }
  for (const strategy of strategies) {
    const matches = candidates.filter(strategy);
    if (matches.length) return matches;
  }
  return [];
}

function selectorAssessment(input: {
  recipeId: string;
  step: Extract<RecipeStep, { kind: "tap" | "reveal" | "expect" | "wait-for" }>;
  screenId?: string;
  observations: readonly { nodes: NormalizedSemanticNode[] }[];
  rawObservations?: ReadonlyArray<ReadonlyArray<SnapshotNode>>;
  rawEvidenceReferences?: readonly string[];
}): { selector: OfflineTestPreflightSelector; findings: OfflineTestPreflightFinding[] } {
  const { recipeId, step, screenId, observations, rawObservations, rawEvidenceReferences } = input;
  const target = step.target;
  const description = targetDescription(target);
  const hasReviewedFallback =
    target.point?.fallbackPolicy === "reviewed" || Boolean(target.point?.relativeTo);
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
  const rawReferences = uniqueReferences(
    rawEvidenceReferences?.length
      ? rawEvidenceReferences
      : screenId
        ? [`screen:${screenId}:raw-accessibility-tree`]
        : ["compiled:raw-accessibility-tree"],
  );
  const revealReferences = uniqueReferences(
    (step.kind === "reveal" ? revealPositions(step) : [])?.map(
      (position) => `surface:${position.surfaceId}#capture:${position.captureId}`,
    ) ?? [],
  );
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
  if (rawObservations?.length) {
    const attempts = rawObservations.map((nodes) =>
      preflightSemanticActivation([...nodes], target),
    );
    const proven = attempts.find(
      (attempt): attempt is Extract<typeof attempt, { status: "proven" }> =>
        attempt.status === "proven",
    );
    if (proven) {
      return {
        selector: {
          ...selectorBase,
          status: "resolved",
          evidence: {
            kind: "raw-accessibility-tree",
            references: rawReferences,
          },
          resolution: {
            method: proven.resolution.method,
            ...(proven.resolution.activation ? { activation: proven.resolution.activation } : {}),
            snapshotBounds: { ...proven.resolution.bounds },
          },
        },
        findings: [],
      };
    }
    const blockedAttempts = attempts.filter(
      (attempt): attempt is Extract<typeof attempt, { status: "blocked" }> =>
        attempt.status === "blocked",
    );
    const ambiguous = blockedAttempts.find((attempt) => attempt.code === "ambiguous");
    const headingOnly = blockedAttempts.find((attempt) => attempt.code === "heading-only-noop");
    const detail = ambiguous?.detail ?? headingOnly?.detail ?? blockedAttempts[0]?.detail;
    return {
      selector: {
        ...selectorBase,
        status: ambiguous ? "ambiguous" : "absent",
        evidence: { kind: "raw-accessibility-tree", references: rawReferences },
        detail,
      },
      findings: [
        {
          severity: hasReviewedFallback ? "warning" : "blocker",
          code: ambiguous ? "selector-ambiguous" : "selector-absent",
          recipeId,
          ...(step.id ? { recipeStepId: step.id } : {}),
          message: `${description} cannot be activated from frozen raw accessibility evidence${detail ? `: ${detail}` : ""}${hasReviewedFallback ? "; a reviewed fallback needs live confirmation" : ""}.`,
        },
      ],
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
  const matches = observations.flatMap((observation) => matchesTarget(observation.nodes, target));
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

/** Analyze one compiled graph Test using only its frozen plan and captured
 * source observations. This is intentionally a preflight, not an emulator:
 * it refuses to infer missing geometry or product state, and reports exactly
 * what still needs a device rather than producing a fictional pass. */
export function preflightCompiledAppMapTestOffline(
  plan: AppMapCompiledTest,
  evidence: OfflineTestPreflightEvidence = {},
): OfflineTestPreflightReport {
  const findings: OfflineTestPreflightFinding[] = [];
  const selectors: OfflineTestPreflightSelector[] = [];
  const cursorTimeline: OfflineTestPreflightCursor[] = [];
  const returns: OfflineTestPreflightReturn[] = [];
  const rawEvidenceFindingKeys = new Set<string>();
  let checkedSelectors = 0;
  const recipes = Object.entries(plan.recipes).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [, recipe] of recipes) {
    let observations: Array<{ nodes: NormalizedSemanticNode[] }> = [];
    let sourceScreenId: string | undefined;
    for (const [stepIndex, step] of recipe.steps.entries()) {
      if (step.kind === "expect-screen") {
        observations = step.observations ?? [];
        sourceScreenId = step.screenId;
        const rawEvidenceStatus = evidence.rawEvidenceStatusByScreenId?.[sourceScreenId];
        if (rawEvidenceStatus && !rawEvidenceFindingKeys.has(sourceScreenId)) {
          rawEvidenceFindingKeys.add(sourceScreenId);
          findings.push({
            severity: "warning",
            code: "raw-evidence-recapture-required",
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            screenId: sourceScreenId,
            message:
              rawEvidenceStatus === "missing"
                ? `${step.screenTitle} has no immutable raw accessibility tree; recapture this screen before relying on offline geometry.`
                : `${step.screenTitle}'s frozen raw accessibility tree is unavailable or corrupt; recapture this screen before relying on offline geometry.`,
          });
        }
        if (step.returnRequirement) {
          const returnContract: OfflineTestPreflightReturn = {
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            connectionId: step.returnRequirement.connectionId,
            // The forward edge's destination is the state the runner is in;
            // the expectation's screen is the only reviewed return target.
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
        const assessment = selectorAssessment({
          recipeId: recipe.id,
          step,
          ...(sourceScreenId ? { screenId: sourceScreenId } : {}),
          observations: sourceObservations,
          ...(sourceScreenId && evidence.rawObservationsByScreenId?.[sourceScreenId]
            ? { rawObservations: evidence.rawObservationsByScreenId[sourceScreenId] }
            : {}),
          ...(sourceScreenId && evidence.rawEvidenceReferencesByScreenId?.[sourceScreenId]
            ? { rawEvidenceReferences: evidence.rawEvidenceReferencesByScreenId[sourceScreenId] }
            : {}),
        });
        selectors.push(assessment.selector);
        findings.push(...assessment.findings);
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
        }
        continue;
      }
      if (step.kind === "key" || step.kind === "swipe" || step.kind === "app") {
        cursorTimeline.push({
          recipeId: recipe.id,
          ...(step.id ? { recipeStepId: step.id } : {}),
          stepIndex,
          state: "unknown",
          reason: `${step.kind} can change navigation; the cursor remains unknown until a later screen expectation is proved at runtime.`,
        });
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
  const compactFindings = findings.filter(
    (finding, index) =>
      findings.findIndex(
        (other) =>
          other.severity === finding.severity &&
          other.code === finding.code &&
          other.recipeStepId === finding.recipeStepId &&
          other.screenId === finding.screenId &&
          other.message === finding.message,
      ) === index,
  );
  return {
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: plan.appMapId,
    appMapRevision: plan.appMapRevision,
    testId: plan.test.id,
    planDigest: digest(plan),
    summary: {
      recipes: recipes.length,
      checkedSelectors,
      resolvedSelectors: selectors.filter((selector) => selector.status === "resolved").length,
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

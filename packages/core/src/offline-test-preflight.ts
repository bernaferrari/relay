import type {
  AppMapCompiledTest,
  NormalizedSemanticNode,
  OfflineTestPreflightCursor,
  OfflineTestPreflightEvidenceSource,
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

export type { OfflineTestPreflightFinding, OfflineTestPreflightReport };
export type {
  OfflineTestPreflightEvidence,
  OfflineTestPreflightRawSource,
} from "./offline-test-preflight-raw.js";

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

type SelectorAssessment = {
  selector: OfflineTestPreflightSelector;
  findings: OfflineTestPreflightFinding[];
  /** The caller collapses this to one screen-level repair finding and upgrades
   * it to a blocker. Keeping it outside `findings` prevents 40 steps from
   * producing 40 copies of the same recapture instruction. */
  rawEvidenceRecapture?: {
    status: OfflineTestPreflightRawEvidenceStatus;
    sources: OfflineTestPreflightEvidenceSource[];
  };
};

function isDynamicSharedConversations(title: string | undefined): boolean {
  return title?.trim().toLocaleLowerCase() === "shared conversations";
}

/** Shared Conversations is user-generated and deliberately not a visual or
 * selector baseline. This only excludes passive assertions on its changing
 * contents; entry/exit controls still go through normal frozen-tree proof. */
function excludesDynamicContent(
  title: string | undefined,
  step: Extract<RecipeStep, { kind: "tap" | "reveal" | "expect" | "wait-for" }>,
): boolean {
  return (
    isDynamicSharedConversations(title) && (step.kind === "expect" || step.kind === "wait-for")
  );
}

function selectorAssessment(input: {
  recipeId: string;
  step: Extract<RecipeStep, { kind: "tap" | "reveal" | "expect" | "wait-for" }>;
  screenId?: string;
  screenTitle?: string;
  observations: readonly { nodes: NormalizedSemanticNode[] }[];
  rawSources?: readonly OfflineTestPreflightRawSource[];
  rawEvidenceReferences?: readonly string[];
  rawEvidenceStatus?: OfflineTestPreflightRawEvidenceStatus;
  rawEvidenceDeclared?: boolean;
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
  } = input;
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
    const attempts = availableRawSources.map((source) => ({
      source,
      attempt: preflightSemanticActivation([...source.nodes], target),
    }));
    const resolutions = new Map<
      OfflineTestPreflightRawSource,
      { bounds: { x: number; y: number; width: number; height: number } }
    >(
      attempts.flatMap(({ source, attempt }) =>
        attempt.status === "proven" ? [[source, attempt.resolution] as const] : [],
      ),
    );
    const rawLedger = rawCandidateLedger({
      sources: availableRawSources,
      target,
      resolutions,
    });
    const proven = attempts.find((attempt) => attempt.attempt.status === "proven");
    if (proven?.attempt.status === "proven") {
      return {
        selector: {
          ...selectorBase,
          status: "resolved",
          evidence: rawEvidence,
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
    const blockedAttempts = attempts
      .map(({ attempt }) => attempt)
      .filter(
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
        evidence: rawEvidence,
        ...(rawLedger.candidates.length ? { rawCandidates: rawLedger.candidates } : {}),
        ...(rawLedger.count ? { rawCandidateCount: rawLedger.count } : {}),
        detail,
      },
      findings: [
        {
          severity: hasReviewedFallback ? "warning" : "blocker",
          code: ambiguous ? "selector-ambiguous" : "selector-absent",
          recipeId,
          ...(step.id ? { recipeStepId: step.id } : {}),
          ...(rawSourcesMetadata.length ? { evidence: rawSourcesMetadata } : {}),
          message: `${description} cannot be activated from frozen raw accessibility evidence${detail ? `: ${detail}` : ""}${hasReviewedFallback ? "; a reviewed fallback needs live confirmation" : ""}.`,
        },
      ],
    };
  }

  // Once a compiled plan declares raw evidence for its source screen, an
  // unavailable tree invalidates every raw selector proof on that screen.
  // Historical plans that never declared raw evidence retain their flattened
  // warnings, but a declared source may never silently downgrade to one.
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
    const detail =
      unavailableRawEvidence === "missing"
        ? "No immutable raw accessibility tree is available for this selector."
        : unavailableRawEvidence === "unreadable"
          ? "The immutable raw accessibility tree failed its byte, hash, or JSON integrity check."
          : "The immutable raw accessibility tree is not bound to this Variant's current observation.";
    return {
      selector: {
        ...selectorBase,
        status: "raw-evidence-unavailable",
        evidence: rawEvidence,
        detail,
      },
      findings: [],
      rawEvidenceRecapture: {
        status: unavailableRawEvidence,
        sources: rawSourcesMetadata,
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
  const rawEvidenceFindings = new Map<string, { index: number; selector: boolean }>();
  const recordRawEvidenceRecapture = (input: {
    screenId: string;
    screenTitle: string;
    recipeId: string;
    recipeStepId?: string;
    status: OfflineTestPreflightRawEvidenceStatus;
    severity: "warning" | "blocker";
    sources: OfflineTestPreflightEvidenceSource[];
    /** A selector gives the most useful repair location; an expect-screen
     * still establishes the blocker when no selector follows it. */
    selector?: boolean;
  }) => {
    const message =
      input.status === "missing"
        ? `${input.screenTitle} has no immutable raw accessibility tree; recapture this screen before relying on offline geometry.`
        : input.status === "unreadable"
          ? `${input.screenTitle}'s frozen raw accessibility tree is unavailable or corrupt; recapture this screen before relying on offline geometry.`
          : `${input.screenTitle}'s frozen raw accessibility tree is not bound to its current observation; recapture this screen before relying on offline geometry.`;
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
    // A declared source cannot support offline selector proof without its raw
    // tree. Upgrade one compact screen repair instead of adding a noisy row
    // for every dependent step.
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
  const recipes = Object.entries(plan.recipes).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [, recipe] of recipes) {
    let observations: Array<{ nodes: NormalizedSemanticNode[] }> = [];
    let sourceScreenId: string | undefined;
    let sourceScreenTitle: string | undefined;
    for (const [stepIndex, step] of recipe.steps.entries()) {
      if (step.kind === "expect-screen") {
        observations = step.observations ?? [];
        sourceScreenId = step.screenId;
        sourceScreenTitle = step.screenTitle;
        const rawEvidenceStatus = evidence.rawEvidenceStatusByScreenId?.[sourceScreenId];
        // Dynamic Shared Conversations content has no ordinary raw-baseline
        // requirement. A stable entry/exit control still reaches
        // selectorAssessment below and will request exactly one recapture if
        // its own source tree is unavailable.
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
        const sourceRawSources = rawSourcesForScreen(evidence, sourceScreenId);
        const assessment = selectorAssessment({
          recipeId: recipe.id,
          step,
          ...(sourceScreenId ? { screenId: sourceScreenId } : {}),
          ...(sourceScreenTitle ? { screenTitle: sourceScreenTitle } : {}),
          observations: sourceObservations,
          ...(sourceRawSources.length ? { rawSources: sourceRawSources } : {}),
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
        });
        selectors.push(assessment.selector);
        findings.push(...assessment.findings);
        if (assessment.rawEvidenceRecapture && sourceScreenId) {
          recordRawEvidenceRecapture({
            screenId: sourceScreenId,
            screenTitle: sourceScreenTitle ?? sourceScreenId,
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            status: assessment.rawEvidenceRecapture.status,
            severity: "blocker",
            sources: assessment.rawEvidenceRecapture.sources,
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
  const excludedDynamicSelectors = selectors.filter(
    (selector) => selector.status === "excluded-dynamic-content",
  ).length;
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

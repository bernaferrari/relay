import type {
  AppMapCompiledTest,
  NormalizedSemanticNode,
  OfflineTestPreflightFinding,
  OfflineTestPreflightReport,
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
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase();
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

function selectorFinding(input: {
  recipeId: string;
  step: Extract<RecipeStep, { kind: "tap" | "reveal" | "expect" | "wait-for" }>;
  observations: readonly { nodes: NormalizedSemanticNode[] }[];
  rawObservations?: ReadonlyArray<ReadonlyArray<SnapshotNode>>;
}): OfflineTestPreflightFinding[] {
  const { recipeId, step, observations, rawObservations } = input;
  const target = step.target;
  const description = targetDescription(target);
  const hasReviewedFallback =
    target.point?.fallbackPolicy === "reviewed" || Boolean(target.point?.relativeTo);
  if (
    target.point &&
    !target.identifier &&
    !target.ref &&
    !target.label &&
    !target.text &&
    !target.relation
  ) {
    return [
      {
        severity: "warning",
        code: "point-only-selector",
        recipeId,
        ...(step.id ? { recipeStepId: step.id } : {}),
        message: `${description} has only a coordinate fallback; it cannot be proven across layout or locale changes.`,
      },
    ];
  }
  if (rawObservations?.length) {
    const attempts = rawObservations.map((nodes) =>
      preflightSemanticActivation([...nodes], target),
    );
    if (attempts.some((attempt) => attempt.status === "proven")) return [];
    const blockedAttempts = attempts.filter(
      (attempt): attempt is Extract<typeof attempt, { status: "blocked" }> =>
        attempt.status === "blocked",
    );
    const ambiguous = blockedAttempts.find((attempt) => attempt.code === "ambiguous");
    const headingOnly = blockedAttempts.find((attempt) => attempt.code === "heading-only-noop");
    const detail = ambiguous?.detail ?? headingOnly?.detail ?? blockedAttempts[0]?.detail;
    return [
      {
        severity: hasReviewedFallback ? "warning" : "blocker",
        code: ambiguous ? "selector-ambiguous" : "selector-absent",
        recipeId,
        ...(step.id ? { recipeStepId: step.id } : {}),
        message: `${description} cannot be activated from frozen raw accessibility evidence${detail ? `: ${detail}` : ""}${hasReviewedFallback ? "; a reviewed fallback needs live confirmation" : ""}.`,
      },
    ];
  }

  if (!observations.length) {
    return [
      {
        severity: "warning",
        code: "source-observation-missing",
        recipeId,
        ...(step.id ? { recipeStepId: step.id } : {}),
        message: `${description} has no frozen source accessibility observation for offline verification.`,
      },
    ];
  }

  // Preserve every occurrence. The normalized identity projection deliberately
  // omits geometry and parentage, so two identical rows are still ambiguous
  // offline; collapsing them would turn an unsafe activation into a fake pass.
  const matches = observations.flatMap((observation) => matchesTarget(observation.nodes, target));
  if (!matches.length) {
    return [
      {
        severity: hasReviewedFallback ? "warning" : "blocker",
        code: "selector-absent",
        recipeId,
        ...(step.id ? { recipeStepId: step.id } : {}),
        message: `${description} is absent from every frozen source accessibility observation${hasReviewedFallback ? "; a reviewed fallback needs live confirmation" : ""}.`,
      },
    ];
  }
  if (target.relation) {
    return [
      {
        severity: "warning",
        code: "selector-needs-raw-tree",
        recipeId,
        ...(step.id ? { recipeStepId: step.id } : {}),
        message: `${description} has a visible anchor, but its sibling relationship needs a raw accessibility tree to prove offline.`,
        candidates: matches.slice(0, 5).map(candidate),
      },
    ];
  }
  if (matches.length > 1) {
    return [
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
        candidates: matches.slice(0, 5).map(candidate),
      },
    ];
  }
  return [];
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
  let checkedSelectors = 0;
  for (const recipe of Object.values(plan.recipes)) {
    let observations: Array<{ nodes: NormalizedSemanticNode[] }> = [];
    let sourceScreenId: string | undefined;
    for (const step of recipe.steps) {
      if (step.kind === "expect-screen") {
        observations = step.observations ?? [];
        sourceScreenId = step.screenId;
        if (step.returnRequirement) {
          findings.push({
            severity: "blocker",
            code: "unresolved-return",
            recipeId: recipe.id,
            ...(step.id ? { recipeStepId: step.id } : {}),
            screenId: step.screenId,
            message: `A reviewed return is still required before ${step.screenTitle}; Relay will not invent Back navigation.`,
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
        findings.push(
          ...selectorFinding({
            recipeId: recipe.id,
            step,
            observations: sourceObservations,
            ...(sourceScreenId && evidence.rawObservationsByScreenId?.[sourceScreenId]
              ? { rawObservations: evidence.rawObservationsByScreenId[sourceScreenId] }
              : {}),
          }),
        );
        if (navigationObservations.length) observations = navigationObservations;
        continue;
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
      recipes: Object.keys(plan.recipes).length,
      checkedSelectors,
      blockers: compactFindings.filter((finding) => finding.severity === "blocker").length,
      warnings: compactFindings.filter((finding) => finding.severity === "warning").length,
    },
    findings: compactFindings,
  };
}

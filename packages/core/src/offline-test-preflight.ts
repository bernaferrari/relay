import type {
  AppMapCompiledTest,
  NormalizedSemanticNode,
  OfflineTestPreflightFinding,
  OfflineTestPreflightReport,
  RecipeStep,
  StepTarget,
} from "@relay/protocol";
import { createHash } from "node:crypto";

export type { OfflineTestPreflightFinding, OfflineTestPreflightReport };

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

function matchesTarget(nodes: readonly NormalizedSemanticNode[], target: StepTarget) {
  const semantic = target.relation?.anchor ?? target;
  const identifier = normalize(semantic.identifier);
  const label = normalize(semantic.label);
  const text = normalize(semantic.text);
  const role = normalize(semantic.role);
  return nodes.filter((node) => {
    if (role && normalize(node.role) !== role) return false;
    if (identifier && normalize(node.identifier) !== identifier) return false;
    if (label && normalize(node.label) !== label) return false;
    if (
      text &&
      ![node.label, node.value, node.identifier].some((value) => normalize(value)?.includes(text))
    ) {
      return false;
    }
    return Boolean(identifier || label || text);
  });
}

function selectorFinding(input: {
  recipeId: string;
  step: Extract<RecipeStep, { kind: "tap" | "reveal" | "expect" | "wait-for" }>;
  observations: readonly { nodes: NormalizedSemanticNode[] }[];
}): OfflineTestPreflightFinding[] {
  const { recipeId, step, observations } = input;
  const target = step.target;
  const description = targetDescription(target);
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
        severity: "blocker",
        code: "selector-absent",
        recipeId,
        ...(step.id ? { recipeStepId: step.id } : {}),
        message: `${description} is absent from every frozen source accessibility observation.`,
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
        severity: target.point ? "warning" : "blocker",
        code: "selector-ambiguous",
        recipeId,
        ...(step.id ? { recipeStepId: step.id } : {}),
        message: `${description} matches ${matches.length} frozen semantic candidates${target.point ? "; a reviewed point fallback exists" : ""}.`,
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
): OfflineTestPreflightReport {
  const findings: OfflineTestPreflightFinding[] = [];
  let checkedSelectors = 0;
  for (const recipe of Object.values(plan.recipes)) {
    let observations: Array<{ nodes: NormalizedSemanticNode[] }> = [];
    for (const step of recipe.steps) {
      if (step.kind === "expect-screen") {
        observations = step.observations ?? [];
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
        findings.push(...selectorFinding({ recipeId: recipe.id, step, observations }));
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
      blockers: findings.filter((finding) => finding.severity === "blocker").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
    },
    findings,
  };
}

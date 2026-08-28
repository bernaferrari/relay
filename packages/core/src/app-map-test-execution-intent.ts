import type {
  AppMapCompiledRuntimeTargetProfile,
  AppMapCompiledTest,
  OfflineTestPreflightReport,
  RecipeStep,
} from "@relay/protocol";
import { createHash } from "node:crypto";
import { compileExecutionRisk } from "./execution-risk-compiler.js";
import { validateRecipeParameters, validateRecipeSteps, type Recipe } from "./recipes.js";
import { CURRENT_RECORDING_FORMAT_VERSION } from "./recording-format.js";

export const appMapTestExecutionIntentArtifactKind = "app-map-test-execution-intent" as const;

export type AppMapTestExecutionIntent = {
  schemaVersion: 1;
  kind: typeof appMapTestExecutionIntentArtifactKind;
  sourcePlan: {
    appMapId: string;
    appMapRevision: number;
    testId: string;
    rootRecipeId: string;
    digest: string;
    recipeGraphDigest: string;
    rootRecipeDigest: string;
  };
  selectedRuntimeTargetProfile?: AppMapCompiledRuntimeTargetProfile;
  plan: AppMapCompiledTest;
  /** The exact compiled graph, duplicated deliberately as the immutable
   * execution source rather than inferred from a mutable App Map later. */
  recipeGraph: Record<string, Recipe>;
  preflight: OfflineTestPreflightReport;
};

function profileKey(profile: AppMapCompiledRuntimeTargetProfile | undefined): string {
  if (!profile) return "";
  const viewport = profile.viewport ? `${profile.viewport.width}x${profile.viewport.height}` : "";
  return [profile.id, profile.targetId, profile.platform, viewport].join("\u0000");
}

function sameProfile(
  left: AppMapCompiledRuntimeTargetProfile | undefined,
  right: AppMapCompiledRuntimeTargetProfile | undefined,
): boolean {
  return profileKey(left) === profileKey(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function string(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return number(value) && Number.isSafeInteger(value) && value >= 0;
}

function ownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function canonicalVariables(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && Object.values(value).every((entry) => typeof entry === "string"))
  );
}

export function parseCanonicalAppMapTestRecipe(
  value: unknown,
  expectedId?: string,
): Recipe | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !ownKeys(value, [
      "id",
      "title",
      "description",
      "variables",
      "parameters",
      "source",
      "recordingFormatVersion",
      "steps",
      "createdAt",
      "updatedAt",
      "quarantined",
      "quarantineReason",
    ]) ||
    !string(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    !string(value.title) ||
    (value.source !== "builtin" && value.source !== "custom") ||
    !Array.isArray(value.steps) ||
    !integer(value.createdAt) ||
    !integer(value.updatedAt) ||
    (value.description !== undefined && !string(value.description)) ||
    !canonicalVariables(value.variables) ||
    (value.recordingFormatVersion !== undefined &&
      value.recordingFormatVersion !== CURRENT_RECORDING_FORMAT_VERSION) ||
    (value.quarantined !== undefined && typeof value.quarantined !== "boolean") ||
    (value.quarantineReason !== undefined && !string(value.quarantineReason))
  ) {
    return undefined;
  }
  try {
    validateRecipeSteps(value.steps);
    validateRecipeParameters(value.parameters);
  } catch {
    return undefined;
  }
  return structuredClone(value) as Recipe;
}

function referencedFrozenRecipeIds(step: RecipeStep): string[] {
  const nested =
    step.kind === "module" || step.kind === "repeat"
      ? [step.recipeId]
      : step.kind === "branch"
        ? [step.thenRecipeId, ...(step.elseRecipeId ? [step.elseRecipeId] : [])]
        : [];
  // Campaign cleanup and warm recovery pass through the same reusable-recipe
  // runner as an explicit module. They must therefore be frozen too; only a
  // proposed cold recovery remains review metadata and is never executable.
  return [
    ...nested,
    ...(step.check?.cleanup ? [step.check.cleanup.recipeId] : []),
    ...(step.check?.recovery ? [step.check.recovery.recipeId] : []),
  ];
}

/** A Test graph must be self-contained. Otherwise `runReusableRecipe` would
 * fall through to a mutable saved recipe after target control has begun. */
function closedAcyclicRecipeGraph(graph: Readonly<Record<string, Recipe>>): boolean {
  const states = new Map<string, "visiting" | "complete">();
  const visit = (recipeId: string): boolean => {
    const state = states.get(recipeId);
    if (state === "visiting") return false;
    if (state === "complete") return true;
    const recipe = graph[recipeId];
    if (!recipe) return false;
    states.set(recipeId, "visiting");
    if (
      !recipe.steps.every((step) =>
        referencedFrozenRecipeIds(step).every((childId) => visit(childId)),
      )
    ) {
      return false;
    }
    states.set(recipeId, "complete");
    return true;
  };
  return Object.keys(graph).every((recipeId) => visit(recipeId));
}

/** Parse a frozen executable graph before it is allowed to identify a Test.
 * This validates recipe syntax rather than trusting a recipe-like blob or an
 * action-name convention. */
export function parseCanonicalAppMapTestRecipeGraph(
  value: unknown,
): Record<string, Recipe> | undefined {
  if (!isRecord(value) || !Object.keys(value).length) return undefined;
  const graph: Record<string, Recipe> = {};
  for (const [id, recipe] of Object.entries(value)) {
    if (!string(id)) return undefined;
    const parsed = parseCanonicalAppMapTestRecipe(recipe, id);
    if (!parsed) return undefined;
    graph[id] = parsed;
  }
  return closedAcyclicRecipeGraph(graph) ? graph : undefined;
}

function canonicalPlanRecipe(value: unknown, expectedId?: string): boolean {
  if (!isRecord(value)) return false;
  if (
    !ownKeys(value, ["id", "title", "description", "parameters", "steps"]) ||
    !string(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    !string(value.title) ||
    !Array.isArray(value.parameters) ||
    !Array.isArray(value.steps) ||
    (value.description !== undefined && !string(value.description))
  ) {
    return false;
  }
  try {
    validateRecipeParameters(value.parameters);
    validateRecipeSteps(value.steps);
    return true;
  } catch {
    return false;
  }
}

function recipeProjection(recipe: Recipe): AppMapCompiledTest["recipes"][string] {
  return {
    id: recipe.id,
    title: recipe.title,
    ...(recipe.description ? { description: recipe.description } : {}),
    parameters: structuredClone(recipe.parameters ?? []),
    steps: structuredClone(recipe.steps),
  };
}

function planMatchesRecipeGraph(
  plan: AppMapCompiledTest,
  recipeGraph: Record<string, Recipe>,
): boolean {
  const planIds = Object.keys(plan.recipes).sort();
  const graphIds = Object.keys(recipeGraph).sort();
  if (planIds.length !== graphIds.length || planIds.some((id, index) => id !== graphIds[index])) {
    return false;
  }
  return graphIds.every(
    (id) =>
      digestAppMapTestExecutionValue(plan.recipes[id]) ===
      digestAppMapTestExecutionValue(recipeProjection(recipeGraph[id]!)),
  );
}

function canonicalStartup(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.mode === "cold") return ownKeys(value, ["mode"]);
  return (
    value.mode === "verified-checkpoint" &&
    string(value.screenId) &&
    ownKeys(value, ["mode", "screenId"])
  );
}

/** The registered historical plan shape. This deliberately checks the
 * App-Map-Test discriminators, compiled root, and parsed recipe projection;
 * labels, recipe IDs, and opaque artifact fields never classify a legacy job
 * as a Test. */
export function parseCanonicalAppMapTestPlan(value: unknown): AppMapCompiledTest | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !ownKeys(value, [
      "schemaVersion",
      "appMapId",
      "appMapRevision",
      "test",
      "runtimeTargetProfile",
      "surfaceBindings",
      "rawAccessibilitySourcesByScreenId",
      "rawAccessibilityVariantsByScreenId",
      "rawAccessibilityTargetProfiles",
      "rawAccessibilityTreesByScreenId",
      "executionSchedule",
      "rootRecipeId",
      "recipes",
      "stepProvenance",
      "performance",
      "startup",
      "omittedSteps",
    ]) ||
    value.schemaVersion !== 1 ||
    !string(value.appMapId) ||
    !integer(value.appMapRevision) ||
    !isRecord(value.test) ||
    !ownKeys(value.test, ["id", "name", "kind", "intentSchemaVersion"]) ||
    !string(value.test.id) ||
    !string(value.test.name) ||
    value.test.kind !== "scenario" ||
    value.test.intentSchemaVersion !== 1 ||
    !string(value.rootRecipeId) ||
    !isRecord(value.recipes) ||
    !Object.keys(value.recipes).length ||
    !Array.isArray(value.stepProvenance) ||
    !isRecord(value.performance) ||
    !canonicalStartup(value.startup)
  ) {
    return undefined;
  }
  for (const [id, recipe] of Object.entries(value.recipes)) {
    if (!string(id) || !canonicalPlanRecipe(recipe, id)) return undefined;
  }
  if (!canonicalPlanRecipe(value.recipes[value.rootRecipeId], value.rootRecipeId)) return undefined;
  if (value.runtimeTargetProfile !== undefined && !profile(value.runtimeTargetProfile))
    return undefined;
  return structuredClone(value) as AppMapCompiledTest;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

/** Canonical content digest for immutable Test execution inputs. Keeping this
 * equivalent to offline preflight's plan digest makes the two contracts
 * independently verifiable without relying on JavaScript property order. */
export function digestAppMapTestExecutionValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function profile(value: unknown): AppMapCompiledRuntimeTargetProfile | undefined {
  if (
    !isRecord(value) ||
    !ownKeys(value, ["id", "targetId", "platform", "viewport"]) ||
    !string(value.id) ||
    !string(value.targetId)
  ) {
    return undefined;
  }
  if (value.platform !== "android" && value.platform !== "ios" && value.platform !== "browser") {
    return undefined;
  }
  if (value.viewport === undefined) {
    return { id: value.id, targetId: value.targetId, platform: value.platform };
  }
  if (
    !isRecord(value.viewport) ||
    !ownKeys(value.viewport, ["width", "height"]) ||
    !number(value.viewport.width) ||
    !number(value.viewport.height) ||
    value.viewport.width <= 0 ||
    value.viewport.height <= 0
  ) {
    return undefined;
  }
  return {
    id: value.id,
    targetId: value.targetId,
    platform: value.platform,
    viewport: { width: value.viewport.width, height: value.viewport.height },
  };
}

/** Build the canonical immutable Test execution handoff. Retry/replay/repair
 * readers can validate this one object before any target control and never
 * need to infer a profile from mutable App Map state or old sibling artifacts. */
export function createAppMapTestExecutionIntent(input: {
  plan: AppMapCompiledTest;
  recipeGraph: Record<string, Recipe>;
  preflight: OfflineTestPreflightReport;
}): AppMapTestExecutionIntent {
  const rootRecipe = input.recipeGraph[input.plan.rootRecipeId];
  if (!rootRecipe || rootRecipe.id !== input.plan.rootRecipeId) {
    throw new Error("Cannot persist a Test execution intent without its compiled root recipe");
  }
  const selectedRuntimeTargetProfile = input.plan.runtimeTargetProfile;
  const intent: AppMapTestExecutionIntent = {
    schemaVersion: 1,
    kind: appMapTestExecutionIntentArtifactKind,
    sourcePlan: {
      appMapId: input.plan.appMapId,
      appMapRevision: input.plan.appMapRevision,
      testId: input.plan.test.id,
      rootRecipeId: input.plan.rootRecipeId,
      digest: input.preflight.planDigest,
      recipeGraphDigest: digestAppMapTestExecutionValue(input.recipeGraph),
      rootRecipeDigest: digestAppMapTestExecutionValue(rootRecipe),
    },
    ...(selectedRuntimeTargetProfile
      ? { selectedRuntimeTargetProfile: structuredClone(selectedRuntimeTargetProfile) }
      : {}),
    plan: structuredClone(input.plan),
    recipeGraph: structuredClone(input.recipeGraph),
    preflight: structuredClone(input.preflight),
  };
  if (!parseAppMapTestExecutionIntent(intent)) {
    throw new Error("Cannot persist an inconsistent App Map Test execution intent");
  }
  return intent;
}

/** Parse only the identity-bearing contract needed before a physical action.
 * The frozen plan remains opaque here; its complete recipe is intentionally
 * consumed only after this identity/profile membrane has accepted it. */
export function parseAppMapTestExecutionIntent(
  value: unknown,
): AppMapTestExecutionIntent | undefined {
  try {
    return parseAppMapTestExecutionIntentValue(value);
  } catch {
    // Persisted artifacts are untrusted input. A non-JSON value, malformed
    // clone, or non-digestible object must become review-needed, never a
    // server exception that bypasses the intent membrane.
    return undefined;
  }
}

function parseAppMapTestExecutionIntentValue(
  value: unknown,
): AppMapTestExecutionIntent | undefined {
  if (
    !isRecord(value) ||
    !ownKeys(value, [
      "schemaVersion",
      "kind",
      "sourcePlan",
      "selectedRuntimeTargetProfile",
      "plan",
      "recipeGraph",
      "preflight",
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== appMapTestExecutionIntentArtifactKind
  ) {
    return undefined;
  }
  const sourcePlan = isRecord(value.sourcePlan) ? value.sourcePlan : undefined;
  const plan = parseCanonicalAppMapTestPlan(value.plan);
  const recipeGraph = parseCanonicalAppMapTestRecipeGraph(value.recipeGraph);
  const preflight = isRecord(value.preflight)
    ? (value.preflight as OfflineTestPreflightReport)
    : undefined;
  if (
    !sourcePlan ||
    !ownKeys(sourcePlan, [
      "appMapId",
      "appMapRevision",
      "testId",
      "rootRecipeId",
      "digest",
      "recipeGraphDigest",
      "rootRecipeDigest",
    ]) ||
    !plan ||
    !recipeGraph ||
    !preflight ||
    !ownKeys(preflight, [
      "schemaVersion",
      "mode",
      "appMapId",
      "appMapRevision",
      "testId",
      "planDigest",
      "executionRisk",
      "summary",
      "selectors",
      "cursorTimeline",
      "returns",
      "findings",
    ])
  ) {
    return undefined;
  }
  const selected =
    value.selectedRuntimeTargetProfile === undefined
      ? undefined
      : profile(value.selectedRuntimeTargetProfile);
  if (value.selectedRuntimeTargetProfile !== undefined && !selected) return undefined;
  if (
    !string(sourcePlan.appMapId) ||
    !integer(sourcePlan.appMapRevision) ||
    !string(sourcePlan.testId) ||
    !string(sourcePlan.rootRecipeId) ||
    !digest(sourcePlan.digest) ||
    !digest(sourcePlan.recipeGraphDigest) ||
    !digest(sourcePlan.rootRecipeDigest) ||
    plan.schemaVersion !== 1 ||
    !string(plan.appMapId) ||
    !integer(plan.appMapRevision) ||
    !isRecord(plan.test) ||
    !string(plan.test.id) ||
    !string(plan.rootRecipeId) ||
    preflight.schemaVersion !== 1 ||
    preflight.mode !== "offline-test-preflight" ||
    !string(preflight.appMapId) ||
    !integer(preflight.appMapRevision) ||
    !string(preflight.testId) ||
    !digest(preflight.planDigest) ||
    !isRecord(preflight.executionRisk) ||
    digestAppMapTestExecutionValue(preflight.executionRisk) !==
      digestAppMapTestExecutionValue(compileExecutionRisk({ kind: "compiled-test", test: plan })) ||
    !isRecord(preflight.summary) ||
    !ownKeys(preflight.summary, [
      "recipes",
      "checkedSelectors",
      "resolvedSelectors",
      "excludedDynamicSelectors",
      "unknownCursorTransitions",
      "reviewRequiredReturns",
      "blockers",
      "warnings",
    ]) ||
    !integer(preflight.summary.recipes) ||
    !integer(preflight.summary.checkedSelectors) ||
    !integer(preflight.summary.resolvedSelectors) ||
    (preflight.summary.excludedDynamicSelectors !== undefined &&
      !integer(preflight.summary.excludedDynamicSelectors)) ||
    !integer(preflight.summary.unknownCursorTransitions) ||
    !integer(preflight.summary.reviewRequiredReturns) ||
    !integer(preflight.summary.blockers) ||
    preflight.summary.blockers !== 0 ||
    !Array.isArray(preflight.findings) ||
    !Array.isArray(preflight.selectors) ||
    !Array.isArray(preflight.cursorTimeline) ||
    !Array.isArray(preflight.returns) ||
    sourcePlan.appMapId !== plan.appMapId ||
    sourcePlan.appMapRevision !== plan.appMapRevision ||
    sourcePlan.testId !== plan.test.id ||
    sourcePlan.rootRecipeId !== plan.rootRecipeId ||
    sourcePlan.digest !== preflight.planDigest ||
    sourcePlan.digest !== digestAppMapTestExecutionValue(plan) ||
    sourcePlan.recipeGraphDigest !== digestAppMapTestExecutionValue(recipeGraph) ||
    !planMatchesRecipeGraph(plan, recipeGraph) ||
    !isRecord(recipeGraph[plan.rootRecipeId]) ||
    recipeGraph[plan.rootRecipeId]?.id !== plan.rootRecipeId ||
    sourcePlan.rootRecipeDigest !==
      digestAppMapTestExecutionValue(recipeGraph[plan.rootRecipeId]) ||
    preflight.appMapId !== plan.appMapId ||
    preflight.appMapRevision !== plan.appMapRevision ||
    preflight.testId !== plan.test.id ||
    !sameProfile(selected, plan.runtimeTargetProfile)
  ) {
    return undefined;
  }
  return structuredClone(value) as AppMapTestExecutionIntent;
}

/** Classify a persisted artifact strictly. A sibling plan/preflight artifact
 * is never upgraded into a scoped execution intent by shape alone. */
export function parseAppMapTestExecutionIntentArtifact(
  artifact: unknown,
): AppMapTestExecutionIntent | undefined {
  if (!isRecord(artifact) || artifact.kind !== appMapTestExecutionIntentArtifactKind) {
    return undefined;
  }
  return parseAppMapTestExecutionIntent(artifact.data);
}

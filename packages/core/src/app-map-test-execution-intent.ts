import type {
  AppMapCompiledRuntimeTargetProfile,
  AppMapCompiledTest,
  OfflineTestPreflightReport,
} from "@relay/protocol";
import { createHash } from "node:crypto";
import type { Recipe } from "./recipes.js";

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
  if (!isRecord(value) || !string(value.id) || !string(value.targetId)) return undefined;
  if (value.platform !== "android" && value.platform !== "ios" && value.platform !== "browser") {
    return undefined;
  }
  if (value.viewport === undefined) {
    return { id: value.id, targetId: value.targetId, platform: value.platform };
  }
  if (
    !isRecord(value.viewport) ||
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
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== appMapTestExecutionIntentArtifactKind
  ) {
    return undefined;
  }
  const sourcePlan = isRecord(value.sourcePlan) ? value.sourcePlan : undefined;
  const plan = isRecord(value.plan) ? (value.plan as AppMapCompiledTest) : undefined;
  const recipeGraph = isRecord(value.recipeGraph)
    ? (value.recipeGraph as Record<string, Recipe>)
    : undefined;
  const preflight = isRecord(value.preflight)
    ? (value.preflight as OfflineTestPreflightReport)
    : undefined;
  if (!sourcePlan || !plan || !recipeGraph || !preflight) return undefined;
  const selected =
    value.selectedRuntimeTargetProfile === undefined
      ? undefined
      : profile(value.selectedRuntimeTargetProfile);
  if (value.selectedRuntimeTargetProfile !== undefined && !selected) return undefined;
  if (
    !string(sourcePlan.appMapId) ||
    !number(sourcePlan.appMapRevision) ||
    !string(sourcePlan.testId) ||
    !string(sourcePlan.rootRecipeId) ||
    !digest(sourcePlan.digest) ||
    !digest(sourcePlan.recipeGraphDigest) ||
    !digest(sourcePlan.rootRecipeDigest) ||
    plan.schemaVersion !== 1 ||
    !string(plan.appMapId) ||
    !number(plan.appMapRevision) ||
    !isRecord(plan.test) ||
    !string(plan.test.id) ||
    !string(plan.rootRecipeId) ||
    preflight.schemaVersion !== 1 ||
    preflight.mode !== "offline-test-preflight" ||
    !string(preflight.appMapId) ||
    !number(preflight.appMapRevision) ||
    !string(preflight.testId) ||
    !digest(preflight.planDigest) ||
    sourcePlan.appMapId !== plan.appMapId ||
    sourcePlan.appMapRevision !== plan.appMapRevision ||
    sourcePlan.testId !== plan.test.id ||
    sourcePlan.rootRecipeId !== plan.rootRecipeId ||
    sourcePlan.digest !== preflight.planDigest ||
    sourcePlan.digest !== digestAppMapTestExecutionValue(plan) ||
    sourcePlan.recipeGraphDigest !== digestAppMapTestExecutionValue(recipeGraph) ||
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

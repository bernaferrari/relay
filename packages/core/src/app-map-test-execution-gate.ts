import {
  appMapCombineCellExecutionIntentArtifactKind,
  parseAppMapCombineCellExecutionIntentArtifact,
  type AppMapCombineCellExecutionIntent,
} from "./app-map-combine-cell-intent.js";
import {
  appMapTestExecutionIntentArtifactKind,
  digestAppMapTestExecutionValue,
  parseAppMapTestExecutionIntentArtifact,
  parseCanonicalAppMapTestPlan,
  parseCanonicalAppMapTestRecipe,
  parseCanonicalAppMapTestRecipeGraph,
  type AppMapTestExecutionIntent,
} from "./app-map-test-execution-intent.js";
import { loadFrozenRawAccessibilityEvidence } from "./frozen-raw-accessibility.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";
import type { AppMapCompiledTest, RecipeStep, TargetProfile } from "@relay/protocol";
import type { Recipe } from "./recipes.js";
import type { PersistedRun } from "./runs.js";
import type { TestJob } from "./session-contract.js";

type Artifact = { kind: string; data: unknown };

export type AppMapTestExecutionSource = {
  artifacts?: readonly Artifact[];
  action?: string;
  recipeId?: string;
  /** Jobs execute `recipeId` directly; a persisted run only retains `action`
   * and reconstructs its recipe ID from that immutable action on replay. */
  requireRecipeId?: boolean;
  recipeSnapshot?: Recipe;
  recipeGraph?: Record<string, Recipe>;
  target?: { targetId?: string; platform?: string };
  /** The scheduler-facing target identity must retain the selected evidence
   * profile, including its viewport namespace. */
  targetProfile?: TargetProfile;
};

export type AppMapTestExecutionIntentAssessment =
  | { status: "not-app-map-test" }
  | { status: "review-required"; reason: string }
  | {
      status: "valid";
      intent: AppMapTestExecutionIntent;
      combineCell?: AppMapCombineCellExecutionIntent;
    };

/** A typed cross-boundary signal: retries, resumes, and replays must turn
 * this into the same review-needed response rather than treating a stale
 * offline proof as an internal server error. */
export class AppMapTestExecutionReviewRequiredError extends Error {
  constructor(readonly reason: string) {
    super(`App Map Test execution needs review: ${reason}`);
    this.name = "AppMapTestExecutionReviewRequiredError";
  }
}

/** A synchronous queue boundary. It deliberately proves only immutable
 * structure; HTTP routes and the executor perform the asynchronous frozen-raw
 * preflight before they may obtain target control. */
export function requireScopedAppMapTestExecutionSource(
  source: AppMapTestExecutionSource,
): AppMapTestExecutionIntent | undefined {
  const assessment = assessAppMapTestExecutionSource(source);
  if (assessment.status === "review-required") {
    throw new AppMapTestExecutionReviewRequiredError(assessment.reason);
  }
  return assessment.status === "valid" ? assessment.intent : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The persisted artifact array is untrusted at retry/replay boundaries. Keep
 * the catch path structural too: a malformed sibling must not turn a typed
 * Test intent into an uncaught server error. */
function artifactHasKind(value: unknown, kind: string): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === kind
  );
}

/** The catch path receives arbitrary persisted array members, so it must use
 * the same formal plan parser as the ordinary path. A recipe label alone can
 * never classify a historical execution as an App Map Test. */
function artifactHasCanonicalTestPlan(value: unknown): boolean {
  if (!artifactHasKind(value, "app-map-test-plan")) return false;
  try {
    return parseCanonicalAppMapTestPlan((value as { data?: unknown }).data) !== undefined;
  } catch {
    return false;
  }
}

function sameViewport(
  left: { width: number; height: number } | undefined,
  right: { width: number; height: number } | undefined,
): boolean {
  return (
    (left === undefined && right === undefined) ||
    (left !== undefined &&
      right !== undefined &&
      left.width === right.width &&
      left.height === right.height)
  );
}

function queuedTargetProfileMismatch(
  intent: AppMapTestExecutionIntent,
  targetProfile: TargetProfile | undefined,
): string | undefined {
  const selected = intent.selectedRuntimeTargetProfile;
  if (!selected) return undefined;
  if (
    !targetProfile ||
    targetProfile.id !== selected.id ||
    targetProfile.targetId !== selected.targetId ||
    targetProfile.platform !== selected.platform ||
    !sameViewport(targetProfile.viewport, selected.viewport)
  ) {
    return "The queued target profile no longer matches the selected frozen evidence profile.";
  }
  return undefined;
}

function executionSourceMismatch(
  intent: AppMapTestExecutionIntent,
  source: AppMapTestExecutionSource,
  combineCell?: AppMapCombineCellExecutionIntent,
): string | undefined {
  const rootRecipeId = combineCell?.wrapper.rootRecipeId ?? intent.sourcePlan.rootRecipeId;
  const graph = parseCanonicalAppMapTestRecipeGraph(source.recipeGraph);
  if (!graph) return "The frozen Test recipe graph is missing or malformed.";
  const snapshot = parseCanonicalAppMapTestRecipe(source.recipeSnapshot, rootRecipeId);
  if (!snapshot) return "The frozen Test root recipe is missing or malformed.";
  const root = graph[rootRecipeId];
  if (!root) return "The frozen Test root recipe is absent from its graph.";
  if (combineCell) {
    if (
      digestAppMapTestExecutionValue(graph) !== combineCell.wrapper.recipeGraphDigest ||
      digestAppMapTestExecutionValue(root) !== combineCell.wrapper.rootRecipeDigest ||
      digestAppMapTestExecutionValue(snapshot) !== combineCell.wrapper.rootRecipeDigest
    ) {
      return "The queued Combine cell wrapper no longer matches its frozen execution intent.";
    }
  } else if (
    digestAppMapTestExecutionValue(graph) !== intent.sourcePlan.recipeGraphDigest ||
    digestAppMapTestExecutionValue(root) !== intent.sourcePlan.rootRecipeDigest ||
    digestAppMapTestExecutionValue(snapshot) !== intent.sourcePlan.rootRecipeDigest
  ) {
    return "The queued Test recipe no longer matches its frozen execution intent.";
  }
  if (
    text(source.action) !== rootRecipeId ||
    (source.requireRecipeId
      ? text(source.recipeId) !== rootRecipeId
      : source.recipeId !== undefined && text(source.recipeId) !== rootRecipeId)
  ) {
    return combineCell
      ? "The queued Combine cell action no longer names its frozen wrapper root."
      : "The queued Test action no longer names its frozen root recipe.";
  }
  const targetId = text(source.target?.targetId);
  const platform = source.target?.platform;
  if (!targetId || (platform !== "android" && platform !== "ios" && platform !== "browser")) {
    return "The Test no longer has one reusable target identity.";
  }
  const profile = combineCell?.selectedRuntimeTargetProfile ?? intent.selectedRuntimeTargetProfile;
  if (profile && (profile.targetId !== targetId || profile.platform !== platform)) {
    return "The selected runtime evidence profile no longer matches this target.";
  }
  const targetProfileMismatch = queuedTargetProfileMismatch(intent, source.targetProfile);
  if (targetProfileMismatch) return targetProfileMismatch;
  return undefined;
}

/** Classify only typed, parser-validated App Map Test contracts. In
 * particular, a recipe name, arbitrary artifact, or malformed old plan is
 * non-Test legacy input; it must not be guessed into this safety boundary. */
export function assessAppMapTestExecutionSource(
  source: AppMapTestExecutionSource,
): AppMapTestExecutionIntentAssessment {
  try {
    return assessAppMapTestExecutionSourceValue(source);
  } catch {
    const artifacts = Array.isArray(source.artifacts) ? source.artifacts : [];
    if (
      artifacts.some((artifact) =>
        artifactHasKind(artifact, appMapCombineCellExecutionIntentArtifactKind),
      )
    ) {
      return {
        status: "review-required",
        reason: "The Combine cell execution intent is malformed or internally inconsistent.",
      };
    }
    if (
      artifacts.some((artifact) => artifactHasKind(artifact, appMapTestExecutionIntentArtifactKind))
    ) {
      return {
        status: "review-required",
        reason: "The Test execution intent is malformed or internally inconsistent.",
      };
    }
    if (artifacts.some(artifactHasCanonicalTestPlan)) {
      return {
        status: "review-required",
        reason: "This historical App Map Test has no scoped execution intent.",
      };
    }
    return { status: "not-app-map-test" };
  }
}

function assessAppMapTestExecutionSourceValue(
  source: AppMapTestExecutionSource,
): AppMapTestExecutionIntentAssessment {
  const artifacts = source.artifacts ?? [];
  const combineArtifacts = artifacts.filter(
    (artifact) => artifact.kind === appMapCombineCellExecutionIntentArtifactKind,
  );
  if (combineArtifacts.length) {
    if (combineArtifacts.length !== 1) {
      return {
        status: "review-required",
        reason: "The Combine cell has more than one execution intent artifact.",
      };
    }
    const combineCell = parseAppMapCombineCellExecutionIntentArtifact(combineArtifacts[0]);
    if (!combineCell) {
      return {
        status: "review-required",
        reason: "The Combine cell execution intent is malformed or internally inconsistent.",
      };
    }
    const mismatch = executionSourceMismatch(combineCell.child, source, combineCell);
    return mismatch
      ? { status: "review-required", reason: mismatch }
      : { status: "valid", intent: combineCell.child, combineCell };
  }
  const intentArtifacts = artifacts.filter(
    (artifact) => artifact.kind === appMapTestExecutionIntentArtifactKind,
  );
  if (intentArtifacts.length) {
    if (intentArtifacts.length !== 1) {
      return {
        status: "review-required",
        reason: "The Test has more than one execution intent artifact.",
      };
    }
    const intent = parseAppMapTestExecutionIntentArtifact(intentArtifacts[0]);
    if (!intent) {
      return {
        status: "review-required",
        reason: "The Test execution intent is malformed or internally inconsistent.",
      };
    }
    const siblingPlans = artifacts
      .filter((artifact) => artifact.kind === "app-map-test-plan")
      .flatMap((artifact) => {
        const plan = parseCanonicalAppMapTestPlan(artifact.data);
        return plan ? [plan] : [];
      });
    if (
      siblingPlans.some((plan) => digestAppMapTestExecutionValue(plan) !== intent.sourcePlan.digest)
    ) {
      return {
        status: "review-required",
        reason: "The Test plan artifact conflicts with its execution intent.",
      };
    }
    const mismatch = executionSourceMismatch(intent, source);
    return mismatch ? { status: "review-required", reason: mismatch } : { status: "valid", intent };
  }

  if (
    artifacts.some(
      (artifact) =>
        artifact.kind === "app-map-test-plan" && parseCanonicalAppMapTestPlan(artifact.data),
    )
  ) {
    return {
      status: "review-required",
      reason: "This historical App Map Test has no scoped execution intent.",
    };
  }
  return { status: "not-app-map-test" };
}

/** Re-read the immutable raw evidence and reproduce the frozen offline proof
 * before a retry, replay, resume, or repair can regain control. */
export async function revalidateAppMapTestExecutionSource(
  source: AppMapTestExecutionSource,
): Promise<AppMapTestExecutionIntentAssessment> {
  const initial = assessAppMapTestExecutionSource(source);
  if (initial.status !== "valid") return initial;
  try {
    const evidence = await loadFrozenRawAccessibilityEvidence(initial.intent.plan);
    const preflight = preflightCompiledAppMapTestOffline(
      initial.intent.plan,
      evidence,
      initial.intent.selectedRuntimeTargetProfile
        ? { targetProfileId: initial.intent.selectedRuntimeTargetProfile.id }
        : {},
    );
    if (
      preflight.summary.blockers !== 0 ||
      digestAppMapTestExecutionValue(preflight) !==
        digestAppMapTestExecutionValue(initial.intent.preflight)
    ) {
      return {
        status: "review-required",
        reason: "The frozen offline preflight no longer proves this Test execution.",
      };
    }
    return initial;
  } catch {
    return {
      status: "review-required",
      reason: "The frozen Test evidence could not be revalidated offline.",
    };
  }
}

/** Project a selective repair's actual graph back into the same inspectable
 * Test-plan vocabulary. The original plan supplies only immutable evidence
 * facts; its root, schedule, and provenance are deliberately not reused for
 * a different executable graph. */
export function deriveAppMapTestRepairExecutionPlan(input: {
  sourcePlan: AppMapCompiledTest;
  selectedRuntimeTargetProfile?: AppMapTestExecutionIntent["selectedRuntimeTargetProfile"];
  recipeGraph: Record<string, Recipe>;
  rootRecipeId: string;
  checkpointScreenId: string;
}): AppMapCompiledTest {
  const graph = parseCanonicalAppMapTestRecipeGraph(input.recipeGraph);
  const root = graph?.[input.rootRecipeId];
  if (!graph || !root) {
    throw new Error("Selective repair has no parser-validated frozen recipe graph");
  }
  const counts: Partial<Record<RecipeStep["kind"], number>> = {};
  let executableOperations = 0;
  let moduleCalls = 0;
  let screenshotCount = 0;
  let destinationProofCount = 0;
  for (const recipe of Object.values(graph)) {
    for (const step of recipe.steps) {
      executableOperations += 1;
      counts[step.kind] = (counts[step.kind] ?? 0) + 1;
      if (step.kind === "module") moduleCalls += 1;
      if (step.kind === "screenshot") screenshotCount += 1;
      if (step.kind === "expect-screen") destinationProofCount += 1;
    }
  }
  const {
    executionSchedule: _schedule,
    omittedSteps: _omitted,
    runtimeTargetProfile: _profile,
    ...base
  } = structuredClone(input.sourcePlan);
  return {
    ...base,
    ...(input.selectedRuntimeTargetProfile
      ? { runtimeTargetProfile: structuredClone(input.selectedRuntimeTargetProfile) }
      : {}),
    rootRecipeId: root.id,
    recipes: Object.fromEntries(
      Object.values(graph).map((recipe) => [
        recipe.id,
        {
          id: recipe.id,
          title: recipe.title,
          ...(recipe.description ? { description: recipe.description } : {}),
          parameters: structuredClone(recipe.parameters ?? []),
          steps: structuredClone(recipe.steps),
        },
      ]),
    ),
    stepProvenance: [],
    performance: {
      executableOperations,
      moduleCalls,
      operationCounts: counts,
      screenshotCount,
      destinationProofCount,
    },
    startup: { mode: "verified-checkpoint", screenId: input.checkpointScreenId },
  };
}

export function appMapTestExecutionSourceFromJob(
  job: Pick<
    TestJob,
    | "artifacts"
    | "action"
    | "recipeId"
    | "recipeSnapshot"
    | "recipeGraph"
    | "serial"
    | "browserTargetId"
    | "platform"
    | "targetProfile"
    | "targetContext"
  >,
): AppMapTestExecutionSource {
  return {
    artifacts: job.artifacts,
    action: job.action,
    recipeId: job.recipeId,
    requireRecipeId: true,
    recipeSnapshot: job.recipeSnapshot,
    recipeGraph: job.recipeGraph,
    target: {
      targetId: job.browserTargetId ?? job.serial,
      platform: job.targetContext.platform ?? job.platform,
    },
    targetProfile: job.targetProfile,
  };
}

export function appMapTestExecutionSourceFromRun(
  run: Pick<
    PersistedRun,
    | "artifacts"
    | "action"
    | "recipeSnapshot"
    | "recipeGraph"
    | "serial"
    | "platform"
    | "targetProfile"
  >,
): AppMapTestExecutionSource {
  return {
    artifacts: run.artifacts,
    action: run.action,
    recipeSnapshot: run.recipeSnapshot,
    recipeGraph: run.recipeGraph,
    target: { targetId: run.serial, platform: run.platform },
    targetProfile: run.targetProfile,
  };
}

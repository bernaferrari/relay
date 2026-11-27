/**
 * The cacheability contract for plain-English saved paths, shared by the
 * writer (saveActCachesFromRun), intake validation, and the compiler. Only
 * concrete kinds the act loop or check resolver emits may be cached, and
 * every target must resolve semantically: a coordinate cannot miss when the
 * UI moves, so it would replay silently wrong evidence forever instead of
 * re-resolving.
 */
import type { PlainEnglishStepCacheResolution, RecipeStep, StepTarget } from "@relay/protocol";
import { PRIVATE_INPUT } from "../input/private-inputs.js";

export const ACT_CACHE_STEP_LIMIT = 40;

const SEMANTIC_STRATEGIES = new Set(["identifier", "ref", "label", "text"]);

/** Kinds the act loop can emit, so nothing else may enter a saved path:
 * no script/flow/module/repeat/branch/nested-act/evaluate/expect. */
export function isCacheableActStepKind(step: RecipeStep): boolean {
  switch (step.kind) {
    case "tap":
    case "type":
    case "scroll":
    case "key":
    case "sleep":
      return true;
    case "device":
      return step.action === "keyboard-enter";
    default:
      return false;
  }
}

/** Deterministic validation kinds a check resolver may save. `expect` is the
 * only assertion whose semantic target can be re-proved directly without
 * inventing extraction state or a second model judgment. */
export function isCacheableCheckStepKind(step: RecipeStep): boolean {
  return step.kind === "expect" && step.condition === "visible";
}

export type PlainEnglishSavedPathKind = "action" | "check";

export function isCacheablePlainEnglishStepKind(
  step: RecipeStep,
  kind: PlainEnglishSavedPathKind,
): boolean {
  return kind === "action" ? isCacheableActStepKind(step) : isCacheableCheckStepKind(step);
}

export function semanticTargetKey(
  target: StepTarget,
): { strategy: "identifier" | "ref" | "label" | "text"; key: string } | undefined {
  for (const strategy of ["identifier", "ref", "label", "text"] as const) {
    const key = target[strategy]?.trim();
    if (key) return { strategy, key };
  }
  return undefined;
}

function stripPoint(target: StepTarget): StepTarget {
  const { point: _point, ...rest } = target;
  return structuredClone(rest);
}

function sensitiveTarget(target: StepTarget): boolean {
  return [target.identifier, target.ref, target.label, target.text].some(
    (value) => typeof value === "string" && value.includes(PRIVATE_INPUT),
  );
}

function executableSemanticTarget(target: StepTarget | undefined, required: boolean): boolean {
  if (!target) return !required;
  // A frozen executable path never carries a coordinate. Points remain useful
  // while the model is resolving live, but write sanitization strips them;
  // any point still present here came from outside the acceptance path.
  return (
    !sensitiveTarget(target) &&
    target.point === undefined &&
    target.relation === undefined &&
    semanticTargetKey(target) !== undefined
  );
}

/** Shape-only gate shared by compile and offline preflight. It deliberately
 * does not require runtime-resolution evidence: compiled steps are already
 * downstream of that write-time proof. */
export function savedPathStepsAreExecutable(
  steps: readonly RecipeStep[],
  kind: PlainEnglishSavedPathKind,
): boolean {
  if (!steps.length || steps.length > ACT_CACHE_STEP_LIMIT) return false;
  return steps.every((step) => {
    if (!isCacheablePlainEnglishStepKind(step, kind)) return false;
    if (step.kind === "type" && step.text.includes(PRIVATE_INPUT)) return false;
    if (step.kind === "tap") return executableSemanticTarget(step.target, true);
    if (step.kind === "type") return executableSemanticTarget(step.target, false);
    if (step.kind === "expect") return executableSemanticTarget(step.target, true);
    return true;
  });
}

export type ActCacheStepResolution = {
  strategy?: unknown;
  key?: unknown;
};

/** Sanitize one concrete act step for caching, or return undefined when it
 * can never be cached. `evidence` is the target-resolution the runner
 * captured while this step executed, when one exists. */
export function sanitizedActCacheStep(
  step: RecipeStep,
  evidence?: ActCacheStepResolution,
): { step: RecipeStep; resolution?: PlainEnglishStepCacheResolution } | undefined {
  if (!isCacheableActStepKind(step)) return undefined;
  if (step.kind === "type" && step.text.includes(PRIVATE_INPUT)) return undefined;
  if (step.kind !== "tap" && step.kind !== "type") return { step: structuredClone(step) };
  if (!step.target) return step.kind === "type" ? { step: structuredClone(step) } : undefined;
  const semantic = semanticTargetKey(step.target);
  if (!semantic || sensitiveTarget(step.target) || step.target.relation !== undefined)
    return undefined;
  // A tap must prove its win came from the semantic key. Type-fill resolution
  // is derived from the target shape itself, so the key is evidence enough.
  if (step.kind === "tap") {
    const strategy = typeof evidence?.strategy === "string" ? evidence.strategy : undefined;
    if (!strategy || !SEMANTIC_STRATEGIES.has(strategy)) return undefined;
    const key =
      typeof evidence?.key === "string" && evidence.key.trim() ? evidence.key.trim() : semantic.key;
    return {
      step: { ...structuredClone(step), target: stripPoint(step.target) },
      resolution: { strategy: strategy as PlainEnglishStepCacheResolution["strategy"], key },
    };
  }
  return {
    step: { ...structuredClone(step), target: stripPoint(step.target) },
    resolution: semantic,
  };
}

/** Whole-sequence atomicity: one uncacheable action discards the path. */
export function sanitizedActCacheSteps(
  steps: RecipeStep[],
  resolutions?: readonly (ActCacheStepResolution | null | undefined)[],
): { steps: RecipeStep[]; resolution: PlainEnglishStepCacheResolution[] } | undefined {
  if (!steps.length || steps.length > ACT_CACHE_STEP_LIMIT) return undefined;
  const out: RecipeStep[] = [];
  const resolution: PlainEnglishStepCacheResolution[] = [];
  for (const [index, step] of steps.entries()) {
    const clean = sanitizedActCacheStep(step, resolutions?.[index] ?? undefined);
    if (!clean) return undefined;
    out.push(clean.step);
    if (clean.resolution) resolution.push(clean.resolution);
  }
  return { steps: out, resolution };
}

/** Semantic presence assertions are their own resolution evidence: the
 * assertion only passes when identifier/ref/label/text matching succeeds. */
export function sanitizedCheckCacheSteps(
  steps: RecipeStep[],
): { steps: RecipeStep[]; resolution: PlainEnglishStepCacheResolution[] } | undefined {
  if (!steps.length || steps.length > ACT_CACHE_STEP_LIMIT) return undefined;
  const out: RecipeStep[] = [];
  const resolution: PlainEnglishStepCacheResolution[] = [];
  for (const step of steps) {
    if (!isCacheableCheckStepKind(step) || step.kind !== "expect" || !step.target) return undefined;
    const semantic = semanticTargetKey(step.target);
    if (!semantic || sensitiveTarget(step.target) || step.target.relation !== undefined)
      return undefined;
    out.push({ ...structuredClone(step), target: stripPoint(step.target) });
    resolution.push(semantic);
  }
  return { steps: out, resolution };
}

function resolutionProofIsComplete(steps: readonly RecipeStep[], resolution: unknown): boolean {
  if (!Array.isArray(resolution)) return false;
  const targeted = steps.filter(
    (step) =>
      (step.kind === "tap" || step.kind === "type" || step.kind === "expect") && step.target,
  ).length;
  return (
    resolution.length === targeted &&
    resolution.every((item) => {
      if (!item || typeof item !== "object") return false;
      const proof = item as { strategy?: unknown; key?: unknown };
      return (
        typeof proof.key === "string" &&
        proof.key.trim().length > 0 &&
        (proof.strategy === "identifier" ||
          proof.strategy === "ref" ||
          proof.strategy === "label" ||
          proof.strategy === "text")
      );
    })
  );
}

type CompileTimeCache = {
  schemaVersion?: unknown;
  steps?: unknown;
  runId?: unknown;
  savedAt?: unknown;
  targetKind?: unknown;
  platform?: unknown;
  viewport?: unknown;
  resolution?: unknown;
  verification?: unknown;
};

/** The last gate before execution. A saved path is copied into a compiled
 * plain-English step only when it carries the v2 proof, matches this exact
 * target kind/platform/viewport contract, and every step passes the same kind
 * allowlist enforced at write time. Legacy entries compile as absent: the
 * next run re-saves through the model once. */
export function cacheableSavedSteps(
  cache: CompileTimeCache | undefined,
  runtimeTargetProfile:
    | { platform?: string; viewport?: { width: number; height: number } }
    | undefined,
  kind: PlainEnglishSavedPathKind = "action",
): RecipeStep[] | undefined {
  if (!cache || cache.schemaVersion !== 2) return undefined;
  if (!Array.isArray(cache.steps) || !cache.steps.length) return undefined;
  const verification = cache.verification as { runOutcome?: unknown } | undefined;
  if (
    typeof cache.runId !== "string" ||
    !cache.runId.trim() ||
    typeof cache.savedAt !== "number" ||
    !Number.isFinite(cache.savedAt) ||
    verification?.runOutcome !== "passed" ||
    !resolutionProofIsComplete(cache.steps as RecipeStep[], cache.resolution)
  ) {
    return undefined;
  }
  const steps = cache.steps as RecipeStep[];
  if (!savedPathStepsAreExecutable(steps, kind)) return undefined;
  const runtimePlatform = runtimeTargetProfile?.platform;
  const runtimeKind =
    runtimePlatform === "browser"
      ? "browser"
      : runtimePlatform === "android" || runtimePlatform === "ios"
        ? "device"
        : undefined;
  if (!runtimeKind || cache.targetKind !== runtimeKind) return undefined;
  // Action paths stay browser-only: native mutation fallback can still hide a
  // stale semantic key behind a coordinate. Checks are passive semantic
  // assertions, so they may match their exact native platform instead.
  if (kind === "action" && runtimeKind !== "browser") return undefined;
  if (runtimeKind === "browser" && cache.platform !== undefined) return undefined;
  if (runtimeKind === "device" && cache.platform !== runtimePlatform) return undefined;
  const cacheViewport = cache.viewport as { width?: unknown; height?: unknown } | undefined;
  if (cache.viewport !== undefined) {
    if (
      !cacheViewport ||
      typeof cacheViewport !== "object" ||
      typeof cacheViewport.width !== "number" ||
      typeof cacheViewport.height !== "number" ||
      !Number.isFinite(cacheViewport.width) ||
      !Number.isFinite(cacheViewport.height) ||
      cacheViewport.width <= 0 ||
      cacheViewport.height <= 0
    ) {
      return undefined;
    }
  }
  const runtimeViewport = runtimeTargetProfile?.viewport;
  if (
    cacheViewport &&
    runtimeViewport &&
    (cacheViewport.width !== runtimeViewport.width ||
      cacheViewport.height !== runtimeViewport.height)
  ) {
    return undefined;
  }
  return steps;
}

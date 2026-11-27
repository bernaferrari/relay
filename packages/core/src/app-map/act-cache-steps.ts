/**
 * The cacheability contract for plain-English saved paths, shared by the
 * writer (saveActCachesFromRun), intake validation, and the compiler. Only
 * the concrete kinds the act loop emits may be cached, and every target must
 * resolve semantically: a coordinate tap cannot miss when the UI moves, so it
 * would replay silently wrong actions forever instead of re-resolving.
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
  if (!semantic) return undefined;
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

type CompileTimeCache = {
  schemaVersion?: unknown;
  steps?: unknown;
  targetKind?: unknown;
  platform?: unknown;
  viewport?: unknown;
};

/** The last gate before execution. A saved path is copied into a compiled act
 * step only when it carries the v2 proof, targets this exact target kind, and
 * every action passes the same kind allowlist enforced at write time. Legacy
 * entries compile as absent: the next run re-caches through the model once.
 * Browser entries never cross onto native targets, where a stale key can
 * still degrade to a silent coordinate tap. */
export function cacheableSavedSteps(
  cache: CompileTimeCache | undefined,
  runtimeTargetProfile:
    | { platform?: string; viewport?: { width: number; height: number } }
    | undefined,
): RecipeStep[] | undefined {
  if (!cache || cache.schemaVersion !== 2) return undefined;
  if (!Array.isArray(cache.steps) || !cache.steps.length) return undefined;
  const steps = cache.steps as RecipeStep[];
  if (steps.length > ACT_CACHE_STEP_LIMIT) return undefined;
  if (!steps.every(isCacheableActStepKind)) return undefined;
  if (cache.targetKind !== "browser") return undefined;
  if (runtimeTargetProfile?.platform !== "browser") return undefined;
  const cacheViewport = cache.viewport as { width?: number; height?: number } | undefined;
  const runtimeViewport = runtimeTargetProfile.viewport;
  if (
    cacheViewport?.width !== undefined &&
    cacheViewport?.height !== undefined &&
    runtimeViewport &&
    (cacheViewport.width !== runtimeViewport.width ||
      cacheViewport.height !== runtimeViewport.height)
  ) {
    return undefined;
  }
  return steps;
}

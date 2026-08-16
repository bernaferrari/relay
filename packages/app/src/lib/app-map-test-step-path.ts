import type { AppMap, AppMapScenarioTestStep } from "@relay/protocol";
import { scenarioStepSummary } from "./app-map-test-editor-model";

/**
 * Steps in a real map share long identical prefixes
 * (`Navigation → Settings → Edit profile → Birth Year`), so tail truncation
 * destroys the only part that tells two rows apart. Splitting the path lets the
 * row render the ancestors in a truncating span and the leaf in a `shrink-0`
 * span, which degrades to `Navigation → Sett… → Birth Year`.
 */
export type ScenarioStepPath = {
  /** Everything before the last segment, already joined for display. */
  ancestors: string;
  /** The segment that distinguishes this step. Never truncated first. */
  leaf: string;
  /** The whole path, for `title` and assistive technology. */
  full: string;
};

export const SCENARIO_PATH_SEPARATOR = " → ";

export function scenarioStepPath(map: AppMap, step: AppMapScenarioTestStep): ScenarioStepPath {
  return splitScenarioPath(scenarioStepSummary(map, step));
}

export function splitScenarioPath(summary: string): ScenarioStepPath {
  const full = summary.trim();
  const segments = full
    .split(SCENARIO_PATH_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length <= 1) return { ancestors: "", leaf: full, full };
  return {
    ancestors: segments.slice(0, -1).join(SCENARIO_PATH_SEPARATOR),
    leaf: segments.at(-1)!,
    full,
  };
}

/**
 * A row's primary line. The step's own intent is the sentence a human wrote and
 * the thing that actually distinguishes one row from the next; the binding path
 * is supporting detail. Unwritten intent falls back to the binding leaf so a
 * fresh step is never a blank row.
 */
export function scenarioStepTitle(map: AppMap, step: AppMapScenarioTestStep): string {
  const intent = step.intent.trim();
  if (intent) return intent;
  const path = scenarioStepPath(map, step);
  return path.leaf || "Untitled step";
}

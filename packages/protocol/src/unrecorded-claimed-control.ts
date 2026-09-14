import type { RecipeStep, StepTarget } from "./recipes.js";

const CLAIMED_CONTROLS = ["Start Thread"] as const;

function targetLabels(target: StepTarget | undefined): string[] {
  if (!target) return [];
  return [target.label, target.text].filter((value): value is string => Boolean(value?.trim()));
}

/** Product naming for Tests that must not present as Ready. */
export function unrecordedProductName(name: string): boolean {
  const trimmed = name.trim();
  return /^(?:UNRECORDED|DRAFT)\b/u.test(trimmed) || /\bstill absent\b/iu.test(trimmed);
}

/** Labels a recorded recipe actually addresses — never invented nav. */
export function recipeRecordedLabels(steps: readonly RecipeStep[]): string[] {
  const labels: string[] = [];
  for (const step of steps) {
    if ("target" in step) labels.push(...targetLabels(step.target));
    if ("fallbackTargets" in step) {
      for (const target of step.fallbackTargets ?? []) labels.push(...targetLabels(target));
    }
    if (step.kind === "expect-set") labels.push(...step.labels);
    if (step.when) labels.push(...targetLabels(step.when.target));
  }
  return labels;
}

/** Title/intent claimed a control the recorded tree never had. */
export function claimedAbsentControlReason(
  titleAndIntents: string,
  recordedLabels: readonly string[],
): string | undefined {
  const haystack = titleAndIntents.toLocaleLowerCase();
  const recorded = new Set(
    recordedLabels.map((label) => label.trim().toLocaleLowerCase()).filter(Boolean),
  );
  for (const control of CLAIMED_CONTROLS) {
    if (!haystack.includes(control.toLocaleLowerCase())) continue;
    if (recorded.has(control.toLocaleLowerCase())) continue;
    return `${control} is absent from the recorded tree — unrecorded.`;
  }
  return undefined;
}

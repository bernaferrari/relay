import type { RecipeStep, StepTarget, VariableNavStep, VariableRow } from "@relay/protocol";
import type { Recipe } from "./recipes.js";

export const OPTION_NONE = "-";

export function navStepsToRecipe(steps: VariableNavStep[] | undefined, app?: string): RecipeStep[] {
  if (!steps?.length) return [];
  const out: RecipeStep[] = [];
  for (const step of steps) {
    if (step.kind === "wait") {
      out.push({ kind: "sleep", ms: Math.max(0, Math.min(120_000, Math.round(step.ms))) });
      continue;
    }
    if (step.kind === "back") {
      out.push({ kind: "key", key: "back" });
      continue;
    }
    if (step.kind === "relaunch") {
      if (!app) throw new Error("relaunch requires app");
      out.push({ kind: "app", action: "open", app, relaunch: true });
      continue;
    }
    if (step.kind === "openApp") {
      const target = step.app?.trim() || app;
      if (!target) throw new Error("openApp requires step.app or app");
      out.push({ kind: "app", action: "open", app: target, relaunch: step.relaunch === true });
      out.push({ kind: "sleep", ms: 900 });
      continue;
    }
    if (step.kind === "scroll") {
      const count = Math.max(1, Math.min(8, step.amount ?? 1));
      for (let i = 0; i < count; i += 1) {
        out.push({
          kind: "swipe",
          from: { x: 0.5, y: step.direction === "down" ? 0.72 : 0.32 },
          to: { x: 0.5, y: step.direction === "down" ? 0.32 : 0.72 },
          durationMs: 280,
        });
      }
      continue;
    }
    const target = step.target;
    const fallbackTargets = step.fallbackTargets?.map((fallback) => ({ ...fallback }));
    if (target.identifier)
      out.push({
        kind: "tap",
        target: { identifier: target.identifier },
        ...(fallbackTargets?.length ? { fallbackTargets } : {}),
      });
    else if (target.label)
      out.push({
        kind: "tap",
        target: { label: target.label },
        ...(fallbackTargets?.length ? { fallbackTargets } : {}),
      });
    else if (target.text)
      out.push({
        kind: "tap",
        target: { text: target.text },
        ...(fallbackTargets?.length ? { fallbackTargets } : {}),
      });
    else throw new Error("option nav tap requires identifier, label, or text");
  }
  return out;
}

export function tapHelpers(prefix: string, at: number): Record<string, Recipe> {
  const tapIdentifier: Recipe = {
    id: `__opt_${prefix}_tap_identifier`,
    title: `Tap ${prefix} by identifier`,
    source: "custom",
    steps: [{ kind: "tap", target: { identifier: `{{${prefix}_identifier}}` } }],
    createdAt: at,
    updatedAt: at,
  };
  const tapLabel: Recipe = {
    id: `__opt_${prefix}_tap_label`,
    title: `Tap ${prefix} by label`,
    source: "custom",
    steps: [{ kind: "tap", target: { label: `{{${prefix}_label}}` } }],
    createdAt: at,
    updatedAt: at,
  };
  const tapText: Recipe = {
    id: `__opt_${prefix}_tap_text`,
    title: `Tap ${prefix} by text`,
    source: "custom",
    steps: [{ kind: "tap", target: { text: `{{${prefix}_text}}` } }],
    createdAt: at,
    updatedAt: at,
  };
  const tapLabelOrText: Recipe = {
    id: `__opt_${prefix}_tap_label_or_text`,
    title: `Tap ${prefix} by label or text`,
    source: "custom",
    steps: [
      {
        kind: "branch",
        input: `{{${prefix}_label}}`,
        operator: "not-equals",
        expected: OPTION_NONE,
        thenRecipeId: tapLabel.id,
        elseRecipeId: tapText.id,
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  return {
    [tapIdentifier.id]: tapIdentifier,
    [tapLabel.id]: tapLabel,
    [tapText.id]: tapText,
    [tapLabelOrText.id]: tapLabelOrText,
  };
}

export function selectSteps(prefix: string): RecipeStep[] {
  return [
    {
      kind: "branch",
      input: `{{${prefix}_identifier}}`,
      operator: "not-equals",
      expected: OPTION_NONE,
      thenRecipeId: `__opt_${prefix}_tap_identifier`,
      elseRecipeId: `__opt_${prefix}_tap_label_or_text`,
    },
    { kind: "sleep", ms: 900 },
  ];
}

/**
 * Resolve a saved list row into the same semantic target priority used while
 * applying a matrix value. `restoreId` is a row id, not necessarily visible
 * copy, so it must resolve through the row's recorded accessibility target.
 */
export function targetsForOptionRow(row: VariableRow): StepTarget[] {
  const candidates: StepTarget[] = [];
  const identifier = row.identifier?.trim();
  const label = row.label?.trim();
  const text = row.text?.trim();
  if (identifier) candidates.push({ identifier });
  if (label) candidates.push({ label });
  if (text) candidates.push({ text });
  return candidates;
}

export function restoreListSteps(set: {
  name: string;
  restoreId?: string;
  options: VariableRow[];
}): RecipeStep[] {
  const restoreId = set.restoreId?.trim();
  if (!restoreId) return [];
  const row = set.options.find((option) => option.id === restoreId);
  if (!row) {
    throw new Error(`variable “${set.name}” has no restore option ${restoreId}`);
  }
  const [target, ...fallbackTargets] = targetsForOptionRow(row);
  if (!target) {
    throw new Error(
      `restore option “${restoreId}” for variable “${set.name}” needs an identifier, label, or text`,
    );
  }
  return [
    {
      kind: "tap",
      target,
      ...(fallbackTargets.length ? { fallbackTargets } : {}),
    },
    { kind: "sleep", ms: 900 },
  ];
}

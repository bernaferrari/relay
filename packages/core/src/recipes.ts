/**
 * One recipe model: JSON step-list recipes on disk, listed/edited over HTTP,
 * executed by the job engine (recipe-runner.ts + session.ts).
 *
 * Built-in coded flows are mirrored here as single-`flow`-step recipes so the
 * UI has a uniform list; custom recipes live as files under `recipes/`.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { ACTIONS, isActionId } from "./actions.js";
import { findWorkspaceRoot } from "./runs.js";
import { now } from "./events.js";
import type { Glyph } from "./trace.js";

/** How to find a target on screen — ordered fallbacks, most robust first. */
export type StepTarget = {
  /** a11y ref, e.g. "@e26" (most robust within one screen) */
  ref?: string;
  /** exact accessibility label */
  label?: string;
  /** text-contains match (device find query) */
  text?: string;
  /** raw coordinates (always works, least robust) */
  point?: { x: number; y: number };
};

export type RecipeStep =
  | { kind: "tap"; target: StepTarget; note?: string }
  | { kind: "type"; text: string; target?: StepTarget; note?: string }
  | { kind: "scroll"; direction: "down" | "up"; amount?: number; note?: string }
  | { kind: "key"; key: "back" | "home"; note?: string }
  | { kind: "sleep"; ms: number; note?: string }
  | { kind: "wait-for"; target: StepTarget; timeoutMs?: number; note?: string }
  | { kind: "pause"; message: string; note?: string }
  | { kind: "screenshot"; caption?: string; note?: string }
  | { kind: "flow"; flow: string; note?: string };

export type Recipe = {
  /** slug, unique; custom ones are "custom-<slug>" */
  id: string;
  title: string;
  description?: string;
  source: "builtin" | "custom";
  steps: RecipeStep[];
  createdAt: number;
  updatedAt: number;
};

const MAX_WAIT_MS = 15 * 60 * 1000;

/** Directory for custom recipes — mirrors runsRoot()'s convention. */
export function recipesRoot(): string {
  const env = process.env.GROK_DEVICE_RECIPES_DIR?.trim();
  if (env) return env;
  return join(findWorkspaceRoot(), "recipes");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function targetHasStrategy(t: StepTarget): boolean {
  return Boolean(t.ref || t.label || t.text || t.point);
}

export function describeTarget(t: StepTarget): string {
  if (t.ref) return `ref ${t.ref}`;
  if (t.label) return `label "${t.label}"`;
  if (t.text) return `text "${t.text}"`;
  if (t.point) return `point (${t.point.x}, ${t.point.y})`;
  return "<empty>";
}

function stepErr(index: number, why: string): Error {
  return new Error(`step ${index}: ${why}`);
}

function parseTarget(raw: unknown, index: number, field: string): StepTarget {
  if (!isObject(raw)) throw stepErr(index, `${field} must be an object`);
  const t: StepTarget = {};
  if (raw.ref !== undefined) {
    if (!isString(raw.ref)) throw stepErr(index, `${field}.ref must be a string`);
    t.ref = raw.ref;
  }
  if (raw.label !== undefined) {
    if (!isString(raw.label)) throw stepErr(index, `${field}.label must be a string`);
    t.label = raw.label;
  }
  if (raw.text !== undefined) {
    if (!isString(raw.text)) throw stepErr(index, `${field}.text must be a string`);
    t.text = raw.text;
  }
  if (raw.point !== undefined) {
    const p = raw.point;
    if (!isObject(p) || !isNumber(p.x) || !isNumber(p.y)) {
      throw stepErr(index, `${field}.point must be { x: number, y: number }`);
    }
    t.point = { x: p.x, y: p.y };
  }
  return t;
}

/**
 * Validate an unknown steps array field-by-field. Throws `Error` naming the
 * first invalid step index and why. Returns the narrowed `RecipeStep[]`.
 */
export function validateRecipeSteps(steps: unknown): RecipeStep[] {
  if (!Array.isArray(steps)) throw new Error("steps must be an array");
  const out: RecipeStep[] = [];
  steps.forEach((raw, i) => {
    const index = i + 1; // 1-based for human-readable error messages
    if (!isObject(raw)) throw stepErr(index, "must be an object");
    const kind = raw.kind;
    if (!isString(kind)) throw stepErr(index, "kind is required");
    // optional note on every kind
    const note = raw.note !== undefined && isString(raw.note) ? raw.note : undefined;
    switch (kind) {
      case "tap": {
        const target = parseTarget(raw.target, index, "target");
        if (!targetHasStrategy(target)) {
          throw stepErr(index, "tap requires target with at least one of ref/label/text/point");
        }
        const step: Extract<RecipeStep, { kind: "tap" }> = {
          kind: "tap",
          target,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "type": {
        if (!isString(raw.text)) throw stepErr(index, "type requires text: string");
        const step: Extract<RecipeStep, { kind: "type" }> = {
          kind: "type",
          text: raw.text,
          ...(raw.target !== undefined ? { target: parseTarget(raw.target, index, "target") } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "scroll": {
        if (raw.direction !== "down" && raw.direction !== "up") {
          throw stepErr(index, 'scroll requires direction: "down" | "up"');
        }
        const step: Extract<RecipeStep, { kind: "scroll" }> = {
          kind: "scroll",
          direction: raw.direction,
          ...(raw.amount !== undefined
            ? isNumber(raw.amount)
              ? { amount: raw.amount }
              : (() => {
                  throw stepErr(index, "scroll.amount must be a number");
                })()
            : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "key": {
        if (raw.key !== "back" && raw.key !== "home") {
          throw stepErr(index, 'key requires key: "back" | "home"');
        }
        const step: Extract<RecipeStep, { kind: "key" }> = {
          kind: "key",
          key: raw.key,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "sleep": {
        if (!isNumber(raw.ms)) throw stepErr(index, "sleep requires ms: number");
        if (raw.ms < 0) throw stepErr(index, "sleep ms must be >= 0");
        const step: Extract<RecipeStep, { kind: "sleep" }> = {
          kind: "sleep",
          ms: raw.ms,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "wait-for": {
        const target = parseTarget(raw.target, index, "target");
        // point-only targets can't be "waited for" (validation-time rejection)
        if (target.point && !target.ref && !target.label && !target.text) {
          throw stepErr(
            index,
            "wait-for target must have ref/label/text (point-only is not waitable)",
          );
        }
        if (!targetHasStrategy(target)) {
          throw stepErr(index, "wait-for requires target with ref/label/text");
        }
        let timeoutMs: number | undefined;
        if (raw.timeoutMs !== undefined) {
          if (!isNumber(raw.timeoutMs)) throw stepErr(index, "wait-for.timeoutMs must be a number");
          if (raw.timeoutMs < 0) throw stepErr(index, "wait-for.timeoutMs must be >= 0");
          if (raw.timeoutMs > MAX_WAIT_MS)
            throw stepErr(index, `wait-for.timeoutMs must be <= ${MAX_WAIT_MS} (15 min)`);
          timeoutMs = raw.timeoutMs;
        }
        const step: Extract<RecipeStep, { kind: "wait-for" }> = {
          kind: "wait-for",
          target,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "pause": {
        if (!isString(raw.message)) throw stepErr(index, "pause requires message: string");
        const step: Extract<RecipeStep, { kind: "pause" }> = {
          kind: "pause",
          message: raw.message,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "screenshot": {
        const step: Extract<RecipeStep, { kind: "screenshot" }> = {
          kind: "screenshot",
          ...(raw.caption !== undefined && isString(raw.caption) ? { caption: raw.caption } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "flow": {
        if (!isString(raw.flow)) throw stepErr(index, "flow requires flow: string (an ActionId)");
        if (!isActionId(raw.flow)) {
          throw stepErr(index, `flow references unknown action id: ${raw.flow}`);
        }
        const step: Extract<RecipeStep, { kind: "flow" }> = {
          kind: "flow",
          flow: raw.flow,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      default:
        throw stepErr(index, `unknown step kind: ${kind}`);
    }
  });
  return out;
}

/** Built-in recipes: one per coded flow, each a single opaque `flow` step. */
export function builtinRecipes(): Recipe[] {
  return ACTIONS.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    source: "builtin" as const,
    steps: [{ kind: "flow", flow: a.id }],
    createdAt: 0,
    updatedAt: 0,
  }));
}

function customId(id: string): boolean {
  // builtin ids are the ACTION_IDS; anything else is treated as custom.
  return !isActionId(id);
}

/** Builtins first, then custom recipes read from disk, sorted by updatedAt desc. */
export async function listRecipes(): Promise<Recipe[]> {
  const builtins = builtinRecipes();
  let entries: string[] = [];
  try {
    entries = await readdir(recipesRoot());
  } catch {
    return builtins;
  }
  const customs: Recipe[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(recipesRoot(), name), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isObject(parsed) || !isString(parsed.id)) continue;
      const recipe = parsed as unknown as Recipe;
      recipe.source = "custom";
      customs.push(recipe);
    } catch {
      /* skip unreadable files — tolerant like listPersistedRuns */
    }
  }
  customs.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return [...builtins, ...customs];
}

export async function readRecipe(id: string): Promise<Recipe | null> {
  const builtin = builtinRecipes().find((r) => r.id === id);
  if (builtin) return builtin;
  try {
    const raw = await readFile(join(recipesRoot(), `${id}.json`), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || !isString(parsed.id)) return null;
    const recipe = parsed as unknown as Recipe;
    recipe.source = "custom";
    return recipe;
  } catch {
    return null;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function ensureRecipesRoot(): Promise<void> {
  await mkdir(recipesRoot(), { recursive: true });
}

export type SaveRecipeInput = {
  id?: string;
  title: string;
  description?: string;
  steps: RecipeStep[];
};

/**
 * Create or overwrite a custom recipe. Refuses builtin ids. When `id` is
 * absent, generates `custom-<slug(title)>-<base36 time>`.
 */
export async function saveRecipe(input: SaveRecipeInput): Promise<Recipe> {
  const steps = validateRecipeSteps(input.steps);
  if (!isString(input.title) || input.title.trim().length === 0) {
    throw new Error("title is required");
  }
  const ts = now();
  let id = input.id?.trim();
  if (id && !customId(id)) {
    throw new Error(`cannot overwrite builtin recipe: ${id}`);
  }
  if (!id) {
    id = `custom-${slugify(input.title)}-${ts.toString(36)}`;
  }
  // If overwriting, preserve createdAt.
  const existing = await readRecipe(id);
  const recipe: Recipe = {
    id,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    source: "custom",
    steps,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };
  await ensureRecipesRoot();
  await writeFile(join(recipesRoot(), `${id}.json`), JSON.stringify(recipe, null, 2), "utf8");
  return recipe;
}

/** Delete a custom recipe. Deleting a builtin id throws. */
export async function deleteRecipe(id: string): Promise<void> {
  if (!customId(id)) {
    throw new Error(`cannot delete builtin recipe: ${id}`);
  }
  const path = join(recipesRoot(), `${id}.json`);
  if (existsSync(path)) {
    await unlink(path);
  }
}

/** Human-readable one-line title for a step (trace + log surface). */
export function describeRecipeStep(step: RecipeStep): string {
  switch (step.kind) {
    case "tap":
      return `Tap ${describeTarget(step.target)}`;
    case "type":
      return step.target ? `Type into ${describeTarget(step.target)}` : "Type text";
    case "scroll":
      return `Scroll ${step.direction}`;
    case "key":
      return `Key: ${step.key}`;
    case "sleep":
      return `Sleep ${step.ms}ms`;
    case "wait-for":
      return `Wait for ${describeTarget(step.target)}`;
    case "pause":
      return `Pause: ${step.message}`;
    case "screenshot":
      return step.caption ? `Screenshot · ${step.caption}` : "Screenshot";
    case "flow":
      return `Flow: ${step.flow}`;
  }
}

/** Trace glyphs for a step (meta-row chrome). */
export function glyphsForStep(step: RecipeStep): Glyph[] {
  switch (step.kind) {
    case "tap":
      return ["tap"];
    case "type":
      return ["type"];
    case "scroll":
      return ["swipe"];
    case "key":
      return ["tap"];
    case "sleep":
      return ["wait"];
    case "wait-for":
      return ["wait"];
    case "pause":
      return ["wait"];
    case "screenshot":
      return ["shot"];
    case "flow":
      return ["store"];
  }
}

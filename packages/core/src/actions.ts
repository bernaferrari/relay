/**
 * Registered action catalog (OpenCode-style command IDs).
 * Core owns the extension point and execution contract; product-specific
 * implementations live in product packages and register themselves.
 */
import type { Device } from "./device/device.js";
import { planForAction, type RecipeTracePlan } from "./trace/trace.js";

/** Action ids are extension-owned strings, not a core product catalog. */
export type ActionId = string;
export type ActionCategory = string;

export type ActionMeta = {
  id: ActionId;
  title: string;
  description: string;
  category: ActionCategory;
  /** Needs a caller-supplied production account matcher. */
  requiresProdMatch?: boolean;
  /** Flow supports restore-home options. */
  isAlpha?: boolean;
  /** Product-specific execution preview used by trace-capable callers. */
  tracePlan?: RecipeTracePlan;
  /** default trace glyphs for pre-run preview */
  glyphs?: string[];
  /** planned trace steps for pre-run preview */
  planned?: { title: string; glyphs: string[] }[];
};

export type RunActionOptions = {
  prodAccountMatch?: string;
  onLog?: (line: string) => void;
};

export type ActionImplementation = (device: Device, options: RunActionOptions) => Promise<unknown>;

type RegisteredAction = {
  meta: Omit<ActionMeta, "glyphs" | "planned">;
  run: ActionImplementation;
};

const registeredActions = new Map<ActionId, RegisteredAction>();

/** Register one product action. The returned function is primarily for tests. */
export function registerAction(
  meta: RegisteredAction["meta"],
  run: ActionImplementation,
): () => void {
  if (!meta.id.trim()) throw new Error("Action id must be non-empty");
  if (!meta.title.trim()) throw new Error(`${meta.id} must have a title`);
  if (!meta.description.trim()) throw new Error(`${meta.id} must have a description`);
  if (!meta.category.trim()) throw new Error(`${meta.id} must have a category`);
  if (registeredActions.has(meta.id)) throw new Error(`Duplicate action id: ${meta.id}`);
  registeredActions.set(meta.id, { meta, run });
  return () => {
    if (registeredActions.get(meta.id)?.run === run) registeredActions.delete(meta.id);
  };
}

export function listActions(): ActionMeta[] {
  return [...registeredActions.values()].map((entry) => ({ ...entry.meta }));
}

export function isActionId(id: string): id is ActionId {
  return registeredActions.has(id);
}

export function getAction(id: string): ActionMeta | undefined {
  const entry = registeredActions.get(id);
  return entry ? { ...entry.meta } : undefined;
}

export type RunActionResult =
  | { ok: true; action: ActionId; result?: unknown }
  | { ok: false; action: ActionId; error: string };

export async function runAction(
  device: Device,
  action: ActionId,
  opts: RunActionOptions = {},
): Promise<RunActionResult> {
  const log = opts.onLog ?? ((line: string) => console.log(line));
  const entry = registeredActions.get(action);
  if (!entry) return { ok: false, action, error: `Unknown action id: ${action}` };

  try {
    log(`==> ${action}`);
    const result = await entry.run(device, opts);
    log(
      `==> DONE: ${action}${result === undefined || result === "ok" ? "" : ` — ${String(result)}`}`,
    );
    return { ok: true, action, result: result ?? "ok" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`==> FAIL: ${action} — ${error}`);
    return { ok: false, action, error };
  }
}

/** Registered actions with default trace glyphs + planned steps attached. */
export function listActionsWithTrace(): ActionMeta[] {
  return listActions().map((action) => {
    const plan = action.tracePlan ?? planForAction(action.id);
    return { ...action, glyphs: plan.glyphs, planned: plan.planned };
  });
}

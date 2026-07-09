/**
 * Pure UX rules for the run pane — can-run, blockers, planned steps,
 * history summary. Kept free of Solid/DOM so unit tests can lock the
 * authoring contract without mounting the workbench.
 */

export type RunGateInput = {
  hasRecipe: boolean;
  health: "online" | "offline" | "unknown" | string;
  emptyDevices: boolean;
  source: "custom" | "builtin" | null;
  stepCount: number;
  saveState: "saved" | "saving" | "invalid";
  plannedCount?: number;
};

/** Whether the primary Run control should be enabled. */
export function canRunRecipe(g: RunGateInput): boolean {
  if (!g.hasRecipe) return false;
  if (g.health !== "online") return false;
  if (g.emptyDevices) return false;
  // Library tests run as packaged flows even with a single wrapper step.
  if (g.source === "builtin") return true;
  if (g.stepCount === 0) return false;
  if (g.saveState === "invalid") return false;
  if (g.saveState === "saving") return false;
  return true;
}

/** Short reason Run is blocked, or "" when runnable / no recipe. */
export function runBlocker(g: RunGateInput): string {
  if (!g.hasRecipe) return "";
  if (canRunRecipe(g)) return "";
  if (g.health !== "online") return "Server offline";
  if (g.emptyDevices) return "Connect a device";
  if (g.source === "builtin" && (g.plannedCount ?? 0) > 0) return "";
  if (g.stepCount === 0) return "Add a step";
  if (g.saveState === "invalid") return "Fix incomplete steps";
  if (g.saveState === "saving") return "Saving…";
  return "";
}

export type PlannedTitle = { title: string };

/** Map action.planned metadata into read-only planned rows. */
export function plannedStepsFromMeta(
  planned: { title: string }[] | undefined | null,
): PlannedTitle[] {
  if (!planned?.length) return [];
  return planned.map((p) => ({ title: p.title }));
}

/**
 * Resolve human step titles for the workbench list.
 * - Builtin → action.planned
 * - Custom that is only a single flow wrapper → that flow's planned
 *   (so Edit doesn't collapse a 3-step test into “Built-in: foo”)
 * - Free custom recipes → [] (use the real step editor)
 */
export function resolvePlannedTitles(input: {
  source: "custom" | "builtin" | null;
  recipeId: string | null;
  steps: { kind: string; flow?: string }[];
  actions: { id: string; planned?: { title: string }[] }[];
}): PlannedTitle[] {
  const { source, recipeId, steps, actions } = input;
  if (source === "builtin" && recipeId) {
    return plannedStepsFromMeta(actions.find((a) => a.id === recipeId)?.planned);
  }
  if (source === "custom" && steps.length === 1 && steps[0]?.kind === "flow" && steps[0].flow) {
    return plannedStepsFromMeta(actions.find((a) => a.id === steps[0]!.flow)?.planned);
  }
  return [];
}

/** True when the draft is a packaged flow, not free-form authoring. */
export function isPackagedFlowSteps(steps: { kind: string; flow?: string }[]): boolean {
  return steps.length === 1 && steps[0]?.kind === "flow" && Boolean(steps[0]?.flow);
}

export type HistoryChipStatus = string;

export type HistorySummary = {
  total: number;
  passed: number;
  failed: number;
  other: number;
  summary: string;
  latestTone: "pass" | "fail" | "heal" | "run" | "idle" | "warn";
};

function toneFromStatus(status: string): HistorySummary["latestTone"] {
  if (status === "ok") return "pass";
  if (status === "healed") return "heal";
  if (status === "error") return "fail";
  if (status === "running" || status === "queued" || status === "paused") return "run";
  return "idle";
}

/** Compact run-history summary from chip statuses + latest relative age. */
export function summarizeRunHistory(
  chips: { status: HistoryChipStatus }[],
  latestWhen: string,
): HistorySummary | null {
  if (!chips.length) return null;
  let passed = 0;
  let failed = 0;
  let other = 0;
  for (const c of chips) {
    if (c.status === "ok" || c.status === "healed") passed++;
    else if (c.status === "error") failed++;
    else other++;
  }
  const latest = chips[0]!;
  const latestTone = toneFromStatus(latest.status);
  let summary = "";
  if (failed && passed) summary = `${passed} passed · ${failed} failed · ${latestWhen}`;
  else if (failed) summary = `${failed} failed · ${latestWhen}`;
  else if (passed) summary = `${passed} passed · ${latestWhen}`;
  else summary = `${chips.length} runs · ${latestWhen}`;
  return { total: chips.length, passed, failed, other, summary, latestTone };
}

/** Map a persisted/live step status onto canvas card pass/fail. */
export function stepStatusFromRun(
  steps: { status?: string }[] | undefined,
  i: number,
): "pass" | "fail" | "idle" {
  const s = steps?.[i]?.status;
  if (s === "ok" || s === "healed") return "pass";
  if (s === "error") return "fail";
  return "idle";
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

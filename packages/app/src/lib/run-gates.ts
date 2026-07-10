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

export type EditableExpandedStep = {
  kind: "tap";
  target: { label: string };
};

/**
 * Expand a thin `flow` wrapper into editable rows (one per planned title).
 * Library tests use the same step editor as custom tests — nothing special.
 * Rows start as taps with the planned title as the label (valid + editable).
 * {@link collapseUnchangedFlow} rewrites them back to a single flow on save
 * when the user hasn't reworked the plan, so Run still hits the real action.
 */
export function expandFlowToEditableSteps(input: {
  steps: { kind: string; flow?: string; target?: { label?: string } }[];
  recipeId: string | null;
  source: "custom" | "builtin" | null;
  planned: { title: string }[] | undefined | null;
}): EditableExpandedStep[] | null {
  const { steps, planned } = input;
  if (!planned?.length) return null;
  const thinFlow =
    steps.length === 0 ||
    (steps.length === 1 && steps[0]?.kind === "flow" && Boolean(steps[0]?.flow));
  if (!thinFlow) return null;
  return planned.map((p) => ({
    kind: "tap" as const,
    target: { label: p.title },
  }));
}

/**
 * If draft rows are still the expanded planned titles (untouched), save as a
 * single flow step so Run still executes the real packaged action.
 */
export function collapseUnchangedFlow(input: {
  steps: {
    kind: string;
    flow?: string;
    target?: { label?: string; ref?: string; text?: string; point?: unknown };
  }[];
  flowId: string;
  planned: { title: string }[] | undefined | null;
}): { kind: "flow"; flow: string }[] | null {
  const { steps, flowId, planned } = input;
  if (!planned?.length || steps.length !== planned.length) return null;
  const same = steps.every((s, i) => {
    if (s.kind !== "tap") return false;
    const t = s.target;
    if (!t || t.label !== planned[i]?.title) return false;
    // Untouched expansion has only a label — any other strategy means rework.
    if (t.ref || t.text || t.point) return false;
    return true;
  });
  if (!same) return null;
  return [{ kind: "flow", flow: flowId }];
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

/**
 * Map a persisted/live step status onto canvas card tone.
 * `healed` is distinct so the Map can draw a heal branch (not plain pass).
 */
export function stepStatusFromRun(
  steps: { status?: string }[] | undefined,
  i: number,
): "pass" | "fail" | "heal" | "idle" {
  const s = steps?.[i]?.status;
  if (s === "ok") return "pass";
  if (s === "healed") return "heal";
  if (s === "error") return "fail";
  return "idle";
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

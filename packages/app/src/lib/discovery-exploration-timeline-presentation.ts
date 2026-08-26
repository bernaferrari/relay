import type {
  DiscoveryExplorationTimeline,
  DiscoveryExplorationTimelineStep,
  DiscoveryExploreRun,
} from "@relay/protocol";

export type ExplorationTimelineRowTone = "opened" | "stayed" | "back";

export type ExplorationTimelineRow = {
  key: string;
  index: number;
  /** What the crawl did, in the words a human would use. */
  action: string;
  /** Where it ended up, or the screen it stayed on. */
  destination: string;
  tone: ExplorationTimelineRowTone;
};

export type ExplorationTimelineCursorSummary = {
  label: string;
  detail: string;
  tone: "proven" | "unknown" | "handoff";
};

/** Compact, non-speculative answer to where Relay knows the device is. */
export function explorationTimelineCursorSummary(
  run: DiscoveryExploreRun | undefined,
): ExplorationTimelineCursorSummary | undefined {
  const cursor = run?.navigationCursor;
  if (!cursor) return undefined;
  if (cursor.status === "proven") {
    return {
      label: "Position proven",
      detail: cursor.screenId,
      tone: "proven",
    };
  }
  if (cursor.status === "external-handoff") {
    return {
      label: "External handoff",
      detail: cursor.foregroundApp,
      tone: "handoff",
    };
  }
  return {
    label: "Position unknown",
    detail: cursor.reason,
    tone: "unknown",
  };
}

/** Sentence for the crawl outcome, or undefined while it is still walking. */
export function explorationTimelineOutcomeSummary(
  run: DiscoveryExploreRun | undefined,
): string | undefined {
  const stop = run?.stopReason;
  if (!run || !stop) return undefined;
  switch (stop.code) {
    case "complete":
      return `Explored every safe row within depth ${run.maxDepth}.`;
    case "budget":
      return "Stopped at the screen, step, or time budget.";
    case "left_app":
      return "Stopped at an external app handoff for review.";
    case "cancelled":
      return "Stopped because someone cancelled it.";
    case "error":
      return `Stopped on an error: ${stop.message}`;
  }
}

function actionLabel(step: DiscoveryExplorationTimelineStep): string {
  const label = step.label?.trim();
  switch (step.kind) {
    case "back":
      return "Went back";
    case "type":
      return label ? `Typed into ${label}` : "Typed";
    case "scroll":
      return label ? `Scrolled ${label}` : "Scrolled";
    case "manual":
      return label ? `Opened ${label} by hand` : "Acted by hand";
    case "tap":
      return label ? `Tapped ${label}` : "Tapped";
  }
}

function tone(step: DiscoveryExplorationTimelineStep): ExplorationTimelineRowTone {
  if (step.kind === "back") return "back";
  return step.changedScreen ? "opened" : "stayed";
}

/**
 * Flatten an exploration timeline into rows.
 *
 * A step that did not change the screen is kept rather than hidden: "tapped and
 * nothing happened" is the single most useful signal when a crawl looks stuck.
 */
export function explorationTimelineRows(
  timeline: DiscoveryExplorationTimeline | undefined,
): ExplorationTimelineRow[] {
  if (!timeline) return [];
  return timeline.steps.map((step) => ({
    key: step.transitionId,
    index: step.index,
    action: actionLabel(step),
    destination: step.changedScreen
      ? step.toTitle?.trim() || step.toScreenId || "a new screen"
      : step.fromTitle?.trim() || step.fromScreenId,
    tone: tone(step),
  }));
}

/** "4 screens over 9 steps" — the one-line shape of a crawl. */
export function explorationTimelineHeadline(
  timeline: DiscoveryExplorationTimeline | undefined,
): string | undefined {
  if (!timeline) return undefined;
  const screens = new Set<string>();
  for (const step of timeline.steps) {
    if (step.changedScreen && step.toScreenId) screens.add(step.toScreenId);
    screens.add(step.fromScreenId);
  }
  if (timeline.stepCount === 0) return "No steps yet";
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `${plural(screens.size, "screen")} over ${plural(timeline.stepCount, "step")}`;
}

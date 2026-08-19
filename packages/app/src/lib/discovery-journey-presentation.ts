import type { DiscoveryExploreRun, DiscoveryJourney, DiscoveryJourneyStep } from "@relay/protocol";

export type JourneyRowTone = "opened" | "stayed" | "back";

export type JourneyRow = {
  key: string;
  index: number;
  /** What the crawl did, in the words a human would use. */
  action: string;
  /** Where it ended up, or the screen it stayed on. */
  destination: string;
  tone: JourneyRowTone;
};

/** Sentence for the crawl outcome, or undefined while it is still walking. */
export function journeyOutcomeSummary(run: DiscoveryExploreRun | undefined): string | undefined {
  const stop = run?.stopReason;
  if (!run || !stop) return undefined;
  const recovered =
    run.softRecoveries > 0
      ? ` after ${run.softRecoveries} recovery${run.softRecoveries === 1 ? "" : " attempts"}`
      : "";
  switch (stop.code) {
    case "complete":
      return `Explored every safe row within depth ${run.maxDepth}${recovered}.`;
    case "budget":
      return `Stopped at the screen, step, or time budget${recovered}.`;
    case "left_app":
      return `Stopped because the device left the app and would not come back${recovered}.`;
    case "cancelled":
      return "Stopped because someone cancelled it.";
    case "error":
      return `Stopped on an error: ${stop.message}`;
  }
}

function actionLabel(step: DiscoveryJourneyStep): string {
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

function tone(step: DiscoveryJourneyStep): JourneyRowTone {
  if (step.kind === "back") return "back";
  return step.changedScreen ? "opened" : "stayed";
}

/**
 * Flatten a journey into timeline rows.
 *
 * A step that did not change the screen is kept rather than hidden: "tapped and
 * nothing happened" is the single most useful signal when a crawl looks stuck.
 */
export function journeyRows(journey: DiscoveryJourney | undefined): JourneyRow[] {
  if (!journey) return [];
  return journey.steps.map((step) => ({
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
export function journeyHeadline(journey: DiscoveryJourney | undefined): string | undefined {
  if (!journey) return undefined;
  const screens = new Set<string>();
  for (const step of journey.steps) {
    if (step.changedScreen && step.toScreenId) screens.add(step.toScreenId);
    screens.add(step.fromScreenId);
  }
  if (journey.stepCount === 0) return "No steps yet";
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `${plural(screens.size, "screen")} over ${plural(journey.stepCount, "step")}`;
}

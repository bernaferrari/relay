import type {
  DiscoveryBlockedReason,
  DiscoveryExploreOutcome,
  DiscoveryJourney,
  DiscoveryJourneyStep,
  DiscoverySession,
} from "@relay/protocol";

const AUTH_TITLE =
  /^(sign\s*in|log\s*in|login|authenticate|passcode|password|verify|two[- ]factor|2fa)$/i;
const LEFT_APP_LABEL =
  /app language|preferred language|open (ios |system )?settings|system settings/i;

/**
 * Ordered discovery path timeline with screenshot refs for Atlas.
 * Steps follow transition capture order (not BFS), so the timeline matches
 * what the explorer actually did.
 */
export function buildDiscoveryJourney(
  session: DiscoverySession,
  at = Date.now(),
): DiscoveryJourney {
  const byId = new Map(session.screens.map((screen) => [screen.id, screen]));
  const ordered = [...session.transitions].sort(
    (left, right) => left.capturedAt - right.capturedAt || left.id.localeCompare(right.id),
  );
  const steps: DiscoveryJourneyStep[] = ordered.map((transition, index) => {
    const from = byId.get(transition.fromScreenId);
    const to = transition.toScreenId ? byId.get(transition.toScreenId) : undefined;
    const screenshotScreen = to ?? from;
    return {
      index,
      transitionId: transition.id,
      kind: transition.kind,
      ...(transition.label?.trim() ? { label: transition.label.trim() } : {}),
      fromScreenId: transition.fromScreenId,
      ...(transition.toScreenId ? { toScreenId: transition.toScreenId } : {}),
      ...(from?.title?.trim() ? { fromTitle: from.title.trim() } : {}),
      ...(to?.title?.trim()
        ? { toTitle: to.title.trim() }
        : from?.title?.trim() && !transition.changedScreen
          ? { toTitle: from.title.trim() }
          : {}),
      changedScreen: transition.changedScreen,
      capturedAt: transition.capturedAt,
      ...(screenshotScreen?.screenshotPath
        ? { screenshotPath: screenshotScreen.screenshotPath }
        : {}),
      ...(screenshotScreen ? { screenshotScreenId: screenshotScreen.id } : {}),
    };
  });
  return {
    sessionId: session.id,
    mapName: session.name,
    generatedAt: at,
    status: session.status,
    stepCount: steps.length,
    steps,
  };
}

/** Infer explore stop reasons from session evidence without requiring job metadata. */
export function inferDiscoveryBlockedReasons(session: DiscoverySession): DiscoveryBlockedReason[] {
  const reasons: DiscoveryBlockedReason[] = [];
  const authScreen = session.screens.find((screen) => AUTH_TITLE.test(screen.title?.trim() ?? ""));
  if (authScreen) {
    reasons.push({
      code: "auth",
      message: "Explore reached an authentication surface",
      evidence: authScreen.title?.trim() || authScreen.id,
    });
  }
  const leftApp = session.transitions.find((transition) =>
    LEFT_APP_LABEL.test(transition.label?.trim() ?? ""),
  );
  if (leftApp) {
    reasons.push({
      code: "left-app",
      message: "Explore navigated toward a system or external surface",
      evidence: leftApp.label?.trim() || leftApp.id,
    });
  }
  if (session.screens.length >= session.scope.maxScreens) {
    reasons.push({
      code: "budget",
      message: "Screen budget reached",
      evidence: `${session.screens.length}/${session.scope.maxScreens}`,
    });
  } else if (session.transitions.length >= session.scope.maxTransitions) {
    reasons.push({
      code: "budget",
      message: "Transition budget reached",
      evidence: `${session.transitions.length}/${session.scope.maxTransitions}`,
    });
  }
  if (session.status === "stopped") {
    reasons.push({
      code: "cancelled",
      message: "Discovery explore was stopped before completion",
    });
  } else if (session.status === "paused") {
    reasons.push({
      code: "incomplete",
      message: "Discovery explore is paused",
    });
  } else if (
    session.status === "complete" &&
    session.transitions.length === 0 &&
    session.screens.length <= 1
  ) {
    reasons.push({
      code: "incomplete",
      message: "Explore finished without mapping new paths",
    });
  }
  return reasons;
}

export function discoveryExploreOutcome(
  session: DiscoverySession,
  blockedReasons: DiscoveryBlockedReason[] = inferDiscoveryBlockedReasons(session),
): DiscoveryExploreOutcome {
  if (session.status === "draft") return "draft";
  if (session.status === "running") return "running";
  if (blockedReasons.some((reason) => reason.code === "auth" || reason.code === "left-app")) {
    return "blocked";
  }
  if (session.status === "complete") {
    return blockedReasons.some((reason) => reason.code === "budget" || reason.code === "incomplete")
      ? "partial"
      : "complete";
  }
  if (session.status === "stopped" || session.status === "paused") return "partial";
  return "partial";
}

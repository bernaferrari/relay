import type { ActionSpec, AppMap } from "@relay/protocol";
import { sentenceForStep } from "./step-sentence";

export type ConnectionActionSummary = {
  id: string;
  actionId: string;
  stepId?: string;
  label: string;
  waitMs?: number;
};

function targetName(target: { label?: string; text?: string; identifier?: string }): string {
  return target.label ?? target.text ?? target.identifier ?? "target";
}

/** Human-readable, editable rows projected from canonical ActionSpecs. */
export function connectionActionSummaries(
  actions: ActionSpec[],
  appMap: AppMap | null | undefined,
): ConnectionActionSummary[] {
  return actions.flatMap((action) => {
    const markOptional = (label: string) =>
      action.optional ? `${label} · continue if unavailable` : label;
    if (action.kind === "recorded" || action.kind === "steps") {
      return action.steps.map((step, index) => ({
        id: `${action.id}:${step.id ?? index}`,
        actionId: action.id,
        ...(step.id ? { stepId: step.id } : {}),
        label: markOptional(step.kind === "sleep" ? "Wait" : sentenceForStep(step)),
        ...(step.kind === "sleep" ? { waitMs: step.ms } : {}),
      }));
    }
    const label =
      action.label ??
      (action.kind === "tap"
        ? `Tap ${targetName(action.target)}`
        : action.kind === "text"
          ? `Enter ${action.text.length > 32 ? `${action.text.slice(0, 29)}…` : action.text}`
          : action.kind === "gesture"
            ? action.gesture.kind === "scroll"
              ? `Scroll ${action.gesture.direction}`
              : "Swipe"
            : action.kind === "back"
              ? "Go back"
              : action.kind === "home"
                ? "Go Home"
                : action.kind === "app"
                  ? action.action === "open"
                    ? `Open ${action.app ?? action.url ?? "app"}`
                    : `Close ${action.app}`
                  : action.kind === "wait"
                    ? "Wait"
                    : action.kind === "assertion"
                      ? action.assertion.kind === "screen"
                        ? `Check ${appMap?.screens[action.assertion.screenId]?.title ?? "destination screen"}`
                        : action.assertion.kind === "target"
                          ? `Check ${targetName(action.assertion.target)} is ${action.assertion.condition === "visible" ? "visible" : "absent"}`
                          : `Check ${action.assertion.input}`
                      : action.kind === "routine"
                        ? `Run ${appMap?.routines[action.routineId]?.name ?? "routine"}`
                        : "Observe automatic transition");
    return [
      {
        id: action.id,
        actionId: action.id,
        label: markOptional(label),
        ...(action.kind === "wait" ? { waitMs: action.ms } : {}),
      },
    ];
  });
}

/** Return a new canonical action list with one recorded or declarative pause
 * updated. Every interface can persist this as an ordinary connection patch. */
export function updateConnectionWait(
  actions: ActionSpec[],
  actionId: string,
  stepId: string | undefined,
  waitMs: number,
): ActionSpec[] {
  const ms = Math.max(0, Math.round(waitMs));
  return actions.map((action) => {
    if (action.id !== actionId) return action;
    if (action.kind === "wait") return { ...action, ms };
    if (action.kind !== "recorded" && action.kind !== "steps") return action;
    return {
      ...action,
      steps: action.steps.map((step) =>
        step.kind === "sleep" && (!stepId || step.id === stepId) ? { ...step, ms } : step,
      ),
    };
  });
}

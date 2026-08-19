import type { ActionSpec, AppMap } from "@relay/protocol";
import { softTruncate } from "./human-error";
import { identifierControlPhrase } from "./humanize-identifier";
import { sentenceForStep } from "./step-sentence";

export type ConnectionActionSummary = {
  id: string;
  actionId: string;
  stepId?: string;
  label: string;
  waitMs?: number;
};

function targetName(target: {
  label?: string;
  text?: string;
  identifier?: string;
  ref?: string;
  point?: { x: number; y: number };
}): string {
  if (target.label?.trim()) return `"${target.label.trim()}"`;
  if (target.text?.trim()) return `"${target.text.trim()}"`;
  // Connection labels are the most-read copy on the canvas; a raw resource id
  // there is the loudest jargon leak in the product.
  const named = identifierControlPhrase(target.identifier);
  if (named) return named;
  if (target.ref) return "the recorded element";
  if (target.point) return "the screen";
  return "the target";
}

function humanInput(input: string): string {
  const value = input.trim();
  if (!value) return "value";
  const bare = value.match(/^\$\{([^}]+)\}$/);
  const token = bare?.[1] ?? value;
  const words = token
    .replace(/\$\{([^}]+)\}/g, "$1")
    .replace(/[._/-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words || "value";
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
          ? `Enter ${softTruncate(action.text, 32)}`
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
                          : `Check ${humanInput(action.assertion.input)}`
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

/** One plain sentence for a path card: From A, Tap "X" → B */
export function describeConnectionPath(input: {
  sourceTitle: string;
  targetTitle: string;
  actions?: Array<{ label: string }>;
  mode?: "device" | "automatic" | "reusable" | string;
}): string {
  const from = input.sourceTitle.trim() || "Start";
  const to = input.targetTitle.trim() || "next screen";
  if (input.mode === "automatic") {
    return `From ${from}, the app moves on its own → ${to}`;
  }
  const first = input.actions?.[0]?.label?.trim();
  if (!first) return `From ${from} → ${to}`;
  if ((input.actions?.length ?? 0) === 1) return `From ${from}, ${first} → ${to}`;
  const rest = (input.actions?.length ?? 1) - 1;
  return `From ${from}, ${first} (+${rest} more) → ${to}`;
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

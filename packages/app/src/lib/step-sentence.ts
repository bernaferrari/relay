/**
 * The one sentence formatter for a RecipeStep (plan: run-pane authoring
 * rebuild, M5 polish). Sentence case, quotes around labels/text, no
 * duplicated kind info — shared by the step rows, the recorder's status
 * strip, and anywhere else a step needs a human-readable line.
 */
import type { RecipeStep, StepTarget } from "./api-types";
import { targetValid } from "./step-target";
import { titleize, type TitledId } from "./job";

function targetPhrase(t: StepTarget | undefined): string {
  if (!t) return "an element";
  if (t.label) return `"${t.label}"`;
  if (t.text) return `"${t.text}"`;
  if (t.ref) return t.ref;
  if (t.point) return `${t.point.x}, ${t.point.y}`;
  return "an element";
}

function fmtSeconds(ms: number): string {
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return fmtSeconds(ms);
}

function cap(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Human, sentence-case one-liner for a step — the single formatter used
 *  across the step rows, recorder strip, and job/console captions. */
export function sentenceForStep(step: RecipeStep, recipes?: Iterable<TitledId>): string {
  switch (step.kind) {
    case "tap":
      return `Tap ${targetPhrase(step.target)}`;
    case "type":
      return step.text.trim() ? `Type "${step.text}"` : "Type text";
    case "wait-for": {
      const to = step.timeoutMs ? ` (${fmtSeconds(step.timeoutMs)})` : "";
      return `Wait until ${targetPhrase(step.target)} appears${to}`;
    }
    case "expect": {
      const to = step.timeoutMs ? ` (${fmtSeconds(step.timeoutMs)})` : "";
      const verb = step.condition === "gone" ? "is gone" : "is visible";
      return `Check ${targetPhrase(step.target)} ${verb}${to}`;
    }
    case "sleep":
      return `Wait ${fmtDuration(step.ms)}`;
    case "pause":
      return step.message.trim() ? `Pause: ${step.message}` : "Pause for human";
    case "key":
      return `Press ${step.key === "back" ? "Back" : "Home"}`;
    case "scroll":
      return step.amount
        ? `Scroll ${step.direction} ${step.amount}`
        : `Scroll ${cap(step.direction)}`;
    case "swipe":
      return `Swipe ${Math.round(step.from.x)}, ${Math.round(step.from.y)} → ${Math.round(step.to.x)}, ${Math.round(step.to.y)}`;
    case "screenshot":
      return step.caption ? `Screenshot · ${step.caption}` : "Screenshot";
    case "flow":
      return `Run flow: ${titleize(step.flow, recipes)}`;
  }
}

/** Is this step's own fields filled in enough to save/run? */
export function stepValid(step: RecipeStep): boolean {
  switch (step.kind) {
    case "tap":
    case "wait-for":
    case "expect":
      return targetValid(step.target);
    case "type":
      return step.text.trim().length > 0;
    case "sleep":
      return Number.isFinite(step.ms) && step.ms >= 0;
    case "pause":
      return step.message.trim().length > 0;
    case "flow":
      return step.flow.trim().length > 0;
    case "scroll":
    case "key":
    case "swipe":
    case "screenshot":
      return true;
  }
}

/** Short "what's missing" message for an invalid step row, or null if valid. */
export function stepIssue(step: RecipeStep): string | null {
  if (stepValid(step)) return null;
  switch (step.kind) {
    case "tap":
    case "wait-for":
    case "expect":
      return "Needs a target — a label, ref, text, or point.";
    case "type":
      return "Needs text to type.";
    case "sleep":
      return "Needs a wait duration.";
    case "pause":
      return "Needs instructions for the human.";
    case "flow":
      return "Needs a flow — pick one from the list.";
    default:
      return "Invalid step.";
  }
}

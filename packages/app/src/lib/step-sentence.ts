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
    case "long-press":
      return `Long press ${targetPhrase(step.target)}`;
    case "type":
      return step.text.trim() ? `Type "${step.text}"` : "Type text";
    case "wait-for": {
      const to = step.timeoutMs ? ` (${fmtSeconds(step.timeoutMs)})` : "";
      return `Wait until ${targetPhrase(step.target)} appears${to}`;
    }
    case "wait-response": {
      const stable = step.stableForMs ? `, stable for ${fmtSeconds(step.stableForMs)}` : "";
      return `Wait for ${targetPhrase(step.target)} to finish${stable}`;
    }
    case "expect": {
      const to = step.timeoutMs ? ` (${fmtSeconds(step.timeoutMs)})` : "";
      const verb = step.condition === "gone" ? "is gone" : "is visible";
      return `Check ${targetPhrase(step.target)} ${verb}${to}`;
    }
    case "extract":
      return `Extract ${targetPhrase(step.target)} as ${step.as}`;
    case "assert-content":
      return `Check ${step.input} ${step.match.replace("-", " ")} "${step.expected}"`;
    case "evaluate-semantic":
      return `Evaluate ${step.input} against ${step.criteria.length} criterion${step.criteria.length === 1 ? "" : "s"}`;
    case "sleep":
      return `Wait ${fmtDuration(step.ms)}`;
    case "pause":
      // Keep the action explicit: this is a deliberate handoff, not a sleep.
      return step.message.trim() ? `Wait for you: ${step.message}` : "Wait for your input";
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
      // Human title only — "Built-in:" was opaque jargon in the step list.
      return titleize(step.flow, recipes);
    case "module":
      return `Run ${titleize(step.recipeId, recipes)}`;
    case "branch":
      return `When ${step.input} ${step.operator.replace("-", " ")}${step.expected ? ` "${step.expected}"` : ""}, run ${titleize(step.thenRecipeId, recipes)}`;
    case "repeat":
      return `Repeat ${titleize(step.recipeId, recipes)} ${step.count} times`;
    case "script":
      return "Transform variables with safe script";
    case "clipboard":
      return step.action === "write"
        ? `Set clipboard to "${step.text ?? ""}"`
        : step.expect !== undefined
          ? `Check clipboard ${step.match === "contains" ? "contains" : "equals"} "${step.expect}"`
          : "Read clipboard";
    case "app":
      if (step.action === "switcher") return "Open app switcher";
      if (step.action === "inspect") return `Record ${step.app} version`;
      if (step.action === "assert-installed")
        return `Check ${step.app} is installed${step.version ? ` (${step.version})` : ""}`;
      if (step.action === "assert-not-installed") return `Check ${step.app} is not installed`;
      if (step.action === "install" || step.action === "update")
        return `${cap(step.action)} ${step.app} from APK`;
      if (step.action === "uninstall") return `Uninstall ${step.app}`;
      return `${cap(step.action)} ${step.app ?? step.url ?? "app"}`;
    case "device":
      return step.action === "keyboard-dismiss"
        ? "Dismiss keyboard"
        : step.action === "keyboard-enter"
          ? "Press keyboard Enter"
          : `${cap(step.action)} device`;
    case "rotate":
      return `Rotate to ${step.orientation.replaceAll("-", " ")}`;
    case "settings":
      return `Set ${step.setting} ${step.state}`;
    case "location":
      return `Set location to ${step.latitude}, ${step.longitude}`;
    case "permission":
      return `${cap(step.action)} ${step.permission} permission`;
    case "alert":
      return `${cap(step.action)} system alert`;
    case "network":
      return step.action === "dump"
        ? `Capture network ${step.include ?? "summary"}`
        : "Mark network log";
    case "logs":
      return `${cap(step.action)} device logs`;
  }
}

/** Is this step's own fields filled in enough to save/run? */
export function stepValid(step: RecipeStep): boolean {
  switch (step.kind) {
    case "tap":
    case "long-press":
    case "wait-for":
    case "wait-response":
    case "expect":
      return targetValid(step.target);
    case "extract":
      return targetValid(step.target) && step.as.trim().length > 0;
    case "assert-content":
      return step.input.trim().length > 0;
    case "evaluate-semantic":
      return step.input.trim().length > 0 && step.criteria.some((criterion) => criterion.trim());
    case "type":
      return step.text.trim().length > 0;
    case "sleep":
      return Number.isFinite(step.ms) && step.ms >= 0;
    case "pause":
      return step.message.trim().length > 0;
    case "flow":
      return step.flow.trim().length > 0;
    case "module":
      return step.recipeId.trim().length > 0;
    case "branch":
      return (
        step.input.trim().length > 0 &&
        step.thenRecipeId.trim().length > 0 &&
        (step.operator === "exists" || step.expected !== undefined)
      );
    case "repeat":
      return step.recipeId.trim().length > 0 && Number.isInteger(step.count) && step.count > 0;
    case "script":
      return step.source.trim().length > 0;
    case "clipboard":
      return step.action === "read" || step.text !== undefined;
    case "app": {
      if (step.action === "switcher") return true;
      if (step.action === "open") return Boolean(step.app?.trim() || step.url?.trim());
      if (!step.app?.trim()) return false;
      if (step.action === "install" || step.action === "update")
        return Boolean(step.artifact?.trim());
      return true;
    }
    case "location":
      return Number.isFinite(step.latitude) && Number.isFinite(step.longitude);
    case "scroll":
    case "key":
    case "swipe":
    case "screenshot":
    case "device":
    case "rotate":
    case "settings":
    case "permission":
    case "alert":
    case "network":
    case "logs":
      return true;
  }
}

/** Short "what's missing" message for an invalid step row, or null if valid. */
export function stepIssue(step: RecipeStep): string | null {
  if (stepValid(step)) return null;
  switch (step.kind) {
    case "tap":
    case "long-press":
    case "wait-for":
    case "wait-response":
    case "expect":
      return "Needs a target — a label, ref, text, or point.";
    case "extract":
      return "Needs a target and output variable name.";
    case "assert-content":
      return "Needs an extracted input variable.";
    case "evaluate-semantic":
      return "Needs an extracted input and at least one criterion.";
    case "type":
      return "Needs text to type.";
    case "sleep":
      return "Needs a wait duration.";
    case "pause":
      return "Needs instructions for the human.";
    case "flow":
      return "Needs a flow — pick one from the list.";
    case "module":
      return "Needs a reusable test.";
    case "branch":
      return "Needs an input, condition, and matching test.";
    case "repeat":
      return "Needs a reusable test and repeat count.";
    case "script":
      return "Needs at least one safe variable command.";
    case "clipboard":
      return "Needs clipboard text.";
    case "app":
      return step.action === "install" || step.action === "update"
        ? "Needs a package id and a local APK path."
        : "Needs an app id or deep link.";
    case "location":
      return "Needs valid latitude and longitude.";
    default:
      return "Invalid step.";
  }
}

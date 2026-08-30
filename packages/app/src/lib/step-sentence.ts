/**
 * The one sentence formatter for a RecipeStep (plan: run-pane authoring
 * rebuild, M5 polish). Sentence case, quotes around labels/text, no
 * duplicated kind info — shared by the step rows, the recorder's status
 * strip, and anywhere else a step needs a human-readable line.
 */
import type { RecipeStep, StepTarget } from "./api-types";
import { targetValid } from "./step-target";
import { identifierControlPhrase } from "./humanize-identifier";
import { titleize, type TitledId } from "./job";

function savedTestTitle(id: string, known?: Iterable<TitledId>): string {
  if (known) {
    for (const recipe of known) {
      if (recipe.id === id) return recipe.title;
    }
  }
  // Frozen recipe identities frequently contain map IDs, compiler node kinds,
  // and revisions. They are valuable evidence, but not useful action copy.
  return "saved Test";
}

function targetPhrase(t: StepTarget | undefined): string {
  if (!t) return "an element";
  if (t.label) return `"${t.label}"`;
  if (t.text) return `"${t.text}"`;
  // An identifier is a build-time handle, so show the words inside it and drop
  // the raw token. Unquoted, because it is not text anyone can read on screen.
  const named = identifierControlPhrase(t.identifier);
  if (named) return named;
  // Refs and coordinates are runner internals — never surface them in copy.
  if (t.ref && t.point) return "the recorded control";
  if (t.ref) return "the recorded element";
  if (t.point) return "the screen";
  return "an element";
}

/** Turn ${var.name} / camelCase tokens into plain words for body copy. */
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

function recordedTargetPhrase(step: Extract<RecipeStep, { kind: "tap" }>): string {
  const evidenceNodes = [step.evidence?.node, ...(step.evidence?.ancestors ?? [])].filter(
    (node): node is NonNullable<typeof node> => Boolean(node),
  );
  const byRef = evidenceNodes.find(
    (node) => step.target.ref && node.ref && node.ref === step.target.ref,
  );
  // Physical iOS often records a point with no durable ref. Prefer any named
  // accessibility node captured with the gesture over raw coordinates.
  const named =
    byRef ?? evidenceNodes.find((node) => (node.label ?? node.value ?? "").trim()) ?? undefined;
  const visibleName = (
    named?.label ??
    named?.value ??
    step.target.label ??
    step.target.text ??
    ""
  ).trim();
  if (visibleName) return `"${visibleName}"`;
  const fromIdentifier = identifierControlPhrase(step.target.identifier);
  if (fromIdentifier) return fromIdentifier;
  // Element references are useful to the runner but meaningless in the plan.
  if (step.target.ref && step.target.point) return "the recorded control";
  if (step.target.ref) return "the recorded element";
  if (step.target.point) return "the screen";
  return targetPhrase(step.target);
}

function swipeDirection(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return "slightly";
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
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
      return `${step.gesture === "multi" ? `${step.tapCount ?? 2} taps` : step.gesture === "hold" ? "Hold" : "Tap"} ${recordedTargetPhrase(step)}`;
    case "type":
      return step.text.trim()
        ? `${step.mode === "replace" ? "Replace with" : "Type"} "${step.text}"`
        : step.mode === "replace"
          ? "Clear text"
          : "Type text";
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
    case "expect-set":
      return `Check options${step.scope ? ` within ${targetPhrase(step.scope)}` : ""} are exactly ${step.labels.map((label) => `“${label}”`).join(", ")}`;
    case "expect-screen":
      return `Reach ${step.screenTitle}`;
    case "tour":
      return step.originTitle
        ? `Tour ${step.originTitle} rows${step.depth ? ` depth ${step.depth}` : ""}`
        : step.depth
          ? `Tour visible rows depth ${step.depth}`
          : "Tour visible rows";
    case "extract":
      return `Extract ${targetPhrase(step.target)} as ${humanInput(step.as)}`;
    case "assert-content":
      return `Check ${humanInput(step.input)} ${step.match.replace("-", " ")} "${step.expected}"`;
    case "evaluate-semantic":
      return `Evaluate ${humanInput(step.input)} against ${step.criteria.length} criterion${step.criteria.length === 1 ? "" : "s"}`;
    case "sleep":
      return `Wait ${fmtDuration(step.ms)}`;
    case "pause":
      // Keep the action explicit: this is a deliberate handoff, not a sleep.
      return step.message.trim() ? `Wait for you: ${step.message}` : "Wait for your input";
    case "review":
      return `Needs review: ${step.capability}`;
    case "key":
      return `Press ${step.key === "back" ? "Back" : "Home"}`;
    case "scroll":
      return `Scroll ${cap(step.direction)}${step.amount === 1 ? " · full screen" : ""}`;
    case "reveal":
      return `Reveal ${targetPhrase(step.target)}`;
    case "swipe":
      return `Swipe ${swipeDirection(step.from, step.to)}`;
    case "screenshot":
      return step.caption ? `Screenshot · ${step.caption}` : "Screenshot";
    case "capture-surface":
      return `Capture full surface · ${step.screenTitle}`;
    case "flow":
      // Human title only — "Built-in:" was opaque jargon in the step list.
      return titleize(step.flow, recipes);
    case "module":
      return `Run ${savedTestTitle(step.recipeId, recipes)}`;
    case "branch":
      return `When ${humanInput(step.input)} ${step.operator.replace("-", " ")}${step.expected ? ` "${step.expected}"` : ""}, run ${savedTestTitle(step.thenRecipeId, recipes)}`;
    case "repeat":
      return `Repeat ${savedTestTitle(step.recipeId, recipes)} ${step.count} times`;
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
    case "wait-for":
    case "wait-response":
    case "expect":
      return targetValid(step.target);
    case "expect-set":
      return (
        (Boolean(step.identifierPrefix?.trim()) ||
          Boolean(
            step.scope &&
            (step.scope.identifier || step.scope.ref || step.scope.label || step.scope.text),
          )) &&
        step.labels.some((label) => label.trim())
      );
    case "expect-screen":
      return Boolean(step.screenId.trim() && step.screenTitle.trim() && step.fingerprint.trim());
    case "tour":
      return true;
    case "extract":
      return targetValid(step.target) && step.as.trim().length > 0;
    case "assert-content":
      return step.input.trim().length > 0;
    case "evaluate-semantic":
      return step.input.trim().length > 0 && step.criteria.some((criterion) => criterion.trim());
    case "type":
      return step.mode === "replace" ? targetValid(step.target ?? {}) : step.text.trim().length > 0;
    case "sleep":
      return Number.isFinite(step.ms) && step.ms >= 0;
    case "pause":
      return step.message.trim().length > 0;
    case "review":
      return step.capability.trim().length > 0 && step.reason.trim().length > 0;
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
    case "reveal":
    case "key":
    case "swipe":
    case "screenshot":
    case "capture-surface":
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
    case "wait-for":
    case "wait-response":
    case "expect":
      return "Needs a target — a label, ref, text, or point.";
    case "expect-set":
      return "Needs an identifier prefix or container scope and at least one expected option.";
    case "expect-screen":
      return "Needs an expected screen identity.";
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
    case "review":
      return "Needs a capability and a reason for the deferred check.";
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

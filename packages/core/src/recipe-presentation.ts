/**
 * Human-readable recipe step titles and trace glyphs.
 */
import type { RecipeStep, StepTarget } from "@relay/protocol";
import type { Glyph } from "./trace.js";

export function describeTarget(t: StepTarget): string {
  if (t.identifier) return `identifier ${t.identifier}`;
  if (t.ref) return `ref ${t.ref}`;
  if (t.label) return `${t.role ? `${t.role} ` : ""}label "${t.label}"`;
  if (t.text) return `text "${t.text}"`;
  if (t.point?.relativeTo) {
    return `point inside ${describeTarget(t.point.relativeTo.target)}`;
  }
  if (t.point) return `point (${t.point.x}, ${t.point.y})`;
  return "<empty>";
}

/**
 * Sentence-style target description for `expect` steps: bare quoted label
 * (no "label" prefix), but "text ..." kept for text-contains targets, e.g.
 * `check "Sign in" visible` / `check text "Welcome" gone`.
 */
function describeExpectTarget(t: StepTarget): string {
  if (t.label) return `"${t.label}"`;
  if (t.text) return `text "${t.text}"`;
  return describeTarget(t);
}

/** Direction arrow for a swipe's dominant axis: ↓ ↑ → ← ↘ etc. */
function arrowForSwipe(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "↓" : "↑";
  return dx >= 0 ? "→" : "←";
}

/** Human-readable one-line title for a step (trace + log surface). */
export function describeRecipeStep(step: RecipeStep): string {
  switch (step.kind) {
    case "tap":
      return `${step.gesture === "multi" ? `${step.tapCount ?? 2} taps` : step.gesture === "hold" ? "Hold" : "Tap"} ${describeTarget(step.target)}`;
    case "type":
      return step.target ? `Type into ${describeTarget(step.target)}` : "Type text";
    case "scroll":
      return `Scroll ${step.direction}`;
    case "swipe":
      return `swipe ${arrowForSwipe(step.from, step.to)} ${Math.round(step.from.x)},${Math.round(step.from.y)} → ${Math.round(step.to.x)},${Math.round(step.to.y)}`;
    case "key":
      return `Key: ${step.key}`;
    case "sleep":
      return `Sleep ${step.ms}ms`;
    case "wait-for":
      return `Wait for ${describeTarget(step.target)}`;
    case "wait-response":
      return `Wait for ${describeTarget(step.target)} to finish responding`;
    case "expect":
      return `check ${describeExpectTarget(step.target)} ${step.condition}`;
    case "expect-set":
      return `Check options are exactly ${step.labels.join(", ")}`;
    case "expect-screen":
      return `Reach ${step.screenTitle}`;
    case "extract":
      return `Extract ${describeTarget(step.target)} as ${step.as}`;
    case "assert-content":
      return `Check ${step.input} ${step.match} ${JSON.stringify(step.expected)}`;
    case "evaluate-semantic":
      return `Evaluate ${step.input} against ${step.criteria.length} criterion${step.criteria.length === 1 ? "" : "s"}`;
    case "pause":
      return step.reason
        ? `Wait for human (${step.reason}): ${step.message}`
        : `Pause: ${step.message}`;
    case "review":
      return `Needs review · ${step.capability}`;
    case "screenshot":
      return step.caption ? `Screenshot · ${step.caption}` : "Screenshot";
    case "capture-surface":
      return `Capture full surface · ${step.screenTitle}`;
    case "tour":
      return step.originTitle
        ? `Tour ${step.originTitle} rows${step.depth ? ` depth ${step.depth}` : ""}`
        : `Tour visible rows${step.depth ? ` depth ${step.depth}` : ""}`;
    case "flow":
      return `Flow: ${step.flow}`;
    case "module":
      return `Run reusable test: ${step.recipeId}`;
    case "branch":
      return `Branch when ${step.input} ${step.operator}${step.expected ? ` ${JSON.stringify(step.expected)}` : ""}`;
    case "repeat":
      return `Repeat ${step.recipeId} ${step.count}×`;
    case "script":
      return "Transform test variables";
    case "clipboard":
      return step.action === "write"
        ? "Set clipboard text"
        : step.expect !== undefined
          ? "Check clipboard text"
          : "Read clipboard text";
    case "app":
      if (step.action === "set-locale") return `Set ${step.app} language to ${step.locale}`;
      if (step.action === "switcher") return "Open app switcher";
      if (step.action === "inspect") return `Record installed version of ${step.app}`;
      if (step.action === "assert-installed")
        return `Check ${step.app} is installed${step.version ? ` (${step.version})` : ""}`;
      if (step.action === "assert-not-installed") return `Check ${step.app} is not installed`;
      if (step.action === "install" || step.action === "update")
        return `${step.action === "install" ? "Install" : "Update"} ${step.app} from APK`;
      if (step.action === "uninstall") return `Uninstall ${step.app}`;
      return `${step.action === "open" ? "Open" : "Close"} ${step.app ?? step.url ?? "app"}`;
    case "device":
      return step.action === "keyboard-dismiss"
        ? "Dismiss keyboard"
        : step.action === "keyboard-enter"
          ? "Press keyboard Enter"
          : `${step.action === "lock" ? "Lock" : "Unlock"} device`;
    case "rotate":
      return `Rotate ${step.orientation}`;
    case "settings":
      return `Set ${step.setting} ${step.state}`;
    case "location":
      return `Set location ${step.latitude}, ${step.longitude}`;
    case "permission":
      return `${step.action} ${step.permission} permission`;
    case "alert":
      return `${step.action} system alert`;
    case "network":
      return step.action === "dump"
        ? `Capture network ${step.include ?? "summary"}`
        : "Mark network log";
    case "logs":
      return `${step.action} device logs`;
    default: {
      const kind = (step as { kind?: string }).kind ?? "unknown";
      throw new Error(`unsupported recipe step: ${kind}`);
    }
  }
}

/** Trace glyphs for a step (meta-row chrome). */
export function glyphsForStep(step: RecipeStep): Glyph[] {
  switch (step.kind) {
    case "tap":
      return ["tap"];
    case "type":
      return ["type"];
    case "scroll":
      return ["swipe"];
    case "swipe":
      return ["swipe"];
    case "key":
      return ["tap"];
    case "sleep":
      return ["wait"];
    case "wait-for":
      return ["wait"];
    case "wait-response":
      return ["ai", "wait"];
    case "expect":
    case "expect-set":
      return ["ok"];
    case "expect-screen":
      return ["ok"];
    case "extract":
      return ["store"];
    case "assert-content":
    case "evaluate-semantic":
      return ["ai", "ok"];
    case "pause":
    case "review":
      return ["wait"];
    case "screenshot":
      return ["shot"];
    case "capture-surface":
      return ["swipe", "shot", "store"];
    case "tour":
      return ["tap", "shot"];
    case "flow":
      return ["store"];
    case "module":
      return ["re", "store"];
    case "branch":
      return ["re", "ai"];
    case "repeat":
      return ["re", "wait"];
    case "script":
      return ["type", "store"];
    case "clipboard":
      return ["type"];
    case "app":
      return ["tap"];
    case "device":
    case "rotate":
    case "settings":
    case "location":
    case "permission":
    case "alert":
      return ["tap"];
    case "network":
    case "logs":
      return ["store"];
    default: {
      const kind = (step as { kind?: string }).kind ?? "unknown";
      throw new Error(`unsupported recipe step: ${kind}`);
    }
  }
}

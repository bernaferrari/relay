import type { RecipeStep, RecordedStepEvidence } from "../context/server";
import type { IconName } from "./icon";

/** Visual semantics shared by Take review and run presentation. */

export function evidenceForStep(step?: RecipeStep): RecordedStepEvidence | undefined {
  return step?.evidence;
}

export function accentForStep(step: RecipeStep): string {
  if (step.kind === "expect" || step.kind === "assert-content") return "var(--step-accent-expect)";
  if (step.kind === "type" || step.kind === "clipboard") return "var(--step-accent-type)";
  if (step.kind === "screenshot" || step.kind === "extract") return "var(--step-accent-capture)";
  if (step.kind === "sleep" || step.kind === "wait-for" || step.kind === "wait-response")
    return "var(--step-accent-wait)";
  if (step.kind === "app" || step.kind === "module" || step.kind === "flow")
    return "var(--step-accent-flow)";
  return "var(--step-accent-default)";
}

export function iconForStep(step: RecipeStep): IconName {
  if (step.kind === "type") return "keyboard";
  if (step.kind === "screenshot") return "camera";
  if (step.kind === "sleep" || step.kind === "wait-for" || step.kind === "wait-response")
    return "clock";
  if (step.kind === "swipe" || step.kind === "scroll") return "move";
  if (step.kind === "expect") return "check";
  if (step.kind === "extract") return "download";
  if (step.kind === "assert-content" || step.kind === "evaluate-semantic") return "check";
  return "pointer";
}

export function actionForStep(step: RecipeStep): string {
  if (step.kind === "expect") return "Validate";
  if (step.kind === "extract") return "Extract";
  if (step.kind === "assert-content" || step.kind === "evaluate-semantic") return "Evaluate";
  if (step.kind === "type") return "Type value";
  if (step.kind === "tap") return "Interact";
  if (step.kind === "scroll" || step.kind === "swipe" || step.kind === "key") return "Navigate";
  if (step.kind === "screenshot") return "Capture";
  if (step.kind === "sleep" || step.kind === "wait-for" || step.kind === "wait-response")
    return "Wait";
  return "Continue";
}

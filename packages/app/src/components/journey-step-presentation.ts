import type { RecipeStep, RecordedStepEvidence } from "../context/server";
import type { IconName } from "./icon";

export function evidenceForStep(step?: RecipeStep): RecordedStepEvidence | undefined {
  return step?.evidence;
}

export function accentForStep(step: RecipeStep): string {
  if (step.kind === "expect" || step.kind === "assert-content") return "#35c89f";
  if (step.kind === "type" || step.kind === "clipboard") return "#5ea7ff";
  if (step.kind === "screenshot" || step.kind === "extract") return "#e985be";
  if (step.kind === "sleep" || step.kind === "wait-for" || step.kind === "wait-response")
    return "#f2b65d";
  if (step.kind === "app" || step.kind === "module" || step.kind === "flow") return "#a67cff";
  return "#8068f2";
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

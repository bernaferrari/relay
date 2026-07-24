import type { RecipeStep } from "./api-types";

let fallbackSequence = 0;

/**
 * A durable editing identity. It intentionally carries no execution meaning;
 * it lets the editor keep selection, history, and recorded context attached
 * when rows are inserted, deleted, or reordered.
 */
export function createStepId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `step-${random.replaceAll("-", "")}`;
  fallbackSequence += 1;
  return `step-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
}

export function ensureStepId(step: RecipeStep): RecipeStep {
  return step.id ? step : { ...step, id: createStepId() };
}

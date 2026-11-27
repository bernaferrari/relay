import { MAX_WAIT_MS } from "./recipe-validation-primitives.js";

export const RECIPE_WAIT_DEFAULT_MS = 8_000;
export const RECIPE_WAIT_SLICE_MS = 800;
export const RECIPE_TRANSIENT_PRESENCE_DRAIN_MS = 45_000;
export const RECIPE_TRANSIENT_PRESENCE_SLEEP_MS = 2_000;
export const STILL_SCREEN_NEXT_HINT =
  "Unchanged pixels are diagnostic, not a reason to stop waiting. Inspect the last screenshot after the authored timeout; raise timeoutMs only if the condition is still expected.";

export class TargetVisibleWaitTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetVisibleWaitTimeoutError";
  }
}

export function boundRecipeWaitMs(
  timeoutMs: number | undefined,
  fallback = RECIPE_WAIT_DEFAULT_MS,
): number {
  return Math.min(timeoutMs ?? fallback, MAX_WAIT_MS);
}

export function stillScreenUnchanged(
  previous: string | undefined,
  next: string | undefined,
): boolean {
  return Boolean(previous && next && previous === next);
}

export function stillScreenTimeoutMessage(input: {
  kind: "wait-for" | "expect" | "expect-screen" | "wait-response";
  expected: string;
  observed?: string;
  elapsedMs: number;
  timeoutMs: number;
  pixelsUnchanged?: boolean;
}): string {
  const next = `Next: ${STILL_SCREEN_NEXT_HINT}`;
  const still =
    input.pixelsUnchanged === true ? ` (pixels unchanged for ${input.elapsedMs}ms)` : "";
  if (input.kind === "expect-screen") {
    return `expect-screen: on “${input.observed ?? "unknown"}”, not “${input.expected}” after ${input.timeoutMs}ms${still}. ${next}`;
  }
  return `${input.kind}: timed out waiting for ${input.expected} (${input.timeoutMs}ms)${still}. ${next}`;
}

export const stillScreenAbortMessage = stillScreenTimeoutMessage;

export type WaitForReadinessTiming = {
  destWaitMs: number;
  runnerRecoverMs: number;
  productReadyMs: number;
};

export function attachWaitForReadiness(error: unknown, timing: WaitForReadinessTiming): unknown {
  if (!error || typeof error !== "object") return error;
  try {
    Object.defineProperty(error, "iosReadiness", {
      configurable: true,
      enumerable: true,
      value: { ...timing },
    });
  } catch {
    // Frozen errors keep their original identity.
  }
  return error;
}

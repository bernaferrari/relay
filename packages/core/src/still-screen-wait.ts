import { cooperativeCheckpoint } from "./control.js";
import type { Device } from "./device.js";
import { MAX_WAIT_MS } from "./recipe-validation-primitives.js";
import { observeVisualScreenFingerprint } from "./screen-identity.js";
import { captureScreenshot, cleanupScreenshot } from "./workspace-capture.js";

/** Default `wait-for` budget when a recipe omits timeoutMs. */
export const RECIPE_WAIT_DEFAULT_MS = 8_000;
/** Slice so UiAutomation is never owned for the full authored timeout. */
export const RECIPE_WAIT_SLICE_MS = 800;
/** XCTest returns RUNNER_BUSY immediately; abandoned AX can take this long to drain. */
export const RECIPE_TRANSIENT_PRESENCE_DRAIN_MS = 45_000;
/** Back off without queueing another XCTest command behind abandoned work. */
export const RECIPE_TRANSIENT_PRESENCE_SLEEP_MS = 2_000;
export const STILL_SCREEN_NEXT_HINT =
  "Unchanged pixels are diagnostic, not a reason to stop waiting. Inspect the last screenshot after the authored timeout; raise timeoutMs only if the condition is still expected.";

/** Only the wait loop spending its condition budget is an assertion timeout. */
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

/** @deprecated Use stillScreenTimeoutMessage. Kept for callers that still report a timeout. */
export const stillScreenAbortMessage = stillScreenTimeoutMessage;

export async function captureStillScreenFingerprint(device: Device): Promise<string | undefined> {
  try {
    const shot = await captureScreenshot({
      device,
      ephemeral: true,
      includeScreenMatch: false,
    });
    try {
      return (
        shot.screenMatch?.visualFingerprint ??
        observeVisualScreenFingerprint(Buffer.from(shot.base64, "base64"))
      );
    } finally {
      await cleanupScreenshot(shot.path);
    }
  } catch {
    return undefined;
  }
}

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

export async function waitForTargetVisible(input: {
  present: () => Promise<boolean>;
  captureFingerprint: () => Promise<string | undefined>;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs: number;
  kind: "wait-for" | "expect";
  expected: string;
  log?: (message: string) => void;
  /** Runner-busy / similar: wait for drain instead of failing the check. */
  isTransientPresenceError?: (error: unknown) => boolean;
  transientBudgetMs?: number;
  transientSleepMs?: number;
}): Promise<WaitForReadinessTiming> {
  const now = input.now ?? Date.now;
  const timeoutMs = Math.max(0, input.timeoutMs);
  const transientBudgetMs = Math.max(0, input.transientBudgetMs ?? 0);
  const transientSleepMs = input.transientSleepMs ?? RECIPE_TRANSIENT_PRESENCE_SLEEP_MS;
  let destWaitMs = 0;
  let runnerRecoverMs = 0;
  let mark = now();
  let previous: string | undefined;
  let sawUnchangedPixels = false;
  let lastTransient: unknown;

  const charge = (bucket: "dest" | "recover") => {
    const t = now();
    const dt = Math.max(0, t - mark);
    mark = t;
    if (bucket === "recover") runnerRecoverMs += dt;
    else destWaitMs += dt;
  };

  const probe = async (): Promise<boolean | "busy"> => {
    try {
      return await input.present();
    } catch (error) {
      if (input.isTransientPresenceError?.(error) !== true) throw error;
      lastTransient = error;
      return "busy";
    }
  };

  while (true) {
    await cooperativeCheckpoint();
    const result = await probe();
    if (result === true) {
      charge("dest");
      return { destWaitMs, runnerRecoverMs, productReadyMs: destWaitMs };
    }
    if (result === "busy") {
      charge("recover");
      if (runnerRecoverMs >= transientBudgetMs) break;
      input.log?.(
        `${input.kind}: runner still finishing a previous command after ${runnerRecoverMs}ms waiting for ${input.expected}`,
      );
      const remaining = transientBudgetMs - runnerRecoverMs;
      await input.sleep(Math.min(transientSleepMs, Math.max(1, remaining)));
      charge("recover");
      continue;
    }
    charge("dest");
    if (destWaitMs >= timeoutMs) break;
    const fingerprint = await input.captureFingerprint();
    charge("dest");
    if (stillScreenUnchanged(previous, fingerprint)) {
      sawUnchangedPixels = true;
      input.log?.(
        `${input.kind}: pixels unchanged after ${destWaitMs}ms waiting for ${input.expected}`,
      );
    }
    previous = fingerprint ?? previous;
    const remaining = timeoutMs - destWaitMs;
    if (remaining <= 0) break;
    input.log?.(`${input.kind}: still waiting for ${input.expected} · ${destWaitMs}ms`);
    await input.sleep(Math.min(RECIPE_WAIT_SLICE_MS, remaining));
    charge("dest");
    if (destWaitMs >= timeoutMs) break;
  }

  if (
    lastTransient !== undefined &&
    runnerRecoverMs >= transientBudgetMs &&
    destWaitMs < timeoutMs
  ) {
    throw attachWaitForReadiness(
      lastTransient instanceof Error ? lastTransient : new Error(String(lastTransient)),
      { destWaitMs, runnerRecoverMs, productReadyMs: 0 },
    );
  }
  throw attachWaitForReadiness(
    new TargetVisibleWaitTimeoutError(
      stillScreenTimeoutMessage({
        kind: input.kind,
        expected: input.expected,
        elapsedMs: destWaitMs,
        timeoutMs: input.timeoutMs,
        pixelsUnchanged: sawUnchangedPixels,
      }),
    ),
    { destWaitMs, runnerRecoverMs, productReadyMs: 0 },
  );
}

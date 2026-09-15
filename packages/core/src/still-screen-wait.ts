import { cooperativeCheckpoint } from "./control.js";
import type { Device } from "./device.js";
import { MAX_WAIT_MS } from "./recipe-validation-primitives.js";
import { observeVisualScreenFingerprint } from "./screen-identity.js";
import { captureScreenshot, cleanupScreenshot } from "./workspace-capture.js";

/** Default `wait-for` budget when a recipe omits timeoutMs. */
export const RECIPE_WAIT_DEFAULT_MS = 8_000;
/** Slice so UiAutomation is never owned for the full authored timeout. */
export const RECIPE_WAIT_SLICE_MS = 800;
export const STILL_SCREEN_NEXT_HINT =
  "Screenshot + interact (label or point). Do not retry wait-for, expect-screen, or test run on an unchanged screen.";

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

export function stillScreenAbortMessage(input: {
  kind: "wait-for" | "expect" | "expect-screen" | "wait-response";
  expected: string;
  observed?: string;
  elapsedMs: number;
  timeoutMs: number;
}): string {
  const next = `Next: ${STILL_SCREEN_NEXT_HINT}`;
  if (input.kind === "expect-screen") {
    return `expect-screen: on “${input.observed ?? "unknown"}”, not “${input.expected}” (pixels unchanged after ${input.elapsedMs}ms). ${next}`;
  }
  return `${input.kind}: timed out waiting for ${input.expected} (pixels unchanged after ${input.elapsedMs}ms; budget ${input.timeoutMs}ms). ${next}`;
}

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

export async function waitForTargetVisible(input: {
  present: () => Promise<boolean>;
  captureFingerprint: () => Promise<string | undefined>;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs: number;
  kind: "wait-for" | "expect";
  expected: string;
  log?: (message: string) => void;
}): Promise<void> {
  const now = input.now ?? Date.now;
  const began = now();
  const deadline = began + Math.max(0, input.timeoutMs);
  let previous: string | undefined;
  if (await input.present()) return;
  while (now() < deadline) {
    await cooperativeCheckpoint();
    const fingerprint = await input.captureFingerprint();
    if (stillScreenUnchanged(previous, fingerprint)) {
      const elapsedMs = now() - began;
      input.log?.(
        `${input.kind}: pixels unchanged after ${elapsedMs}ms waiting for ${input.expected}`,
      );
      throw new Error(
        stillScreenAbortMessage({
          kind: input.kind,
          expected: input.expected,
          elapsedMs,
          timeoutMs: input.timeoutMs,
        }),
      );
    }
    previous = fingerprint ?? previous;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    input.log?.(`${input.kind}: still waiting for ${input.expected} · ${now() - began}ms`);
    await input.sleep(Math.min(RECIPE_WAIT_SLICE_MS, remaining));
    if (await input.present()) return;
  }
  throw new Error(
    `${input.kind}: timed out waiting for ${input.expected} (${input.timeoutMs}ms). Next: ${STILL_SCREEN_NEXT_HINT}`,
  );
}

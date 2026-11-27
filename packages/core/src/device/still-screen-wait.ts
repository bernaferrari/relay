import { cooperativeCheckpoint } from "../execution/control.js";
import type { Device } from "./device.js";
import {
  attachWaitForReadiness,
  RECIPE_TRANSIENT_PRESENCE_SLEEP_MS,
  RECIPE_WAIT_SLICE_MS,
  stillScreenTimeoutMessage,
  stillScreenUnchanged,
  TargetVisibleWaitTimeoutError,
  type WaitForReadinessTiming,
} from "../recipe/recipe-wait-policy.js";
import { observeVisualScreenFingerprint } from "../screen/screen-identity.js";
import { captureScreenshot, cleanupScreenshot } from "../workspace/workspace-capture.js";
import { unknownText } from "../unknown-text.js";

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
      lastTransient instanceof Error ? lastTransient : new Error(unknownText(lastTransient)),
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

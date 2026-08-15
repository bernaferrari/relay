import { describeSnapshotChrome } from "@relay/protocol";
import type { Device } from "./device.js";
import { pressKey, pressLabel, scrollUp, sleep, snapshot, type SnapshotNode } from "./device.js";
import { now } from "./events.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import {
  handoffShellIdentityMatch,
  resilientScreenIdentityMatch,
} from "./recipe-runner-support.js";
import { screenIdentityMatches } from "./recipe-target-match.js";
import { foregroundApplicationBundle } from "./recipe-runner-tour-matching.js";
import type { RecipeStep } from "./recipes.js";
import {
  compareScreenIdentity,
  observeScreenIdentity,
  observeVisualScreenFingerprint,
} from "./screen-identity.js";
import { captureScreenshot } from "./workspace.js";

const DEFAULT_EXPECT_TIMEOUT_MS = 5_000;
const MAX_WAIT_MS = 15 * 60 * 1_000;

export async function captureRecipeScreenshot(
  device: Device,
  caption: string | undefined,
  ctx: RecipeStepContext,
): Promise<void> {
  const verified = ctx.runtime?.verifiedScreen;
  const observation = ctx.runtime?.observation;
  const screenshot = await captureScreenshot({
    jobId: ctx.job?.id,
    caption,
    device,
    ...(observation?.nodes ? { semanticNodes: observation.nodes } : {}),
  });
  if (observation) observation.screenshot = screenshot;
  if (verified) verified.screenshot = screenshot;
}

export async function runExpectScreenStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const priorObservation = ctx.runtime?.observation;
  if (ctx.runtime) {
    ctx.runtime.observation = undefined;
    ctx.runtime.verifiedScreen = undefined;
  }
  const expected = new Set([step.fingerprint, ...(step.aliases ?? [])]);
  const recoveryMaxAttempts =
    step.recovery?.strategy === "back" ? (step.recovery.maxAttempts ?? 6) : 0;
  let parentViewportRecoveryAttempts =
    step.recovery?.strategy === "back" && step.recovery.restoreParentViewport === true ? 2 : 0;
  const timeout = Math.min(
    Math.max(
      step.timeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS,
      recoveryMaxAttempts ? recoveryMaxAttempts * 2_500 : 0,
    ),
    MAX_WAIT_MS,
  );
  const deadline = Date.now() + timeout;
  let recoveryAttempts = recoveryMaxAttempts;
  let observedTitle = "unknown";
  let reached = false;
  let verifiedNodes: SnapshotNode[] | undefined;
  let verifiedObservedAt: number | undefined;
  let verifiedScreenshot: Awaited<ReturnType<typeof captureScreenshot>> | undefined;
  let firstAttempt = true;
  do {
    // A recovery mutation makes pixels from the preceding attempt stale.
    const reusable = firstAttempt ? priorObservation : undefined;
    firstAttempt = false;
    verifiedScreenshot = reusable?.screenshot;
    let nodes: SnapshotNode[] = [];
    if (reusable?.nodes) {
      nodes = reusable.nodes;
    } else {
      try {
        nodes = await snapshot(device);
      } catch {
        nodes = [];
      }
    }
    const observedAt = reusable?.observedAt ?? now();
    const chrome = describeSnapshotChrome(nodes);
    observedTitle = chrome.header ?? chrome.app ?? "unknown";
    const observed = observeScreenIdentity(nodes);
    const semanticMatch = (step.observations ?? []).some(
      (observation) => compareScreenIdentity(observed, observation).decision === "match",
    );
    const resilientMatch = resilientScreenIdentityMatch(observed, step.observations ?? [], ctx.job);
    const handoffShellMatch =
      Boolean(step.expectedApp) &&
      foregroundApplicationBundle(nodes) === step.expectedApp &&
      handoffShellIdentityMatch(observed, step.observations ?? []);
    if (
      screenIdentityMatches(expected, observed.fingerprint) ||
      semanticMatch ||
      resilientMatch ||
      handoffShellMatch
    ) {
      reached = true;
      verifiedNodes = nodes;
      verifiedObservedAt = observedAt;
      break;
    }

    let visualFingerprint: string | undefined;
    if (verifiedScreenshot) {
      visualFingerprint = observeVisualScreenFingerprint(
        Buffer.from(verifiedScreenshot.base64, "base64"),
      );
    } else if (ctx.observeVisualFingerprint) {
      visualFingerprint = await ctx.observeVisualFingerprint();
    } else {
      verifiedScreenshot = await captureScreenshot({
        device,
        caption: `Verify ${step.screenTitle}`,
        ephemeral: true,
        includeScreenMatch: false,
      });
      visualFingerprint = observeVisualScreenFingerprint(
        Buffer.from(verifiedScreenshot.base64, "base64"),
      );
    }
    if (screenIdentityMatches(expected, observed.fingerprint, visualFingerprint)) {
      reached = true;
      verifiedNodes = nodes;
      verifiedObservedAt = observedAt;
      break;
    }
    if (recoveryAttempts < recoveryMaxAttempts && parentViewportRecoveryAttempts > 0) {
      const attempt = 3 - parentViewportRecoveryAttempts;
      parentViewportRecoveryAttempts -= 1;
      ctx.log(`screen: restoring parent list viewport (${attempt})`);
      try {
        await scrollUp(device, 0.7);
        await sleep(350, device);
      } catch {
        // Explicit Back remains available when the adapter cannot scroll.
      }
      continue;
    }
    if (recoveryAttempts > 0) {
      const attempt = recoveryMaxAttempts - recoveryAttempts + 1;
      recoveryAttempts -= 1;
      ctx.log(`screen: not ${step.screenTitle} yet — recovering with Back (${attempt})`);
      try {
        await pressLabel(device, "Back");
      } catch {
        await pressKey(device, "back");
      }
      await sleep(350, device);
      continue;
    }
    if (Date.now() < deadline) await sleep(Math.min(400, deadline - Date.now()), device);
  } while (Date.now() < deadline);

  if (!reached) {
    throw new Error(`expect-screen: on “${observedTitle}”, not “${step.screenTitle}”`);
  }
  if (verifiedNodes && ctx.runtime) {
    const checkpoint = {
      screenId: step.screenId,
      screenTitle: step.screenTitle,
      nodes: verifiedNodes,
      observedAt: verifiedObservedAt ?? now(),
      verifiedAt: now(),
      ...(verifiedScreenshot ? { screenshot: verifiedScreenshot } : {}),
    };
    ctx.runtime.observation = checkpoint;
    ctx.runtime.verifiedScreen = checkpoint;
  }
  ctx.log(`screen: reached ${step.screenTitle}`);
}

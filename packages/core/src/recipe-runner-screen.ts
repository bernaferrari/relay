import { describeSnapshotChrome } from "@relay/protocol";
import type { Device } from "./device.js";
import { pressKey, pressLabel, scrollUp, sleep, snapshot, type SnapshotNode } from "./device.js";
import { now } from "./events.js";
import type { FreshDeviceObservation, RecipeStepContext } from "./recipe-runner-context.js";
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
import { attachScreenshotPayload, captureScreenshot } from "./workspace-capture.js";

const DEFAULT_EXPECT_TIMEOUT_MS = 5_000;
const MAX_WAIT_MS = 15 * 60 * 1_000;

export async function captureRecipeScreenshot(
  device: Device,
  caption: string | undefined,
  ctx: RecipeStepContext,
): Promise<void> {
  const verified = ctx.runtime?.verifiedScreen;
  const observation = ctx.runtime?.observation;
  const retained = observation?.screenshot ?? verified?.screenshot;
  if (retained) {
    await attachScreenshotPayload(
      retained,
      ctx.job?.id,
      caption ?? `screenshot · ${new Date().toISOString()}`,
    );
    if (observation) observation.screenshot = retained;
    if (verified) verified.screenshot = retained;
    return;
  }
  const screenshot = await captureScreenshot({
    jobId: ctx.job?.id,
    caption,
    device,
    ...(observation?.nodes ? { semanticNodes: observation.nodes } : {}),
  });
  if (observation) observation.screenshot = screenshot;
  if (verified) verified.screenshot = screenshot;
}

type ExpectScreenDependencies = {
  captureScreenshot?: typeof captureScreenshot;
};

function ownsAndroidDestinationEvidence(
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
  ctx: RecipeStepContext,
): boolean {
  return (
    ctx.job?.platform === "android" &&
    ctx.job.targetKind !== "browser" &&
    !step.id?.startsWith("relay-source-") &&
    !step.id?.endsWith(":warm")
  );
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "JobCancelledError";
}

async function observeDestinationAttempt(
  device: Device,
  reusable: FreshDeviceObservation | undefined,
  captureRaster: (() => Promise<Awaited<ReturnType<typeof captureScreenshot>>>) | undefined,
): Promise<{
  nodes: SnapshotNode[];
  observedAt: number;
  screenshot?: Awaited<ReturnType<typeof captureScreenshot>>;
}> {
  const raster = captureRaster?.().then(
    (screenshot) => ({ screenshot }),
    (error: unknown) => ({ error }),
  );
  const semantics = (reusable?.nodes ? Promise.resolve(reusable.nodes) : snapshot(device)).then(
    (nodes) => ({ nodes }),
    (error: unknown) => ({ error }),
  );
  const [semanticResult, rasterResult] = await Promise.all([
    semantics,
    raster ?? Promise.resolve({ screenshot: undefined }),
  ]);
  if ("error" in semanticResult && isCancellation(semanticResult.error)) {
    throw semanticResult.error;
  }
  if ("error" in rasterResult && isCancellation(rasterResult.error)) throw rasterResult.error;
  const nodes = "nodes" in semanticResult ? semanticResult.nodes : [];
  return {
    nodes,
    observedAt: reusable?.observedAt ?? now(),
    ...("screenshot" in rasterResult && rasterResult.screenshot
      ? { screenshot: rasterResult.screenshot }
      : {}),
  };
}

export async function runExpectScreenStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
  ctx: RecipeStepContext,
  dependencies: ExpectScreenDependencies = {},
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
    const captureDestinationScreenshot = dependencies.captureScreenshot ?? captureScreenshot;
    const attempt = await observeDestinationAttempt(
      device,
      reusable,
      ownsAndroidDestinationEvidence(step, ctx) && !reusable?.screenshot
        ? () =>
            captureDestinationScreenshot({
              device,
              caption: `Verify ${step.screenTitle}`,
              ephemeral: true,
              includeScreenMatch: false,
            })
        : undefined,
    );
    verifiedScreenshot = reusable?.screenshot ?? attempt.screenshot;
    const nodes = attempt.nodes;
    const observedAt = attempt.observedAt;
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
      visualFingerprint =
        verifiedScreenshot.screenMatch?.visualFingerprint ??
        observeVisualScreenFingerprint(Buffer.from(verifiedScreenshot.base64, "base64"));
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
    if (verifiedScreenshot) {
      const observed = observeScreenIdentity(verifiedNodes);
      const visualFingerprint =
        verifiedScreenshot.screenMatch?.visualFingerprint ??
        observeVisualScreenFingerprint(Buffer.from(verifiedScreenshot.base64, "base64"));
      if (observed.fingerprint || visualFingerprint) {
        verifiedScreenshot.screenMatch = {
          fingerprint: observed.fingerprint || visualFingerprint!,
          ...(visualFingerprint ? { visualFingerprint } : {}),
          matchedScreenId: step.screenId,
          status: "observed",
        };
      }
    }
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

import { describeSnapshotChrome } from "@relay/protocol";
import type { Device } from "./device.js";
import { pressKey, pressLabel, scrollUp, sleep, snapshot, type SnapshotNode } from "./device.js";
import { now } from "./events.js";
import { recordFrameObservation } from "./frame-observation.js";
import type { FreshDeviceObservation, RecipeStepContext } from "./recipe-runner-context.js";
import {
  currentVerifiedScreen,
  markNavigationUnknown,
  proveNavigationScreen,
} from "./recipe-runner-context.js";
import {
  handoffShellIdentityMatch,
  resilientScreenIdentityMatch,
} from "./recipe-runner-support.js";
import { screenIdentityMatches } from "./recipe-target-match.js";
import { foregroundApplicationBundle } from "./recipe-runner-tour-matching.js";
import {
  mappedPreludeHost,
  mappedPreludeStartVisible,
  runMappedPrelude,
} from "./recipe-runner-tour.js";

import type { RecipeStep } from "./recipes.js";
import {
  compareScreenIdentity,
  observeScreenIdentity,
  observeVisualScreenFingerprint,
} from "./screen-identity.js";
import { writeFrameTree } from "./run-frame-tree.js";
import { attachScreenshotPayload, captureScreenshot } from "./workspace-capture.js";
import {
  awaitStableDestinationEvidence,
  recordDestinationEvidenceTiming,
} from "./destination-evidence.js";
import {
  runDestinationEvidenceSurvey,
  type DestinationSurveyDependencies,
} from "./destination-survey.js";
import { rethrowIosMutationOutcomeUnknown } from "./ios-mutation-policy.js";
import type { DestinationRepairHint } from "./repair-proposal.js";

const DEFAULT_EXPECT_TIMEOUT_MS = 5_000;
const MAX_WAIT_MS = 15 * 60 * 1_000;

export async function captureRecipeScreenshot(
  device: Device,
  caption: string | undefined,
  ctx: RecipeStepContext,
): Promise<void> {
  const verified = currentVerifiedScreen(ctx.runtime);
  const observation = ctx.runtime?.observation;
  const nodes = observation?.nodes ?? verified?.nodes;
  const retained = observation?.screenshot ?? verified?.screenshot;
  const screenshot = retained
    ? await attachScreenshotPayload(
        retained,
        ctx.job?.id,
        caption ?? `screenshot · ${new Date().toISOString()}`,
      )
    : await captureScreenshot({
        jobId: ctx.job?.id,
        caption,
        device,
        ...(nodes ? { semanticNodes: nodes } : {}),
      });
  if (observation) observation.screenshot = screenshot;
  if (verified) verified.screenshot = screenshot;
  // The tree that produced this frame is the only chance to read its text
  // later: a matrix compares copy across locales long after the run.
  //
  // The smallest honest locale body is a launch and a screenshot, which never
  // verifies a screen and so holds no tree. Reading one here is what separates
  // a pack of forty unreadable rasters from a pack that can be compared. Only
  // matrix cases pay for it, and a target that cannot answer still yields a
  // frame — the observation is evidence, not a gate on the capture.
  const readable = nodes?.length ? nodes : await frameNodes(device, ctx);
  recordFrameObservation({
    ...(ctx.job ? { job: ctx.job } : {}),
    ...(screenshot.framePath ? { framePath: screenshot.framePath } : {}),
    ...(caption ? { caption } : {}),
    ...(readable ? { nodes: readable } : {}),
    ...(screenshot.base64 ? { base64: screenshot.base64 } : {}),
  });
  if (ctx.job && screenshot.framePath && readable?.length) {
    await writeFrameTree(ctx.job, screenshot.framePath, readable);
  }
}

async function frameNodes(
  device: Device,
  ctx: RecipeStepContext,
): Promise<SnapshotNode[] | undefined> {
  if (!ctx.job?.batchId) return undefined;
  try {
    return await snapshot(device);
  } catch {
    return undefined;
  }
}

type ExpectScreenDependencies = {
  captureScreenshot?: typeof captureScreenshot;
  /** Test seam for the automatic destination evidence survey. */
  captureSurvey?: DestinationSurveyDependencies["captureSurvey"];
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
  const navigationStartedAt = now();
  const priorObservation = ctx.runtime?.observation;
  if (ctx.runtime) {
    ctx.runtime.observation = undefined;
    markNavigationUnknown(ctx, `Verifying destination ${step.screenTitle}.`);
  }
  const expected = new Set([step.fingerprint, ...(step.aliases ?? [])]);
  const prelude = mappedPreludeHost(step);
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
  let preludeRuns = 0;
  // Retained from the final attempt so a terminal mismatch can describe what
  // the device actually showed in its repair hint.
  let mismatchObservedFingerprint: string | undefined;
  let mismatchNodeCount = 0;
  let mismatchResolutionMethod = "a11y";
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
    const resilientMatch = resilientScreenIdentityMatch(
      observed,
      step.observations ?? [],
      ctx.job,
      {
        screenTitle: step.screenTitle,
      },
    );
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
    mismatchObservedFingerprint = observed.fingerprint;
    mismatchNodeCount = nodes.length;
    if (
      prelude.preludeSteps?.length &&
      preludeRuns < 2 &&
      mappedPreludeStartVisible(nodes, prelude)
    ) {
      preludeRuns += 1;
      ctx.log(`screen: opening “${step.screenTitle}” from the current app screen`);
      await runMappedPrelude(device, prelude.preludeSteps, ctx.log, "screen");
      continue;
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
    if (visualFingerprint) mismatchResolutionMethod = "a11y+visual";
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
      } catch (error) {
        rethrowIosMutationOutcomeUnknown(error);
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
      } catch (error) {
        rethrowIosMutationOutcomeUnknown(error);
        await pressKey(device, "back");
      }
      await sleep(350, device);
      continue;
    }
    if (Date.now() < deadline) await sleep(Math.min(400, deadline - Date.now()), device);
  } while (Date.now() < deadline);

  if (!reached) {
    const hint: DestinationRepairHint = {
      expectedScreenId: step.screenId,
      expectedScreenTitle: step.screenTitle,
      ...(step.fingerprint ? { expectedFingerprint: step.fingerprint } : {}),
      ...(mismatchObservedFingerprint ? { observedFingerprint: mismatchObservedFingerprint } : {}),
      observedScreenTitle: observedTitle,
      resolutionMethod: mismatchResolutionMethod,
      evidence: {
        ...(verifiedScreenshot?.framePath ? { framePath: verifiedScreenshot.framePath } : {}),
        nodeCount: mismatchNodeCount,
      },
    };
    (ctx.job?.artifacts ?? ctx.artifacts)?.push({
      kind: "destination-repair-hint",
      capturedAt: now(),
      data: { schemaVersion: 1, ...hint },
    });
    if (step.returnRequirement) {
      throw new Error(
        `return-edge ${step.returnRequirement.connectionId}: reviewed inverse is required for ${step.returnRequirement.destinationScreenId} → ${step.returnRequirement.fromScreenId} (observed “${observedTitle}”; no Back was attempted)`,
      );
    }
    throw new Error(`expect-screen: on “${observedTitle}”, not “${step.screenTitle}”`);
  }
  if (step.evidenceSurface && verifiedNodes) {
    const captureDestinationScreenshot = dependencies.captureScreenshot ?? captureScreenshot;
    const stable = await awaitStableDestinationEvidence({
      surface: step.evidenceSurface,
      navigationStartedAt,
      initial: {
        nodes: verifiedNodes,
        ...(verifiedScreenshot ? { screenshot: verifiedScreenshot } : {}),
      },
      observe: async (includeRaster) => {
        const observation = await observeDestinationAttempt(
          device,
          undefined,
          includeRaster
            ? () =>
                captureDestinationScreenshot({
                  device,
                  caption: `Stabilize ${step.screenTitle}`,
                  ephemeral: true,
                  includeScreenMatch: false,
                })
            : undefined,
        );
        return {
          nodes: observation.nodes,
          ...(observation.screenshot ? { screenshot: observation.screenshot } : {}),
        };
      },
      wait: (durationMs) => sleep(durationMs, device),
    });
    verifiedNodes = stable.nodes;
    verifiedObservedAt = now();
    verifiedScreenshot = stable.screenshot;
    recordDestinationEvidenceTiming(ctx.job?.artifacts ?? ctx.artifacts, stable.timing, {
      screenId: step.screenId,
    });
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
    proveNavigationScreen(ctx, checkpoint);
  }
  if (verifiedNodes && step.repairCheckpoint && ctx.job) {
    const proofScreenshot = await captureScreenshot({
      jobId: ctx.job.id,
      device,
      caption: `repair-checkpoint:${step.repairCheckpoint.sourceCheckId}:${step.screenId}`,
      semanticNodes: verifiedNodes,
      includeScreenMatch: true,
    }).catch(() => undefined);
    const observed = observeScreenIdentity(verifiedNodes);
    const capturedAt = now();
    ctx.job.artifacts.push({
      kind: "campaign-repair-checkpoint-proof",
      capturedAt,
      data: {
        schemaVersion: 1,
        tokenId: `${ctx.job.id}:${step.repairCheckpoint.sourceRunId}:${step.repairCheckpoint.sourceCheckId}`,
        source: structuredClone(step.repairCheckpoint),
        expected: {
          screenId: step.screenId,
          screenTitle: step.screenTitle,
          fingerprint: step.fingerprint,
          aliases: [...(step.aliases ?? [])],
          observations: structuredClone(step.observations ?? []),
          ...(step.expectedApp ? { expectedApp: step.expectedApp } : {}),
        },
        observed: {
          observedAt: verifiedObservedAt ?? capturedAt,
          verifiedAt: capturedAt,
          screenIdentity: observed,
          chrome: describeSnapshotChrome(verifiedNodes),
          accessibility: { available: true, nodeCount: verifiedNodes.length },
          nodes: structuredClone(verifiedNodes),
          ...(proofScreenshot
            ? {
                screenshot: {
                  ...(proofScreenshot.framePath ? { framePath: proofScreenshot.framePath } : {}),
                  ...(proofScreenshot.path ? { path: proofScreenshot.path } : {}),
                  ...(proofScreenshot.width ? { width: proofScreenshot.width } : {}),
                  ...(proofScreenshot.height ? { height: proofScreenshot.height } : {}),
                  ...(proofScreenshot.screenMatch
                    ? { screenMatch: structuredClone(proofScreenshot.screenMatch) }
                    : {}),
                },
              }
            : {}),
        },
      },
    });
    ctx.log(`repair checkpoint: verified ${step.screenTitle} from fresh device evidence`);
  }
  ctx.log(`screen: reached ${step.screenTitle}`);
  // The landing is proven; the destination survey only widens its evidence.
  await runDestinationEvidenceSurvey(
    step,
    ctx,
    { nodes: verifiedNodes, screenshot: verifiedScreenshot },
    { captureSurvey: dependencies.captureSurvey },
  );
}

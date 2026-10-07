import { createHash } from "node:crypto";
import {
  assignCaptureReviewAttempt,
  captureReviewSlotId,
  captureReviewSlotFamilyId,
  classifyIosHardware,
  describeSnapshotChrome,
  observedCaptureReviewAccount,
  resolvedCaptureRasterPolicy,
  sequenceAfterIsPlaceholder,
  type CaptureReviewConfiguration,
  type CaptureReviewObservedSession,
  type CaptureReviewPlannedSlot,
  type CaptureReviewSlotIdentity,
} from "@relay/protocol";
import { extractProbedAccountIdentity } from "./browser-auth-health.js";
import type { Device } from "./device.js";
import { pressKey, pressLabel, scrollUp, sleep, snapshot, type SnapshotNode } from "./device.js";
import { now } from "./events.js";
import { recordFrameObservation } from "./frame-observation.js";
import { OPTIONAL_TREE_BUDGET_MS, withOptionalTreeBudget } from "./optional-tree-budget.js";
import type {
  FreshDeviceObservation,
  IdentityIgnoreObservation,
  RecipeStepContext,
} from "./recipe-runner-context.js";
import {
  currentVerifiedScreen,
  markNavigationUnknown,
  proveNavigationScreen,
  recipeScreenIdentityOptions,
} from "./recipe-runner-context.js";
import {
  expectedScreenFingerprints,
  handoffShellIdentityMatch,
  reobserveScreenIdentities,
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
import { runIdentityIgnoreStep } from "./recipe-runner-qa-steps.js";
import {
  compareScreenIdentity,
  observeScreenIdentity,
  observeVisualScreenFingerprint,
} from "./screen-identity.js";
import { writeFrameTree } from "./run-frame-tree.js";
import { writeFramePng } from "./runs.js";
import { captureSettledRaster, type VisualCapturePolicy } from "./visual-settling.js";
import {
  attachScreenshotPayload,
  captureScreenshot,
  cleanupScreenshot,
} from "./workspace-capture.js";
import {
  awaitStableDestinationEvidence,
  recordDestinationEvidenceTiming,
} from "./destination-evidence.js";
import {
  runDestinationEvidenceSurvey,
  type DestinationSurveyDependencies,
} from "./destination-survey.js";
import { rethrowIosMutationOutcomeUnknown } from "./ios-mutation-policy.js";
import { isTransientError } from "./retry.js";
import { parseAppMapTestExecutionIntentArtifact } from "./app-map-test-execution-intent.js";
import { frozenScreenIdentityObservations } from "./recipe-screen-frozen-identity.js";
import { retainScreenMismatch } from "./recipe-screen-mismatch.js";
import { nativeWorkspaceIdentityNodes } from "./screen-identity-native-workspace.js";
import { nativeImaginePendingModelSelection } from "./recipe-native-model-entry.js";
import { stillScreenTimeoutMessage, stillScreenUnchanged } from "./still-screen-wait.js";
import type { DestinationRepairHint } from "./repair-proposal.js";
import {
  getRecipeAndroidLocalization,
  localizeExpectedObservation,
  localizedScreenIdentityMatches,
  type RecipeAndroidLocalization,
} from "./recipe-localization.js";
import {
  capturedReviewIdentities,
  captureReviewConfigurationFromJob,
  expectScreenIdentityScope,
  observeStepIdentity,
  persistCaptureReviewPlannedSlots,
  reviewCapturePhase,
} from "./recipe-runner-screen-review.js";

const DEFAULT_EXPECT_TIMEOUT_MS = 5_000;
const MAX_WAIT_MS = 15 * 60 * 1_000;

export async function captureRecipeScreenshot(
  device: Device,
  caption: string | undefined,
  ctx: RecipeStepContext,
  dependencies: { captureScreenshot?: typeof captureScreenshot } = {},
  options: {
    review?: Extract<RecipeStep, { kind: "screenshot" }>["review"];
    stepId?: string;
  } = {},
): Promise<void> {
  const verified = currentVerifiedScreen(ctx.runtime);
  const observation = ctx.runtime?.observation;
  const nodes = observation?.nodes ?? verified?.nodes;
  const phase = reviewCapturePhase(options.review);
  const phaseSpec = options.review?.phases?.find((item) => item.id === phase);
  const reviewCaption = phaseSpec?.caption ?? caption;
  const lookFor = phaseSpec?.lookFor ?? options.review?.lookFor;
  if (
    sequenceAfterIsPlaceholder({
      ...(phase ? { phase } : {}),
      ...(lookFor ? { lookFor } : {}),
      ...(reviewCaption ? { caption: reviewCaption } : {}),
      ...(options.review?.phases ? { phases: options.review.phases } : {}),
    })
  ) {
    throw new Error("Live-output Sequence after cannot be a loading placeholder");
  }
  const policy = resolvedCaptureRasterPolicy(options.review?.policy);
  const capture = await captureSettledRaster({
    policy,
    capture: () =>
      (dependencies.captureScreenshot ?? captureScreenshot)({
        device,
        ephemeral: true,
        includeScreenMatch: false,
        ...(nodes ? { semanticNodes: nodes } : {}),
      }),
    bytes: (frame) => Buffer.from(frame.base64, "base64"),
    discard: (frame) => cleanupScreenshot(frame.path),
    wait: (ms) => sleep(ms, device),
  });
  let screenshot;
  try {
    screenshot = await attachScreenshotPayload(
      capture.value,
      ctx.job?.id,
      reviewCaption ?? `screenshot · ${new Date().toISOString()}`,
    );
    if (!screenshot.framePath && ctx.job) {
      const frame = await writeFramePng(
        ctx.job,
        capture.value.base64,
        reviewCaption ?? `screenshot · ${new Date().toISOString()}`,
        { capturedAt: capture.value.capturedAt },
      );
      screenshot.framePath = frame.path;
    }
  } finally {
    await cleanupScreenshot(capture.value.path);
  }
  const screenshotCapturedAt = screenshot.capturedAt;
  (ctx.job?.artifacts ?? ctx.artifacts)?.push({
    kind: "visual-settling",
    capturedAt: screenshotCapturedAt,
    data: {
      settled: capture.settled,
      samples: capture.samples,
      stabilityMeasured: capture.stabilityMeasured,
      framePath: screenshot.framePath,
      policy,
      ...(phase ? { phase } : {}),
    },
  });
  if (options.review?.mode === "later") {
    const imageSha256 = createHash("sha256")
      .update(Buffer.from(capture.value.base64, "base64"))
      .digest("hex");
    const { configuration, observed } = captureReviewConfigurationFromJob(
      ctx.job,
      ctx.artifacts,
      nodes,
    );
    const checkpointId = options.review.checkpointId ?? options.stepId;
    const cursor = ctx.captureReview;
    const family = checkpointId
      ? {
          checkpointId,
          caption: reviewCaption ?? "screenshot",
          ...(lookFor ? { lookFor } : {}),
          ...(options.stepId ? { stepId: options.stepId } : {}),
          ...(cursor?.requirementId ? { requirementId: cursor.requirementId } : {}),
          ...(cursor?.invocation ? { invocation: cursor.invocation } : {}),
          ...(cursor?.iteration !== undefined ? { iteration: cursor.iteration } : {}),
          ...(phase ? { phase } : {}),
        }
      : undefined;
    // Planned configuration is part of checkpoint identity; observed device
    // metadata describes the image but must not create a second planned slot.
    const plannedFamilies = family
      ? new Map(
          (ctx.plannedSlots ?? [])
            .filter(
              (slot) =>
                captureReviewSlotFamilyId({ ...slot, configuration: undefined }) ===
                captureReviewSlotFamilyId(family),
            )
            .map((slot) => [captureReviewSlotFamilyId(slot), slot]),
        )
      : undefined;
    const plannedFamily =
      plannedFamilies?.size === 1 ? [...plannedFamilies.values()][0] : undefined;
    const captureFamily = family
      ? {
          ...family,
          ...(plannedFamily?.configuration ? { configuration: plannedFamily.configuration } : {}),
        }
      : undefined;
    const assigned = captureFamily
      ? assignCaptureReviewAttempt({
          plannedSlots: ctx.plannedSlots ?? [],
          captured: capturedReviewIdentities(ctx.job?.artifacts ?? ctx.artifacts, ctx.plannedSlots),
          slot: captureFamily,
        })
      : undefined;
    if (assigned) persistCaptureReviewPlannedSlots(ctx, assigned.plannedSlots);
    const identity = captureFamily
      ? { ...captureFamily, attempt: assigned?.attempt ?? 1 }
      : undefined;
    const computedSlotId = identity ? captureReviewSlotId(identity) : undefined;
    const frozen = computedSlotId
      ? ctx.plannedSlots?.find((slot) => captureReviewSlotId(slot) === computedSlotId)
      : undefined;
    const slotId = frozen ? captureReviewSlotId(frozen) : computedSlotId;
    // A planned slot's configuration is its stable review identity. Keep the
    // runtime engine (for example, chromium) in observed session metadata
    // rather than allowing it to contradict the planned target (for example,
    // grok-com).
    const persistedConfiguration =
      frozen?.configuration ?? identity?.configuration ?? configuration;
    (ctx.job?.artifacts ?? ctx.artifacts)?.push({
      kind: "capture-review",
      capturedAt: screenshotCapturedAt,
      data: {
        status: screenshot.framePath ? "pending" : "missing",
        caption: reviewCaption ?? "screenshot",
        ...(lookFor ? { lookFor } : {}),
        ...(screenshot.framePath ? { framePath: screenshot.framePath } : {}),
        imageSha256,
        ...(options.stepId ? { stepId: options.stepId } : {}),
        ...(slotId ? { slotId } : {}),
        ...((frozen?.requirementId ?? identity?.requirementId)
          ? { requirementId: frozen?.requirementId ?? identity?.requirementId }
          : {}),
        ...((frozen?.checkpointId ?? identity?.checkpointId)
          ? { checkpointId: frozen?.checkpointId ?? identity?.checkpointId }
          : {}),
        ...((frozen?.invocation ?? identity?.invocation)
          ? { invocation: frozen?.invocation ?? identity?.invocation }
          : {}),
        ...(frozen?.iteration !== undefined || identity?.iteration !== undefined
          ? { iteration: frozen?.iteration ?? identity?.iteration }
          : {}),
        ...(frozen?.attempt !== undefined || identity?.attempt !== undefined
          ? { attempt: frozen?.attempt ?? identity?.attempt }
          : {}),
        ...((frozen?.phase ?? identity?.phase) ? { phase: frozen?.phase ?? identity?.phase } : {}),
        settled: capture.settled,
        samples: capture.samples,
        stabilityMeasured: capture.stabilityMeasured,
        policy,
        ...(persistedConfiguration ? { configuration: persistedConfiguration } : {}),
        ...(observed ? { observed } : {}),
      },
    });
  }
  if (capture.stabilityMeasured && !capture.settled) {
    ctx.log("Screenshot retained while the screen was still changing.");
  }
  if (observation) observation.screenshot = screenshot;
  if (verified) verified.screenshot = screenshot;
  await collectOptionalReviewTree({
    device,
    ctx,
    screenshot,
    caption,
    nodes,
    policy,
  });
}

function recordOptionalTreeFailure(
  ctx: RecipeStepContext,
  screenshot: { framePath?: string },
  error: unknown,
  policy: VisualCapturePolicy | undefined,
): void {
  const message = error instanceof Error ? error.message : String(error);
  ctx.log(`warn: optional UI-tree capture failed: ${message}`);
  (ctx.job?.artifacts ?? ctx.artifacts)?.push({
    kind: "ui-tree",
    capturedAt: now(),
    data: {
      status: "failed",
      error: message,
      nodes: [],
      ...(screenshot.framePath ? { framePath: screenshot.framePath } : {}),
      ...(policy ? { policy } : {}),
    },
  });
}

async function collectOptionalReviewTree(input: {
  device: Device;
  ctx: RecipeStepContext;
  screenshot: { framePath?: string; base64?: string };
  caption: string | undefined;
  nodes: readonly SnapshotNode[] | undefined;
  policy: VisualCapturePolicy | undefined;
}): Promise<void> {
  const { device, ctx, screenshot, caption, nodes, policy } = input;
  // Cached nodes already belong to this frame. A follow-on snapshot is only
  // for matrix packs that never verified a screen. Fast/Sequence cannot let
  // that read fail the pixel slot; Stable still waits on the ordinary budget.
  let readable: readonly SnapshotNode[] | undefined = nodes?.length ? nodes : undefined;
  if (!readable) {
    const budget = policy === "fast" || policy === "sequence" ? OPTIONAL_TREE_BUDGET_MS : undefined;
    try {
      readable = await withOptionalTreeBudget(budget, () =>
        frameNodes(device, ctx, {
          retryAttempts: 1,
          ...(budget !== undefined ? { timeoutMs: budget } : {}),
        }),
      );
    } catch (error) {
      recordOptionalTreeFailure(ctx, screenshot, error, policy);
    }
  }
  recordFrameObservation({
    ...(ctx.job ? { job: ctx.job } : {}),
    ...(screenshot.framePath ? { framePath: screenshot.framePath } : {}),
    ...(caption ? { caption } : {}),
    ...(readable ? { nodes: readable } : {}),
    ...(screenshot.base64 ? { base64: screenshot.base64 } : {}),
  });
  if (ctx.job && screenshot.framePath && readable?.length) {
    try {
      await writeFrameTree(ctx.job, screenshot.framePath, readable);
    } catch (error) {
      recordOptionalTreeFailure(ctx, screenshot, error, policy);
    }
  }
}

async function frameNodes(
  device: Device,
  ctx: RecipeStepContext,
  options: { retryAttempts?: number; timeoutMs?: number } = {},
): Promise<SnapshotNode[] | undefined> {
  if (!ctx.job?.batchId) return undefined;
  return await snapshot(device, {
    ...(options.retryAttempts !== undefined ? { retryAttempts: options.retryAttempts } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
}

type ExpectScreenDependencies = {
  captureScreenshot?: typeof captureScreenshot;
  /** Test seam for the automatic destination evidence survey. */
  captureSurvey?: DestinationSurveyDependencies["captureSurvey"];
  /** Test seam and shared runtime hook for APK-backed expected-label translation. */
  getLocalization?: (
    ctx: RecipeStepContext,
    nodes: SnapshotNode[],
  ) => Promise<RecipeAndroidLocalization | undefined>;
  /** Test seam for the bounded semantic re-observation after a transient AX failure. */
  observeSnapshot?: (device: Device) => Promise<SnapshotNode[]>;
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
  observeSnapshot: (device: Device) => Promise<SnapshotNode[]> = (target) =>
    snapshot(target, { retryAttempts: 1 }),
): Promise<{
  nodes: SnapshotNode[];
  observedAt: number;
  inspectionUnavailable?: boolean;
  screenshot?: Awaited<ReturnType<typeof captureScreenshot>>;
}> {
  const raster = captureRaster?.().then(
    (screenshot) => ({ screenshot }),
    (error: unknown) => ({ error }),
  );
  const semantics = (async () => {
    if (reusable?.nodes) return { nodes: reusable.nodes };
    try {
      return { nodes: await observeSnapshot(device) };
    } catch (error) {
      // A single transient AX timeout must not consume the normal three-read
      // budget. Re-observe once through the same transport, then fail closed
      // with an empty tree if the target remains unavailable.
      if (!isTransientError(error)) return { error };
      try {
        return { nodes: await observeSnapshot(device) };
      } catch (retryError) {
        return { error: retryError };
      }
    }
  })();
  const [semanticResult, rasterResult] = await Promise.all([
    semantics,
    raster ?? Promise.resolve({ screenshot: undefined }),
  ]);
  if ("error" in semanticResult && isCancellation(semanticResult.error)) {
    throw semanticResult.error;
  }
  if ("error" in rasterResult && isCancellation(rasterResult.error)) throw rasterResult.error;
  const nodes =
    "nodes" in semanticResult && Array.isArray(semanticResult.nodes) ? semanticResult.nodes : [];
  return {
    nodes,
    observedAt: reusable?.observedAt ?? now(),
    ...(nodes.length === 0 ? { inspectionUnavailable: true } : {}),
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
  if (ctx.runtime) {
    for (const region of step.ignoreRegions ?? []) {
      runIdentityIgnoreStep(
        {
          kind: "identity-ignore",
          region: { x: region.x, y: region.y, width: region.width, height: region.height },
          ...(region.name ? { name: region.name } : {}),
          ...(step.id ? { id: step.id } : {}),
        },
        ctx,
        {
          screenId: step.screenId,
          ...(step.id ? { stepId: step.id, checkpointId: step.id } : {}),
        },
      );
    }
  }
  const priorObservation = ctx.runtime?.observation;
  if (ctx.runtime) {
    ctx.runtime.observation = undefined;
    markNavigationUnknown(ctx, `Verifying destination ${step.screenTitle}.`);
  }
  const identityOptions = recipeScreenIdentityOptions(
    ctx,
    step.ignoreRegions,
    expectScreenIdentityScope(ctx, step),
  );
  const intent = identityOptions.policy?.nativeImagineWorkspace
    ? ctx.job?.artifacts.map(parseAppMapTestExecutionIntentArtifact).find(Boolean)
    : undefined;
  const scopedIdentityOptions = {
    ...identityOptions,
    ...(intent && nativeImaginePendingModelSelection(intent.plan, step)
      ? { nativeImaginePendingModel: true }
      : {}),
  };
  const expected = expectedScreenFingerprints(step, scopedIdentityOptions);
  const unmaskedExpected = new Set([
    step.fingerprint,
    ...(step.aliases ?? []),
    ...(step.observations ?? []).map((observation) => observation.fingerprint),
  ]);
  const hostedObservations = reobserveScreenIdentities(step.observations, scopedIdentityOptions);
  let frozenNativeWorkspace = false;
  if (identityOptions.policy?.nativeImagineWorkspace) {
    if (intent) {
      const frozen = await frozenScreenIdentityObservations(
        intent.plan,
        step,
        scopedIdentityOptions,
      );
      frozenNativeWorkspace = frozen.length > 0;
      for (const observation of frozen) expected.add(observation.fingerprint);
      hostedObservations.push(...frozen);
    }
  }
  const compareObservations = hostedObservations.length
    ? hostedObservations
    : (step.observations ?? []);
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
  let mismatchNodes: SnapshotNode[] | undefined;
  let mismatchObservedAt: number | undefined;
  let mismatchNodeCount = 0;
  let mismatchResolutionMethod = "a11y";
  let inspectionUnavailable = false;
  let lastMissVisualFingerprint: string | undefined;
  let stillScreenElapsedMs: number | undefined;
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
      dependencies.observeSnapshot,
    );
    verifiedScreenshot = reusable?.screenshot ?? attempt.screenshot;
    const nodes = attempt.nodes;
    inspectionUnavailable = attempt.inspectionUnavailable === true;
    const observedAt = attempt.observedAt;
    const chrome = describeSnapshotChrome(nodes);
    observedTitle = chrome.header ?? chrome.app ?? "unknown";
    const observed = observeScreenIdentity(nodes, scopedIdentityOptions);
    // Similarity ignores selected state. Imagine must prove exact retained
    // chrome/composer state, including the selected Speed or Quality model.
    const exactNativeWorkspace =
      frozenNativeWorkspace ||
      nativeWorkspaceIdentityNodes(nodes, identityOptions.policy) !== nodes;
    // A geometric mask cannot be reapplied to compact taught observations:
    // their rectangles are intentionally absent. Exact full semantic proof
    // remains valid when its fingerprint was explicitly retained by the Test.
    // Qualified Imagine workspaces keep their stricter selected-model policy.
    const exactUnmaskedMatch =
      !exactNativeWorkspace &&
      Boolean(scopedIdentityOptions.ignoreRegions?.length) &&
      unmaskedExpected.has(
        observeScreenIdentity(nodes, { ...scopedIdentityOptions, ignoreRegions: [] }).fingerprint,
      );
    const semanticMatch =
      !exactNativeWorkspace &&
      compareObservations.some(
        (observation) => compareScreenIdentity(observed, observation).decision === "match",
      );
    const resilientMatch =
      !exactNativeWorkspace &&
      resilientScreenIdentityMatch(observed, compareObservations, ctx.job, {
        screenTitle: step.screenTitle,
      });
    const handoffShellMatch =
      !exactNativeWorkspace &&
      Boolean(step.expectedApp) &&
      foregroundApplicationBundle(nodes) === step.expectedApp &&
      handoffShellIdentityMatch(observed, compareObservations);
    let localizedSemanticMatch = false;
    let hasLocalizedExpectation = false;
    // The translated expectation retains the taught app's resource ownership.
    // expectedApp is only populated for handoffs, so ordinary in-app screens
    // must derive ownership from their retained resource identifiers.
    if (
      !exactNativeWorkspace &&
      !exactUnmaskedMatch &&
      !screenIdentityMatches(expected, observed.fingerprint) &&
      (!step.expectedApp || foregroundApplicationBundle(nodes) === step.expectedApp)
    ) {
      const localization = await (dependencies.getLocalization ?? getRecipeAndroidLocalization)(
        ctx,
        nodes,
      );
      if (localization && (!step.expectedApp || localization.packageName === step.expectedApp)) {
        // Freeze the observed app locale into the run evidence. Matrix inputs
        // can omit it when the platform locale was selected outside Relay.
        if (ctx.job) ctx.job.resolvedInputs.app_locale = localization.locale;
        localizedSemanticMatch = (step.observations ?? []).some((observation) => {
          const localized = localizeExpectedObservation(observation, localization, observed);
          if (localized) hasLocalizedExpectation = true;
          return (
            localized !== undefined &&
            (compareScreenIdentity(observed, localized).decision === "match" ||
              localizedScreenIdentityMatches(observed, localized, observation, localization))
          );
        });
        if (localizedSemanticMatch)
          ctx.log(
            `screen: verified ${step.screenTitle} using ${localization.locale} app resources`,
          );
      }
    }
    if (
      screenIdentityMatches(expected, observed.fingerprint) ||
      exactUnmaskedMatch ||
      (!hasLocalizedExpectation && semanticMatch) ||
      localizedSemanticMatch ||
      (!hasLocalizedExpectation && resilientMatch) ||
      (!hasLocalizedExpectation && handoffShellMatch)
    ) {
      reached = true;
      verifiedNodes = nodes;
      verifiedObservedAt = observedAt;
      break;
    }
    mismatchObservedFingerprint = observed.fingerprint;
    mismatchNodes = nodes;
    mismatchObservedAt = observedAt;
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
    if (
      !exactNativeWorkspace &&
      !inspectionUnavailable &&
      screenIdentityMatches(expected, observed.fingerprint, visualFingerprint)
    ) {
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
    if (visualFingerprint && stillScreenUnchanged(lastMissVisualFingerprint, visualFingerprint)) {
      stillScreenElapsedMs = now() - navigationStartedAt;
      ctx.log(
        `screen: pixels unchanged while waiting for ${step.screenTitle} (${stillScreenElapsedMs}ms)`,
      );
    }
    lastMissVisualFingerprint = visualFingerprint ?? lastMissVisualFingerprint;
    if (Date.now() < deadline) await sleep(Math.min(400, deadline - Date.now()), device);
  } while (Date.now() < deadline);

  if (!reached) {
    retainScreenMismatch(
      ctx,
      step,
      {
        nodes: mismatchNodes,
        observedAt: mismatchObservedAt,
        fingerprint: mismatchObservedFingerprint,
      },
      scopedIdentityOptions,
    );
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
    if (inspectionUnavailable) {
      throw new Error(
        `screen-inspection-unavailable: accessibility inspection unavailable; screen identity unproven (expected “${step.screenTitle}”)`,
      );
    }
    if (step.returnRequirement) {
      throw new Error(
        `return-edge ${step.returnRequirement.connectionId}: reviewed inverse is required for ${step.returnRequirement.destinationScreenId} → ${step.returnRequirement.fromScreenId} (observed “${observedTitle}”; no Back was attempted)`,
      );
    }
    throw new Error(
      stillScreenElapsedMs !== undefined
        ? stillScreenTimeoutMessage({
            kind: "expect-screen",
            expected: step.screenTitle,
            observed: observedTitle,
            elapsedMs: stillScreenElapsedMs,
            timeoutMs: timeout,
            pixelsUnchanged: true,
          })
        : `expect-screen: on “${observedTitle}”, not “${step.screenTitle}”`,
    );
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
          dependencies.observeSnapshot,
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
      const observed = observeStepIdentity(verifiedNodes, ctx, step);
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
    const observed = observeStepIdentity(verifiedNodes, ctx, step);
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

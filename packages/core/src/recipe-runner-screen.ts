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
import { stillScreenTimeoutMessage, stillScreenUnchanged } from "./still-screen-wait.js";
import type { DestinationRepairHint } from "./repair-proposal.js";
import {
  getRecipeAndroidLocalization,
  localizeExpectedObservation,
  localizedScreenIdentityMatches,
  type RecipeAndroidLocalization,
} from "./recipe-localization.js";

const DEFAULT_EXPECT_TIMEOUT_MS = 5_000;
const MAX_WAIT_MS = 15 * 60 * 1_000;

function expectScreenIdentityScope(
  ctx: RecipeStepContext,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
): IdentityIgnoreObservation {
  return {
    screenId: step.screenId,
    frameIndex: ctx.job?.frames?.length ?? 0,
    ...(step.id ? { stepId: step.id, checkpointId: step.id } : {}),
  };
}

function observeStepIdentity(
  nodes: readonly SnapshotNode[],
  ctx: RecipeStepContext,
  step: Extract<RecipeStep, { kind: "expect-screen" }>,
) {
  return observeScreenIdentity(
    nodes,
    recipeScreenIdentityOptions(ctx, step.ignoreRegions, expectScreenIdentityScope(ctx, step)),
  );
}

function combineCellChildLaneId(
  artifacts: readonly { kind?: string; data?: unknown }[] | undefined,
): string | undefined {
  for (const artifact of artifacts ?? []) {
    if (artifact.kind !== "app-map-combine-cell-execution-intent") continue;
    const data =
      artifact.data && typeof artifact.data === "object" && !Array.isArray(artifact.data)
        ? (artifact.data as Record<string, unknown>)
        : undefined;
    const child =
      data?.child && typeof data.child === "object" && !Array.isArray(data.child)
        ? (data.child as Record<string, unknown>)
        : undefined;
    const laneId = textField(child?.laneId);
    if (laneId) return laneId;
  }
  return undefined;
}

function snapshotNodeIdentityLabels(nodes: readonly SnapshotNode[] | undefined): string[] {
  if (!nodes?.length) return [];
  const labels: string[] = [];
  for (const node of nodes) {
    for (const value of [node.label, node.content, node.value, node.identifier]) {
      const text = value?.replace(/\s+/gu, " ").trim();
      if (text) labels.push(text);
    }
  }
  return labels;
}

function liveCaptureReviewIdentityFromNodes(
  nodes: readonly SnapshotNode[] | undefined,
): string | undefined {
  const labels = snapshotNodeIdentityLabels(nodes);
  if (labels.length === 0) return undefined;
  return extractProbedAccountIdentity({ title: "", bodyText: labels.join("\n"), labels });
}

function captureReviewConfigurationFromJob(
  job: RecipeStepContext["job"],
  artifacts?: RecipeStepContext["artifacts"],
  nodes?: readonly SnapshotNode[],
): {
  configuration?: CaptureReviewConfiguration;
  observed?: CaptureReviewObservedSession;
} {
  if (!job) return {};
  const viewport = job.browserCaseProfile?.viewport;
  const platform = job.platform?.trim() || job.targetProfile?.platform?.trim() || undefined;
  const iosHardwareClass =
    platform === "ios"
      ? classifyIosHardware({
          name: job.deviceName ?? job.targetProfile?.name,
          kind: job.targetProfile?.model,
          serial: job.serial,
          device: job.serial,
        })
      : undefined;
  const labeled = observedCaptureReviewAccount({
    laneId:
      job.laneId || combineCellChildLaneId(job.artifacts) || combineCellChildLaneId(artifacts),
    unsignedLaneId: job.unsignedLaneId,
    targetKind: job.targetKind,
    targetProfileId: job.targetProfile?.id,
    platform,
    ...(iosHardwareClass ? { iosHardwareClass } : {}),
    authenticationFixtureId: job.browserCaseProfile?.authenticationFixtureId,
    liveIdentity: job.authenticationHealth?.identity || liveCaptureReviewIdentityFromNodes(nodes),
    resolvedAccount: job.resolvedInputs?.account?.trim() || job.resolvedInputs?.Account?.trim(),
    fixtureHealthStatus: job.authenticationHealth?.status,
    fixtureSignedIn: job.authenticationHealth?.signedIn,
  });
  const locale =
    job.resolvedInputs?.language?.trim() ||
    job.resolvedInputs?.locale?.trim() ||
    job.browserCaseProfile?.locale;
  const browserJob = Boolean(job.browserTargetId || job.browserCaseProfile);
  const observed: CaptureReviewObservedSession | undefined = (() => {
    const session: CaptureReviewObservedSession = {
      ...labeled.observed,
      ...(browserJob ? { sessionStore: "playwright-user-data" as const } : {}),
    };
    return Object.keys(session).length ? session : undefined;
  })();
  const configuration: CaptureReviewConfiguration = {
    ...(job.deviceName?.trim() || job.browserTargetId?.trim()
      ? { app: (job.deviceName ?? job.browserTargetId)!.trim() }
      : {}),
    ...(labeled.account ? { account: labeled.account } : {}),
    ...(job.browserCaseProfile?.engine ? { browser: job.browserCaseProfile.engine } : {}),
    ...(viewport ? { viewport: `${viewport.width}×${viewport.height}` } : {}),
    ...(locale ? { locale } : {}),
    ...(job.sourceRevision?.buildId?.trim()
      ? { build: job.sourceRevision.buildId.trim() }
      : job.appVersion?.trim()
        ? { build: job.appVersion.trim() }
        : {}),
  };
  return {
    ...(Object.keys(configuration).length ? { configuration } : {}),
    ...(observed ? { observed } : {}),
  };
}

function textField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function capturedReviewIdentities(
  artifacts: readonly { kind?: string; data?: unknown }[] | undefined,
  plannedSlots: readonly CaptureReviewPlannedSlot[] = [],
): CaptureReviewSlotIdentity[] {
  const identities: CaptureReviewSlotIdentity[] = [];
  for (const artifact of artifacts ?? []) {
    if (artifact.kind !== "capture-review") continue;
    const data =
      artifact.data && typeof artifact.data === "object" && !Array.isArray(artifact.data)
        ? (artifact.data as Record<string, unknown>)
        : undefined;
    const checkpointId = textField(data?.checkpointId) ?? textField(data?.stepId);
    if (!checkpointId) continue;
    const iteration = integerField(data?.iteration);
    const attempt = integerField(data?.attempt);
    const frozen = plannedSlots.find(
      (slot) => captureReviewSlotId(slot) === textField(data?.slotId),
    );
    identities.push({
      ...(frozen?.configuration ? { configuration: frozen.configuration } : {}),
      checkpointId,
      ...(textField(data?.requirementId) ? { requirementId: textField(data?.requirementId) } : {}),
      ...(textField(data?.invocation) ? { invocation: textField(data?.invocation) } : {}),
      ...(iteration !== undefined ? { iteration } : {}),
      ...(attempt !== undefined ? { attempt } : {}),
      ...(textField(data?.phase) ? { phase: textField(data?.phase) } : {}),
    });
  }
  return identities;
}

function reviewCapturePhase(
  review: Extract<RecipeStep, { kind: "screenshot" }>["review"],
): string | undefined {
  const named = review?.phase?.trim();
  if (named) return named;
  if (review?.policy === "sequence") return review.phases?.[0]?.id;
  return undefined;
}

function persistCaptureReviewPlannedSlots(
  ctx: RecipeStepContext,
  slots: CaptureReviewPlannedSlot[],
): void {
  ctx.plannedSlots = slots;
  for (const artifact of ctx.job?.artifacts ?? ctx.artifacts ?? []) {
    if (!artifact?.data || typeof artifact.data !== "object" || Array.isArray(artifact.data)) {
      continue;
    }
    const data = artifact.data as {
      plan?: { plannedSlots?: CaptureReviewPlannedSlot[] };
      child?: { plan?: { plannedSlots?: CaptureReviewPlannedSlot[] } };
    };
    if (artifact.kind === "app-map-test-execution-intent" && data.plan) {
      data.plan.plannedSlots = slots;
    }
    if (artifact.kind === "app-map-combine-cell-execution-intent" && data.child?.plan) {
      data.child.plan.plannedSlots = slots;
    }
  }
}

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
        ...(configuration ? { configuration } : {}),
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
  const expected = expectedScreenFingerprints(
    step,
    recipeScreenIdentityOptions(ctx, step.ignoreRegions, expectScreenIdentityScope(ctx, step)),
  );
  const hostedObservations = reobserveScreenIdentities(
    step.observations,
    recipeScreenIdentityOptions(ctx, step.ignoreRegions, expectScreenIdentityScope(ctx, step)),
  );
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
    const observed = observeStepIdentity(nodes, ctx, step);
    const semanticMatch = compareObservations.some(
      (observation) => compareScreenIdentity(observed, observation).decision === "match",
    );
    const resilientMatch = resilientScreenIdentityMatch(observed, compareObservations, ctx.job, {
      screenTitle: step.screenTitle,
    });
    const handoffShellMatch =
      Boolean(step.expectedApp) &&
      foregroundApplicationBundle(nodes) === step.expectedApp &&
      handoffShellIdentityMatch(observed, compareObservations);
    let localizedSemanticMatch = false;
    let hasLocalizedExpectation = false;
    // The translated expectation retains the taught app's resource ownership.
    // expectedApp is only populated for handoffs, so ordinary in-app screens
    // must derive ownership from their retained resource identifiers.
    if (
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

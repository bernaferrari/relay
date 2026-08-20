import type { Device } from "./device.js";
import { replaceText, scrollDown, scrollUp, sleep, snapshot, typeText } from "./device.js";
import { cooperativeCheckpoint } from "./control.js";
import { now } from "./events.js";
import { captureScrollableSurveyForTarget } from "./scrollable-survey.js";
import {
  captureSurfaceBaselineDisposition,
  loadFrozenDocumentOriginForCaptureSurface,
} from "./capture-surface-frozen-origin.js";
import { persistLogicalScrollSurface } from "./logical-scroll-surface.js";
import { listPersistedRuns } from "./runs.js";
import {
  findReusableSurfaceComparison,
  surfaceComparisonNeedsRecapture,
  surfaceComparisonCacheIdentity,
  surfaceComparisonCacheKey,
  type SurfaceComparisonCacheProvenance,
} from "./surface-comparison-cache.js";
import { ensureAndroidSurfaceRuntimeFacts } from "./surface-comparison-runtime-facts.js";
import { compareScreenIdentity, observeScreenIdentity } from "./screen-identity.js";
import {
  resolveSemanticRevealTarget,
  resolveSnapshotTargetPoint,
  resolveSnapshotTargetRevealDirection,
} from "./device-target-resolution.js";
import {
  resilientScreenIdentityMatch,
  longPressRecordedTarget,
  tapRecordedTarget,
} from "./recipe-runner-support.js";
import { screenIdentityMatches } from "./recipe-target-match.js";
import type { RecipeStep } from "./recipes.js";
import type { TestJob } from "./session-contract.js";
import type { TargetProfile } from "@relay/protocol";
import {
  currentVerifiedScreen,
  invalidateVerifiedScreen,
  type RecipeStepContext,
} from "./recipe-runner-context.js";
import {
  advanceSemanticRevealNavigation,
  estimateSemanticRevealMovement,
  initialSemanticRevealProgress,
  type RevealDirection,
  type SemanticRevealEstimate,
} from "./semantic-reveal-navigation.js";

type SemanticRevealAttempt =
  | ({ source: "semantic-index"; attemptedDirection: RevealDirection } & SemanticRevealEstimate)
  | { source: "live-target"; attemptedDirection: RevealDirection; amount: number };

function semanticRevealRepair(
  step: Extract<RecipeStep, { kind: "reveal" }>,
  ctx: RecipeStepContext,
  reason: string,
  attempts: SemanticRevealAttempt[],
  nodes: Awaited<ReturnType<typeof snapshot>>,
): never {
  const data = {
    schemaVersion: 1,
    status: "needs-review",
    reason,
    target: structuredClone(step.target),
    authoredDirection: step.direction ?? "auto",
    maxAttempts: step.maxAttempts ?? 12,
    surfaces: (step.navigation ?? []).map((plan) => ({
      surfaceId: plan.surfaceId,
      captureId: plan.captureId,
      targetOrder: plan.targetOrder,
      targetDocumentY: plan.targetDocumentY,
    })),
    attempts: structuredClone(attempts),
    lastObservation: {
      fingerprint: observeScreenIdentity(nodes).fingerprint,
      nodeCount: nodes.length,
      accessibilityTree: structuredClone(nodes),
    },
  };
  const artifact = { kind: "semantic-reveal-repair", capturedAt: now(), data };
  ctx.job?.artifacts.push(artifact);
  ctx.artifacts?.push(artifact);
  throw new Error(`reveal-control: ${reason}; repair packet captured`);
}

export async function runTapStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "tap" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  if (step.gesture === "hold") return longPressRecordedTarget(device, step, ctx);
  const multi = step.gesture === "multi";
  await tapRecordedTarget(
    device,
    { ...step, region: step.when?.region },
    ctx,
    multi ? (step.tapCount ?? 2) : 1,
    multi ? (step.intervalMs ?? 100) : 0,
  );
}

export async function runTypeStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "type" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  if (step.mode === "replace") {
    if (!step.target) throw new Error("replace text requires a target");
    return replaceText(device, step.target, step.text);
  }
  if (step.target) await tapRecordedTarget(device, { ...step, target: step.target }, ctx);
  await typeText(device, step.text);
}

export async function runSemanticScrollStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "scroll" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const performScroll = () =>
    step.direction === "down" ? scrollDown(device, step.amount) : scrollUp(device, step.amount);
  if (!step.until) return performScroll();
  const expected = new Set([step.until.fingerprint, ...(step.until.aliases ?? [])]);
  const maxAttempts = step.maxAttempts ?? 12;
  let previousFingerprint: string | undefined;
  let repeated = 0;
  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    await cooperativeCheckpoint();
    const observed = observeScreenIdentity(await snapshot(device));
    if (
      screenIdentityMatches(expected, observed.fingerprint) ||
      (step.until.observations ?? []).some(
        (observation) => compareScreenIdentity(observed, observation).decision === "match",
      ) ||
      resilientScreenIdentityMatch(observed, step.until.observations ?? [], ctx.job, {
        allowDynamicShell: false,
      })
    ) {
      ctx.log(
        attempt
          ? `scroll: revealed ${step.until.screenTitle} after ${attempt} semantic scroll${attempt === 1 ? "" : "s"}`
          : `scroll: ${step.until.screenTitle} already visible`,
      );
      return;
    }
    if (attempt === maxAttempts) {
      throw new Error(
        `reveal-screen: could not reveal “${step.until.screenTitle}” after ${maxAttempts} scrolls`,
      );
    }
    repeated = observed.fingerprint === previousFingerprint ? repeated + 1 : 0;
    if (repeated >= 2) {
      throw new Error(`reveal-screen: reached the list edge before “${step.until.screenTitle}”`);
    }
    previousFingerprint = observed.fingerprint;
    await performScroll();
    await sleep(250, device);
  }
}

export async function runRevealStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "reveal" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const maxAttempts = step.maxAttempts ?? 12;
  const targetFound = (nodes: Awaited<ReturnType<typeof snapshot>>) => {
    const hit = resolveSemanticRevealTarget(nodes, step.target);
    if (!hit) return false;
    if (hit.revealDirection) return false;
    return true;
  };
  const chromeNudge = (nodes: Awaited<ReturnType<typeof snapshot>>) =>
    resolveSemanticRevealTarget(nodes, step.target)?.revealDirection;
  if (step.navigation?.length) {
    let previousFingerprint: string | undefined;
    let repeated = 0;
    let progress = initialSemanticRevealProgress();
    const movements: SemanticRevealAttempt[] = [];
    let lastAttemptedDirection: RevealDirection | undefined;
    for (let attempts = 0; attempts <= maxAttempts; attempts += 1) {
      await cooperativeCheckpoint();
      const nodes = ctx.runtime?.observation?.nodes ?? (await snapshot(device));
      if (ctx.runtime && !ctx.runtime.observation) {
        ctx.runtime.observation = { nodes, observedAt: now() };
      }
      if (targetFound(nodes)) {
        ctx.log(
          `reveal: found semantic target after ${attempts} indexed scroll${attempts === 1 ? "" : "s"}`,
        );
        return;
      }
      const nudge = chromeNudge(nodes);
      if (nudge) {
        const priorDirection = lastAttemptedDirection;
        if (priorDirection && priorDirection !== nudge) {
          if (progress.directionChanges > 0) {
            semanticRevealRepair(
              step,
              ctx,
              `live target geometry requested a second direction reversal (${priorDirection} to ${nudge})`,
              movements,
              nodes,
            );
          }
          // The target itself is stronger evidence than inferred anchors. One
          // small correction may clear fixed chrome; it consumes the only
          // permitted reversal for this reveal.
          progress = { ...progress, direction: nudge, directionChanges: 1 };
        }
        if (ctx.runtime) {
          invalidateVerifiedScreen(ctx);
        }
        if (nudge === "down") await scrollDown(device, 0.18);
        else await scrollUp(device, 0.18);
        movements.push({ source: "live-target", attemptedDirection: nudge, amount: 0.18 });
        lastAttemptedDirection = nudge;
        ctx.log(`reveal: ${nudge} 0.18 to clear chrome over the live target`);
        previousFingerprint = undefined;
        repeated = 0;
        await sleep(250, device);
        continue;
      }
      if (attempts === maxAttempts) {
        semanticRevealRepair(
          step,
          ctx,
          `semantic target was not found after ${maxAttempts} indexed scrolls`,
          movements,
          nodes,
        );
      }
      const estimate = estimateSemanticRevealMovement(nodes, step.navigation);
      if (!estimate) {
        semanticRevealRepair(
          step,
          ctx,
          "live viewport does not overlap the compiled full-surface semantic index",
          movements,
          nodes,
        );
      }
      const observed = observeScreenIdentity(nodes);
      repeated = observed.fingerprint === previousFingerprint ? repeated + 1 : 0;
      previousFingerprint = observed.fingerprint;
      if (repeated >= 2) {
        semanticRevealRepair(
          step,
          ctx,
          "indexed navigation reached the surface edge without revealing the target",
          movements,
          nodes,
        );
      }
      const authoredDirection =
        step.direction && step.direction !== "auto" ? step.direction : undefined;
      const decision = advanceSemanticRevealNavigation(progress, estimate, authoredDirection);
      if (decision.status === "unsafe") {
        semanticRevealRepair(step, ctx, decision.reason, movements, nodes);
      }
      progress = decision.progress;
      const movement = decision.movement;
      movements.push({
        source: "semantic-index",
        ...movement,
        attemptedDirection: movement.direction,
      });
      lastAttemptedDirection = movement.direction;
      if (ctx.runtime) {
        invalidateVerifiedScreen(ctx);
      }
      if (movement.direction === "down") await scrollDown(device, movement.amount);
      else await scrollUp(device, movement.amount);
      ctx.log(
        `reveal: ${movement.direction} ${movement.amount.toFixed(2)} from semantic surface ${movement.surfaceId}`,
      );
      await sleep(250, device);
    }
  }
  const directions =
    step.direction === "up" ? ["up"] : step.direction === "down" ? ["down"] : ["down", "up"];
  let attempts = 0;
  for (const direction of directions) {
    let previousFingerprint: string | undefined;
    let repeated = 0;
    while (attempts <= maxAttempts) {
      await cooperativeCheckpoint();
      const nodes = ctx.runtime?.observation?.nodes ?? (await snapshot(device));
      if (ctx.runtime && !ctx.runtime.observation) {
        ctx.runtime.observation = { nodes, observedAt: now() };
      }
      if (targetFound(nodes) || resolveSnapshotTargetPoint(nodes, step.target)) {
        ctx.log(
          `reveal: found semantic target after ${attempts} scroll${attempts === 1 ? "" : "s"}`,
        );
        return;
      }
      if (attempts === maxAttempts) break;
      const observed = observeScreenIdentity(nodes);
      repeated = observed.fingerprint === previousFingerprint ? repeated + 1 : 0;
      previousFingerprint = observed.fingerprint;
      if (repeated >= 2) break;
      const suggestedDirection =
        chromeNudge(nodes) ??
        (step.direction === "auto"
          ? resolveSnapshotTargetRevealDirection(nodes, step.target)
          : undefined);
      const nextDirection = suggestedDirection ?? direction;
      const targetedAmount = suggestedDirection ? 0.18 : undefined;
      if (ctx.runtime) {
        invalidateVerifiedScreen(ctx);
      }
      if (nextDirection === "down") await scrollDown(device, targetedAmount);
      else await scrollUp(device, targetedAmount);
      attempts += 1;
      await sleep(250, device);
    }
  }
  throw new Error(`reveal-control: semantic target was not found after ${maxAttempts} scrolls`);
}

export async function runScrollOrRevealStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "scroll" | "reveal" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  if (step.kind === "scroll") {
    invalidateVerifiedScreen(ctx);
    return runSemanticScrollStep(device, step, ctx);
  }
  return runRevealStep(device, step, ctx);
}

export {
  captureSurfaceBaselineDisposition,
  loadFrozenDocumentOriginForCaptureSurface,
} from "./capture-surface-frozen-origin.js";

/** Capture-surface fast restoration is profile-scoped. Reject a missing,
 * generic, browser, or cross-device profile before any runtime fact probe can
 * touch the device. The server preserves viewport-suffixed saved profile IDs
 * in jobs; this guard prevents a manually constructed job from bypassing it. */
export function frozenCaptureSurfaceTargetProfile(
  job: Pick<TestJob, "serial" | "platform" | "targetKind" | "targetProfile">,
): TargetProfile {
  const serial = job.serial?.trim();
  const profile = job.targetProfile;
  const viewport = profile?.viewport;
  if (
    !serial ||
    !profile ||
    job.targetKind === "browser" ||
    profile.source !== "device" ||
    !profile.id.trim() ||
    profile.targetId !== serial ||
    profile.platform !== job.platform ||
    (viewport &&
      (!Number.isSafeInteger(viewport.width) ||
        !Number.isSafeInteger(viewport.height) ||
        viewport.width <= 0 ||
        viewport.height <= 0))
  ) {
    throw new Error("capture-surface requires an exact frozen device target profile");
  }
  return profile;
}

export async function runCaptureSurfaceStep(
  step: Extract<RecipeStep, { kind: "capture-surface" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const job = ctx.job;
  if (!job) throw new Error("capture-surface requires a frozen device target profile");
  const targetProfile = frozenCaptureSurfaceTargetProfile(job);
  const serial = targetProfile.targetId;
  await ensureAndroidSurfaceRuntimeFacts(job);
  const evaluatedAt = now();
  const documentOrigin = await loadFrozenDocumentOriginForCaptureSurface(
    step,
    serial,
    targetProfile.id,
  );
  const baselineDisposition = captureSurfaceBaselineDisposition(step, documentOrigin);
  const baselineRequiresRecapture = baselineDisposition.requiresRecapture;
  if (step.baselineTrust === "trusted" && !documentOrigin) {
    ctx.log(
      `surface: ${step.screenTitle} · frozen document origin is unavailable or absent; using exact inverse restoration only and requiring recapture review`,
    );
  }
  const cacheIdentity = surfaceComparisonCacheIdentity(job, step);
  const cacheKey = cacheIdentity ? surfaceComparisonCacheKey(cacheIdentity) : undefined;
  if (!step.forceRecapture && !baselineRequiresRecapture && cacheIdentity) {
    const cached = findReusableSurfaceComparison({
      identity: cacheIdentity,
      runs: await listPersistedRuns(200),
      currentArtifacts: job.artifacts,
      currentRunId: job.id,
      at: evaluatedAt,
    });
    if (cached) {
      job.artifacts.push({
        kind: "logical-scroll-surface-result",
        capturedAt: evaluatedAt,
        data: { ...cached.data, cache: cached.provenance },
      });
      ctx.log(
        `surface: ${step.screenTitle} · cache hit from run ${cached.provenance.sourceRunId} · ${cached.data.comparison.matches ? "matches baseline" : "repair proposed"}`,
      );
      return;
    }
  }
  const cache: SurfaceComparisonCacheProvenance = step.forceRecapture
    ? {
        schemaVersion: 1,
        status: "bypassed",
        evaluatedAt,
        reason: "Explicit forceRecapture requested fresh device evidence.",
        ...(cacheKey ? { key: cacheKey } : {}),
        ...(cacheIdentity ? { identity: cacheIdentity } : {}),
      }
    : {
        schemaVersion: 1,
        status: "miss",
        evaluatedAt,
        reason: cacheIdentity
          ? "No completed comparison has the exact immutable cache identity."
          : "Exact target, locale, and app build facts are required for reuse.",
        ...(cacheKey ? { key: cacheKey } : {}),
        ...(cacheIdentity ? { identity: cacheIdentity } : {}),
      };
  if (!step.forceRecapture) {
    const data = surfaceComparisonNeedsRecapture({
      step,
      cache: {
        ...cache,
        status: "miss",
        ...(baselineRequiresRecapture
          ? {
              reason:
                baselineDisposition.reason ??
                "The frozen logical-surface baseline is incomplete and must be recaptured before comparison.",
            }
          : {}),
      },
    });
    job.artifacts.push({
      kind: "logical-scroll-surface-needs-recapture",
      capturedAt: evaluatedAt,
      data,
    });
    ctx.log(
      `surface: ${step.screenTitle} · fresh evidence needed · rerun with forceRecapture for ${step.screenId}`,
    );
    return;
  }
  const verified = currentVerifiedScreen(ctx.runtime);
  const screenshot = verified?.screenId === step.screenId ? verified.screenshot : undefined;
  const nodes = verified?.screenId === step.screenId ? verified.nodes : undefined;
  const bounds = nodes?.reduce(
    (current, node) =>
      node.rect
        ? {
            width: Math.max(current.width, node.rect.x + node.rect.width),
            height: Math.max(current.height, node.rect.y + node.rect.height),
          }
        : current,
    { width: 0, height: 0 },
  );
  const initialCapture =
    screenshot && nodes?.length && screenshot.width && screenshot.height
      ? {
          screenshot,
          snapshot: {
            serial,
            capturedAt: screenshot.capturedAt,
            nodes,
            interactive: nodes.filter((node) => node.hittable === true),
            ...(bounds && bounds.width > 0 && bounds.height > 0 ? { bounds } : {}),
            inspectable: true,
            source: "sdk" as const,
            ...(screenshot.foregroundApp ? { foregroundApp: screenshot.foregroundApp } : {}),
            screenIdentity: observeScreenIdentity(nodes),
          },
        }
      : undefined;
  const survey = await captureScrollableSurveyForTarget({
    serial,
    ...(step.maxScrolls === undefined ? {} : { maxScrolls: step.maxScrolls }),
    ...(initialCapture ? { initialCapture } : {}),
    ...(documentOrigin
      ? {
          frozenDocumentOrigin: documentOrigin,
        }
      : {}),
  });
  const surface = await persistLogicalScrollSurface({
    survey,
    targetProfile,
    surfaceId: step.surfaceId,
    capturePolicy: {
      captureMode: "full-surface",
      source: "explicit",
      reason: step.reason,
      decidedAt: survey.frames[0]?.screenshot.capturedAt ?? now(),
    },
  });
  const baseline = step.baseline;
  const heightRatio =
    baseline?.compositeHeight && surface.composite
      ? surface.composite.height / baseline.compositeHeight
      : undefined;
  const semanticRatio = baseline?.semanticNodeCount
    ? surface.mergedTree.nodeCount / baseline.semanticNodeCount
    : undefined;
  const visualMatches =
    !baselineRequiresRecapture &&
    surface.status === "completed" &&
    Boolean(surface.composite) &&
    (baseline?.compositeWidth === undefined ||
      surface.composite?.width === baseline.compositeWidth) &&
    (heightRatio === undefined || (heightRatio >= 0.7 && heightRatio <= 1.3));
  const semanticMatches =
    !baselineRequiresRecapture &&
    (semanticRatio === undefined || (semanticRatio >= 0.65 && semanticRatio <= 1.35));
  const matches = visualMatches && semanticMatches;
  job.artifacts.push({
    kind: "logical-scroll-surface-result",
    capturedAt: surface.capturedAt,
    data: {
      schemaVersion: 1,
      screenId: step.screenId,
      screenTitle: step.screenTitle,
      variantId: step.variantId,
      surfaceId: step.surfaceId,
      baselineCaptureId: step.baselineCaptureId,
      capture: surface,
      comparison: {
        policy: baselineRequiresRecapture ? "recapture-required" : "visual-and-semantic",
        matches,
        visualMatches,
        semanticMatches,
        ...(heightRatio === undefined ? {} : { heightRatio }),
        ...(semanticRatio === undefined ? {} : { semanticRatio }),
      },
      repair: !survey.restoredStartViewport
        ? {
            status: "proposed",
            action: "review-viewport-restore",
            reason: survey.message,
            coverageContinues: true,
          }
        : matches
          ? { status: "not-needed" }
          : {
              status: "proposed",
              action: "propose-recapture",
              reason: baselineRequiresRecapture
                ? (baselineDisposition.reason ??
                  "The frozen logical-surface baseline is incomplete and needs review.")
                : surface.status === "completed"
                  ? "Logical surface differs materially from its frozen baseline."
                  : surface.message,
            },
      cache,
    },
  });
  if (!survey.restoredStartViewport) {
    // Inverse-swipe proof is recorded on the surface artifact. Emitting SOS
    // here looked like a campaign stop and unproved every later Settings child.
    ctx.log(
      `surface: ${step.screenTitle} · restore not proven — ${survey.message} Coverage continues from the current viewport.`,
    );
  } else if (survey.reason === "start-viewport-unproven") {
    ctx.log(
      `surface: ${step.screenTitle} · frozen origin did not match · exact inverse restoration was proven; captured segment needs review before it can become a baseline.`,
    );
  }
  ctx.log(
    `surface: ${step.screenTitle} · ${surface.viewports.length} viewport(s) · ${matches ? "matches baseline" : "repair proposed"}`,
  );
}

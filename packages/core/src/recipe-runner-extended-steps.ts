import { describeSnapshotChrome } from "@relay/protocol";
import type { Device } from "./device.js";
import { replaceText, scrollDown, scrollUp, sleep, snapshot, typeText } from "./device.js";
import { cooperativeCheckpoint } from "./control.js";
import { now } from "./events.js";
import { captureScreenshot } from "./workspace.js";
import { captureScrollableSurveyForTarget } from "./scrollable-survey.js";
import { persistLogicalScrollSurface } from "./logical-scroll-surface.js";
import { listPersistedRuns } from "./runs.js";
import {
  findReusableSurfaceComparison,
  surfaceComparisonCacheIdentity,
  surfaceComparisonCacheKey,
  type SurfaceComparisonCacheProvenance,
} from "./surface-comparison-cache.js";
import { ensureAndroidSurfaceRuntimeFacts } from "./surface-comparison-runtime-facts.js";
import { compareScreenIdentity, observeScreenIdentity } from "./screen-identity.js";
import {
  resolveSnapshotTargetPoint,
  resolveSnapshotTargetRevealDirection,
} from "./device-target-resolution.js";
import {
  resilientScreenIdentityMatch,
  isCancel,
  longPressRecordedTarget,
  tapRecordedTarget,
} from "./recipe-runner-support.js";
import { screenIdentityMatches } from "./recipe-target-match.js";
import type { RecipeStep } from "./recipes.js";
import { invalidateVerifiedScreen, type RecipeStepContext } from "./recipe-runner-context.js";
import { semanticTargetKey } from "./scroll-surface-semantic-index.js";

function liveSemanticKeys(node: Awaited<ReturnType<typeof snapshot>>[number]): string[] {
  return [
    node.identifier ? semanticTargetKey({ identifier: node.identifier }) : undefined,
    node.ref ? semanticTargetKey({ ref: node.ref }) : undefined,
    node.label ? semanticTargetKey({ label: node.label }) : undefined,
    node.value ? semanticTargetKey({ text: node.value }) : undefined,
  ].flatMap((key) => (key ? [key] : []));
}

async function captureCampaignFailureEvidence(
  device: Device,
  check: NonNullable<RecipeStep["check"]>,
  ctx: RecipeStepContext,
  startedAt: number,
  error: string,
  phase: "primary" | "cleanup" = "primary",
): Promise<void> {
  const job = ctx.job;
  if (!job) return;
  const attempts = job.artifacts.flatMap((artifact) =>
    artifact.capturedAt >= startedAt &&
    ["target-resolution", "target-resolution-attempt", "locator-fallback", "locator-heal"].includes(
      artifact.kind,
    )
      ? [{ kind: artifact.kind, capturedAt: artifact.capturedAt, data: artifact.data }]
      : [],
  );
  let nodes: Awaited<ReturnType<typeof snapshot>> = [];
  let accessibilityAvailable = false;
  try {
    nodes = await snapshot(device);
    accessibilityAvailable = true;
  } catch {
    // The action error and screenshot remain useful when AX is unavailable.
  }
  const capturedAt = now();
  job.artifacts.push({
    kind: "campaign-check-evidence",
    capturedAt,
    data: {
      checkId: check.id,
      checkTitle: check.title,
      phase,
      error,
      attempts,
      chrome: describeSnapshotChrome(nodes),
      ...(nodes.length ? { screenIdentity: observeScreenIdentity(nodes) } : {}),
      accessibility: { available: accessibilityAvailable, nodeCount: nodes.length },
      nodes,
    },
  });
  await captureScreenshot({
    jobId: job.id,
    caption: `failed:${phase}:${check.title}`,
    device,
    ...(nodes.length ? { semanticNodes: nodes } : {}),
  }).catch(() => undefined);
}

async function captureCampaignRecoveryIntervention(
  device: Device,
  check: NonNullable<RecipeStep["check"]>,
  ctx: RecipeStepContext,
  transitionId: string,
  reason: string,
): Promise<void> {
  const job = ctx.job;
  if (!job) return;
  let nodes: Awaited<ReturnType<typeof snapshot>> = [];
  let accessibilityAvailable = false;
  try {
    nodes = await snapshot(device);
    accessibilityAvailable = true;
  } catch {
    // Pixels plus the prior action evidence still form a truthful SOS package.
  }
  const caption = `sos:cold-recovery:${transitionId}`;
  const screenshot = await captureScreenshot({
    jobId: job.id,
    caption,
    device,
    ...(nodes.length ? { semanticNodes: nodes } : {}),
  }).catch(() => undefined);
  const capturedAt = now();
  const attempts = job.artifacts
    .filter((artifact) =>
      [
        "target-resolution",
        "target-resolution-attempt",
        "locator-fallback",
        "locator-heal",
      ].includes(artifact.kind),
    )
    .slice(-32)
    .map((artifact) => ({
      kind: artifact.kind,
      capturedAt: artifact.capturedAt,
      data: artifact.data,
    }));
  const recovery = check.recovery;
  const proposal = {
    action: "review-cold-recovery",
    warmRecipeId: recovery?.recipeId,
    proposedColdRecipeId: recovery?.coldRecipeId,
    choices: ["fix-current-state", "teach-semantic-repair", "approve-cold-once", "defer"],
    implicitResumeAllowed: false,
  };
  job.artifacts.push({
    kind: "campaign-recovery-intervention",
    capturedAt,
    data: {
      schemaVersion: 1,
      status: "intervention-required",
      checkId: check.id,
      checkTitle: check.title,
      transitionId,
      reason,
      attemptedSelectors: attempts,
      recovery: proposal,
      chrome: describeSnapshotChrome(nodes),
      ...(nodes.length ? { screenIdentity: observeScreenIdentity(nodes) } : {}),
      accessibility: { available: accessibilityAvailable, nodeCount: nodes.length },
      nodes,
      screenshot: {
        caption,
        ...(screenshot?.framePath ? { framePath: screenshot.framePath } : {}),
        ...(screenshot?.path ? { path: screenshot.path } : {}),
        ...(screenshot?.width ? { width: screenshot.width } : {}),
        ...(screenshot?.height ? { height: screenshot.height } : {}),
      },
    },
  });
  job.artifacts.push({
    kind: "human-intervention-requested",
    capturedAt,
    data: {
      reason: "review",
      message: `Cold recovery blocked for ${check.title}. Review transition ${transitionId}.`,
      resumeLabel: "Review recovery",
      interventionKind: "campaign-cold-recovery",
      checkId: check.id,
      transitionId,
      recovery: proposal,
    },
  });
  ctx.log(`SOS: cold recovery blocked for transition ${transitionId} — intervention required`);
}

function semanticRevealMovement(
  nodes: Awaited<ReturnType<typeof snapshot>>,
  plans: NonNullable<Extract<RecipeStep, { kind: "reveal" }>["navigation"]>,
): { direction: "up" | "down"; amount: number; surfaceId: string } | undefined {
  const candidates = plans.flatMap((plan) => {
    const byKey = new Map(
      plan.anchors.flatMap((anchor) => {
        const key = semanticTargetKey(anchor.target);
        return key ? [[key, anchor] as const] : [];
      }),
    );
    const estimates: number[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      if (!node.rect || node.visibleToUser === false) continue;
      for (const key of liveSemanticKeys(node)) {
        const anchor = byKey.get(key);
        if (!anchor || seen.has(key)) continue;
        seen.add(key);
        estimates.push(anchor.documentY - (node.rect.y + node.rect.height / 2));
        break;
      }
    }
    if (estimates.length === 0) return [];
    estimates.sort((left, right) => left - right);
    const viewportTop = estimates[Math.floor(estimates.length / 2)]!;
    const currentCenter = viewportTop + plan.viewportHeight / 2;
    const delta = plan.targetDocumentY - currentCenter;
    return [{ plan, overlap: estimates.length, delta }];
  });
  const selected = candidates.sort(
    (left, right) => right.overlap - left.overlap || Math.abs(left.delta) - Math.abs(right.delta),
  )[0];
  if (!selected) return undefined;
  return {
    direction: selected.delta < 0 ? "up" : "down",
    amount: Math.max(0.18, Math.min(0.85, Math.abs(selected.delta) / selected.plan.viewportHeight)),
    surfaceId: selected.plan.surfaceId,
  };
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
  if (step.navigation?.length) {
    let previousFingerprint: string | undefined;
    let repeated = 0;
    for (let attempts = 0; attempts <= maxAttempts; attempts += 1) {
      await cooperativeCheckpoint();
      const nodes = ctx.runtime?.observation?.nodes ?? (await snapshot(device));
      if (ctx.runtime && !ctx.runtime.observation) {
        ctx.runtime.observation = { nodes, observedAt: now() };
      }
      if (resolveSnapshotTargetPoint(nodes, step.target)) {
        ctx.log(
          `reveal: found semantic target after ${attempts} indexed scroll${attempts === 1 ? "" : "s"}`,
        );
        return;
      }
      if (attempts === maxAttempts) break;
      const movement = semanticRevealMovement(nodes, step.navigation);
      if (!movement) {
        throw new Error(
          "reveal-control: live viewport does not overlap the compiled full-surface semantic index",
        );
      }
      const observed = observeScreenIdentity(nodes);
      repeated = observed.fingerprint === previousFingerprint ? repeated + 1 : 0;
      previousFingerprint = observed.fingerprint;
      if (repeated >= 2) {
        throw new Error("reveal-control: indexed navigation reached the surface edge");
      }
      const direction =
        step.direction && step.direction !== "auto" ? step.direction : movement.direction;
      if (ctx.runtime) {
        ctx.runtime.observation = undefined;
        ctx.runtime.verifiedScreen = undefined;
      }
      if (direction === "down") await scrollDown(device, movement.amount);
      else await scrollUp(device, movement.amount);
      ctx.log(
        `reveal: ${direction} ${movement.amount.toFixed(2)} from semantic surface ${movement.surfaceId}`,
      );
      await sleep(250, device);
    }
    throw new Error(
      `reveal-control: semantic target was not found after ${maxAttempts} indexed scrolls`,
    );
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
      if (resolveSnapshotTargetPoint(nodes, step.target)) {
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
        step.direction === "auto"
          ? resolveSnapshotTargetRevealDirection(nodes, step.target)
          : undefined;
      const nextDirection = suggestedDirection ?? direction;
      const targetedAmount = suggestedDirection ? 0.18 : undefined;
      if (ctx.runtime) {
        ctx.runtime.observation = undefined;
        ctx.runtime.verifiedScreen = undefined;
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

export async function runCaptureSurfaceStep(
  step: Extract<RecipeStep, { kind: "capture-surface" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const job = ctx.job;
  if (!job?.serial || !job.targetProfile) {
    throw new Error("capture-surface requires a frozen device target profile");
  }
  await ensureAndroidSurfaceRuntimeFacts(job);
  const evaluatedAt = now();
  const cacheIdentity = surfaceComparisonCacheIdentity(job, step);
  const cacheKey = cacheIdentity ? surfaceComparisonCacheKey(cacheIdentity) : undefined;
  if (!step.forceRecapture && cacheIdentity) {
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
  const verified = ctx.runtime?.verifiedScreen;
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
            serial: job.serial,
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
    serial: job.serial,
    ...(step.maxScrolls === undefined ? {} : { maxScrolls: step.maxScrolls }),
    ...(initialCapture ? { initialCapture } : {}),
  });
  const surface = await persistLogicalScrollSurface({
    survey,
    targetProfile: job.targetProfile,
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
    surface.status === "completed" &&
    Boolean(surface.composite) &&
    (baseline?.compositeWidth === undefined ||
      surface.composite?.width === baseline.compositeWidth) &&
    (heightRatio === undefined || (heightRatio >= 0.7 && heightRatio <= 1.3));
  const semanticMatches =
    semanticRatio === undefined || (semanticRatio >= 0.65 && semanticRatio <= 1.35);
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
        policy: "visual-and-semantic",
        matches,
        visualMatches,
        semanticMatches,
        ...(heightRatio === undefined ? {} : { heightRatio }),
        ...(semanticRatio === undefined ? {} : { semanticRatio }),
      },
      repair: matches
        ? { status: "not-needed" }
        : {
            status: "proposed",
            action: "propose-recapture",
            reason:
              surface.status === "completed"
                ? "Logical surface differs materially from its frozen baseline."
                : surface.message,
          },
      cache,
    },
  });
  ctx.log(
    `surface: ${step.screenTitle} · ${surface.viewports.length} viewport(s) · ${matches ? "matches baseline" : "repair proposed"}`,
  );
}

export async function runCampaignCheck(
  device: Device,
  step: RecipeStep & { check: NonNullable<RecipeStep["check"]> },
  ctx: RecipeStepContext,
  execute: (recipeId?: string, bindings?: Record<string, string>) => Promise<void>,
  options: { allowDefer?: boolean } = {},
): Promise<void> {
  const startedAt = now();
  (ctx.runtime ??= {}).campaignCoverageStarted = true;
  const recovery = step.check.recovery;
  const groups = (ctx.runtime.campaignRecoveryGroups ??= {});
  const transitionProofs = (ctx.runtime.campaignTransitionProofs ??= {});
  const transitionDependencies = step.check.transitionDependencies ?? [];
  const openDependency = transitionDependencies.find(
    (dependency) => transitionProofs[dependency.connectionId]?.status === "open",
  );
  if (openDependency) {
    const finishedAt = now();
    const circuit = transitionProofs[openDependency.connectionId]!;
    const dependencyReason = circuit.reason ?? "Shared transition confirmation failed.";
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: finishedAt,
      data: {
        ...step.check,
        status: "blocked",
        error: `Blocked: ${dependencyReason}`,
        dependencyReason,
        dependencyTransitionId: openDependency.connectionId,
        startedAt,
        finishedAt,
      },
    });
    ctx.log(
      `check blocked: ${step.check.title} — transition ${openDependency.connectionId} circuit is open`,
    );
    return;
  }
  const group = recovery ? groups[recovery.groupId] : undefined;
  if (group?.status === "blocked") {
    const finishedAt = now();
    const dependencyReason = group.reason ?? "Shared origin recovery failed.";
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: finishedAt,
      data: {
        ...step.check,
        status: "blocked",
        error: `Blocked: ${dependencyReason}`,
        dependencyReason,
        startedAt,
        finishedAt,
      },
    });
    ctx.log(`check blocked: ${step.check.title} — ${dependencyReason}`);
    return;
  }
  let primaryError: unknown;
  let cleanupError: unknown;
  const transitionToConfirm = transitionDependencies.find(
    (dependency) => transitionProofs[dependency.connectionId]?.status === "needs-confirmation",
  );
  const useCanonicalRecovery = Boolean(
    recovery &&
    (recovery.transitionId
      ? transitionToConfirm?.connectionId === recovery.transitionId
      : ctx.runtime?.campaignItineraryTrusted === false),
  );
  if (recovery && useCanonicalRecovery && recovery.mode !== "warm-transition") {
    const finishedAt = now();
    const transitionId =
      transitionToConfirm?.connectionId ?? recovery.transitionId ?? recovery.groupId;
    const reason =
      transitionProofs[transitionId]?.reason ??
      "The transition origin is unproven and only a cold recovery is available.";
    await captureCampaignRecoveryIntervention(device, step.check, ctx, transitionId, reason);
    transitionProofs[transitionId] = {
      status: "open",
      checkId: step.check.id,
      updatedAt: finishedAt,
      reason,
    };
    groups[recovery.groupId] = { status: "blocked", reason };
    ctx.job?.artifacts.push({
      kind: "campaign-transition-circuit",
      capturedAt: finishedAt,
      data: {
        schemaVersion: 1,
        connectionId: transitionId,
        checkId: step.check.id,
        status: "open",
        reason,
        openedAt: finishedAt,
        recoverySuppressed: true,
      },
    });
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: finishedAt,
      data: {
        ...step.check,
        status: "blocked",
        error: `Blocked: ${reason}`,
        dependencyReason: reason,
        dependencyTransitionId: transitionId,
        startedAt,
        finishedAt,
      },
    });
    return;
  }
  let cleanupPassed = false;
  try {
    if (useCanonicalRecovery) {
      ctx.log(`check recovery: ${step.check.title} — one canonical path`);
    }
    await execute(useCanonicalRecovery ? recovery?.recipeId : undefined);
    if (ctx.runtime) ctx.runtime.campaignItineraryTrusted = true;
  } catch (error) {
    primaryError = error;
    if (!isCancel(error)) {
      const message = error instanceof Error ? error.message : String(error);
      await captureCampaignFailureEvidence(device, step.check, ctx, startedAt, message, "primary");
    }
  } finally {
    const cleanup = step.check.cleanup;
    if (cleanup) {
      const cleanupStartedAt = now();
      if (primaryError && isCancel(primaryError)) {
        ctx.job?.artifacts.push({
          kind: "campaign-check-cleanup",
          capturedAt: cleanupStartedAt,
          data: {
            checkId: step.check.id,
            recipeId: cleanup.recipeId,
            terminalScreenId: cleanup.terminalScreenId,
            status: "skipped",
            reason: "Job cancellation is an immediate authority boundary.",
            startedAt: cleanupStartedAt,
            finishedAt: cleanupStartedAt,
          },
        });
        ctx.log(`check cleanup skipped: ${step.check.title} — job cancelled`);
      } else {
        try {
          await execute(cleanup.recipeId, cleanup.bindings);
          cleanupPassed = true;
          const finishedAt = now();
          ctx.job?.artifacts.push({
            kind: "campaign-check-cleanup",
            capturedAt: finishedAt,
            data: {
              checkId: step.check.id,
              recipeId: cleanup.recipeId,
              terminalScreenId: cleanup.terminalScreenId,
              status: "passed",
              startedAt: cleanupStartedAt,
              finishedAt,
            },
          });
          ctx.log(`check cleanup passed: ${step.check.title}`);
        } catch (error) {
          cleanupError = error;
          const finishedAt = now();
          ctx.job?.artifacts.push({
            kind: "campaign-check-cleanup",
            capturedAt: finishedAt,
            data: {
              checkId: step.check.id,
              recipeId: cleanup.recipeId,
              terminalScreenId: cleanup.terminalScreenId,
              status: isCancel(error) ? "cancelled" : "failed",
              error: error instanceof Error ? error.message : String(error),
              startedAt: cleanupStartedAt,
              finishedAt,
            },
          });
          ctx.log(
            `check cleanup ${isCancel(error) ? "cancelled" : "failed"}: ${step.check.title} — ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  if (primaryError && isCancel(primaryError)) throw primaryError;
  if (cleanupError && isCancel(cleanupError)) throw cleanupError;
  if (!primaryError && !cleanupError) {
    const finishedAt = now();
    if (recovery) groups[recovery.groupId] = { status: "healthy" };
    for (const dependency of transitionDependencies) {
      if (transitionProofs[dependency.connectionId]?.status === "verified") continue;
      transitionProofs[dependency.connectionId] = {
        status: "verified",
        checkId: step.check.id,
        updatedAt: finishedAt,
      };
      ctx.job?.artifacts.push({
        kind: "campaign-transition-proof",
        capturedAt: finishedAt,
        data: {
          schemaVersion: 1,
          tokenId: `${ctx.job.id}:${dependency.connectionId}`,
          connectionId: dependency.connectionId,
          originScreenId: dependency.originScreenId,
          destination: structuredClone(dependency.destination),
          ...(dependency.expectedApp ? { expectedApp: dependency.expectedApp } : {}),
          checkId: step.check.id,
          status: "verified",
          verifiedAt: finishedAt,
        },
      });
    }
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: finishedAt,
      data: { ...step.check, status: "passed", startedAt, finishedAt },
    });
    ctx.log(`check passed: ${step.check.title}`);
    return;
  }

  const primaryMessage = primaryError
    ? primaryError instanceof Error
      ? primaryError.message
      : String(primaryError)
    : undefined;
  const cleanupMessage = cleanupError
    ? cleanupError instanceof Error
      ? cleanupError.message
      : String(cleanupError)
    : undefined;
  const message =
    primaryMessage && cleanupMessage
      ? `Primary failed: ${primaryMessage}; cleanup failed: ${cleanupMessage}`
      : primaryMessage
        ? primaryMessage
        : `Cleanup failed: ${cleanupMessage}`;
  const finishedAt = now();
  if (ctx.runtime) {
    // A successful cleanup proves its explicit terminal screen. Otherwise the
    // current device state is unknown and no later warm path may trust it.
    ctx.runtime.campaignItineraryTrusted = cleanupPassed;
  }
  if (cleanupError) {
    await captureCampaignFailureEvidence(device, step.check, ctx, startedAt, message, "cleanup");
  }
  const failedConfirmationTransitionId =
    useCanonicalRecovery && recovery?.transitionId ? recovery.transitionId : undefined;
  if (failedConfirmationTransitionId) {
    await captureCampaignRecoveryIntervention(
      device,
      step.check,
      ctx,
      failedConfirmationTransitionId,
      message,
    );
    transitionProofs[failedConfirmationTransitionId] = {
      status: "open",
      checkId: step.check.id,
      updatedAt: finishedAt,
      reason: message,
    };
    groups[recovery!.groupId] = { status: "blocked", reason: message };
    ctx.job?.artifacts.push({
      kind: "campaign-transition-circuit",
      capturedAt: finishedAt,
      data: {
        schemaVersion: 1,
        connectionId: failedConfirmationTransitionId,
        checkId: step.check.id,
        status: "open",
        reason: message,
        openedAt: finishedAt,
      },
    });
    ctx.log(
      `transition circuit opened: ${failedConfirmationTransitionId} — canonical confirmation failed`,
    );
  }
  if (recovery && options.allowDefer !== false && !failedConfirmationTransitionId) {
    if (recovery.transitionId) {
      transitionProofs[recovery.transitionId] = {
        status: "needs-confirmation",
        checkId: step.check.id,
        updatedAt: finishedAt,
        reason: message,
      };
      ctx.job?.artifacts.push({
        kind: "campaign-transition-circuit",
        capturedAt: finishedAt,
        data: {
          schemaVersion: 1,
          connectionId: recovery.transitionId,
          checkId: step.check.id,
          status: "needs-confirmation",
          reason: message,
          updatedAt: finishedAt,
        },
      });
    }
    (ctx.runtime!.deferredCampaignChecks ??= []).push({
      check: structuredClone(step.check),
      error: message,
      startedAt,
      deferredAt: finishedAt,
    });
    ctx.job?.artifacts.push({
      kind: "campaign-check-deferred",
      capturedAt: finishedAt,
      data: {
        ...step.check,
        status: "deferred",
        error: message,
        ...(primaryMessage ? { primaryError: primaryMessage } : {}),
        ...(cleanupMessage ? { cleanupError: cleanupMessage } : {}),
      },
    });
    ctx.log(`check deferred: ${step.check.title} — ${message}`);
    return;
  }
  if (recovery && !failedConfirmationTransitionId) {
    groups[recovery.groupId] = { status: "blocked", reason: message };
  }
  ctx.job?.artifacts.push({
    kind: "campaign-check-result",
    capturedAt: finishedAt,
    data: {
      ...step.check,
      status: "failed",
      error: message,
      ...(primaryMessage ? { primaryError: primaryMessage } : {}),
      ...(cleanupMessage ? { cleanupError: cleanupMessage } : {}),
      startedAt,
      finishedAt,
    },
  });
  ctx.log(`check failed: ${step.check.title} — ${message}`);
}

/** Finish the coverage pass without moving the device again. The original
 * failure and its evidence become the terminal result; the saved recovery
 * metadata remains available to an explicit selective-repair run. */
export function finalizeDeferredCampaignChecks(ctx: RecipeStepContext): void {
  const queue = ctx.runtime?.deferredCampaignChecks?.splice(0) ?? [];
  if (queue.length === 0) return;
  ctx.log(
    `${queue.length} campaign check${queue.length === 1 ? "" : "s"} queued for selective repair`,
  );
  for (const deferred of queue) {
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: deferred.deferredAt,
      data: {
        ...deferred.check,
        status: "failed",
        error: deferred.error,
        startedAt: deferred.startedAt,
        finishedAt: deferred.deferredAt,
        selectiveRepair: {
          status: "pending",
          ...(deferred.check.recovery
            ? {
                recipeId: deferred.check.recovery.recipeId,
                groupId: deferred.check.recovery.groupId,
              }
            : {}),
        },
      },
    });
    ctx.log(`check needs repair: ${deferred.check.title} — ${deferred.error}`);
  }
}

export async function retryDeferredCampaignChecks(
  device: Device,
  ctx: RecipeStepContext,
  executeRecipe: (recipeId: string) => Promise<void>,
  budgetMs = 30_000,
): Promise<void> {
  const queue = ctx.runtime?.deferredCampaignChecks?.splice(0) ?? [];
  if (queue.length === 0) return;
  const startedAt = Date.now();
  ctx.log(`retrying ${queue.length} deferred campaign check${queue.length === 1 ? "" : "s"}`);
  for (const deferred of queue) {
    const recovery = deferred.check.recovery;
    if (!recovery) continue;
    if (Date.now() - startedAt >= budgetMs) {
      const at = Date.now();
      ctx.job?.artifacts.push({
        kind: "campaign-check-result",
        capturedAt: at,
        data: {
          ...deferred.check,
          status: "blocked",
          error: "Blocked: deferred retry budget exhausted",
          dependencyReason: `Deferred retry budget exhausted after ${budgetMs}ms.`,
          startedAt: at,
          finishedAt: at,
        },
      });
      ctx.log(`check blocked: ${deferred.check.title} — retry budget exhausted`);
      continue;
    }
    await runCampaignCheck(
      device,
      { kind: "module", recipeId: recovery.recipeId, check: deferred.check },
      ctx,
      () => executeRecipe(recovery.recipeId),
      { allowDefer: false },
    );
  }
}

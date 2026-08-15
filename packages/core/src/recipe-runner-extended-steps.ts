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
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { semanticTargetKey } from "./scroll-surface-semantic-index.js";

function liveSemanticKeys(node: Awaited<ReturnType<typeof snapshot>>[number]): string[] {
  return [
    node.identifier ? semanticTargetKey({ identifier: node.identifier }) : undefined,
    node.ref ? semanticTargetKey({ ref: node.ref }) : undefined,
    node.label ? semanticTargetKey({ label: node.label }) : undefined,
    node.value ? semanticTargetKey({ text: node.value }) : undefined,
  ].flatMap((key) => (key ? [key] : []));
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
      const nodes = await snapshot(device);
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
      const nodes = await snapshot(device);
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
  if (step.kind === "scroll") return runSemanticScrollStep(device, step, ctx);
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
  execute: () => Promise<void>,
  options: { allowDefer?: boolean } = {},
): Promise<void> {
  const startedAt = now();
  const recovery = step.check.recovery;
  const groups = ((ctx.runtime ??= {}).campaignRecoveryGroups ??= {});
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
  try {
    await execute();
    const finishedAt = now();
    if (recovery) groups[recovery.groupId] = { status: "healthy" };
    ctx.job?.artifacts.push({
      kind: "campaign-check-result",
      capturedAt: finishedAt,
      data: { ...step.check, status: "passed", startedAt, finishedAt },
    });
    ctx.log(`check passed: ${step.check.title}`);
  } catch (error) {
    if (isCancel(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = now();
    if (recovery && options.allowDefer !== false) {
      (ctx.runtime!.deferredCampaignChecks ??= []).push({
        check: structuredClone(step.check),
        error: message,
        deferredAt: finishedAt,
      });
      ctx.job?.artifacts.push({
        kind: "campaign-check-deferred",
        capturedAt: finishedAt,
        data: { ...step.check, status: "deferred", error: message },
      });
      ctx.log(`check deferred: ${step.check.title} — ${message}`);
      return;
    }
    if (recovery) groups[recovery.groupId] = { status: "blocked", reason: message };
    if (ctx.job) {
      try {
        const nodes = await snapshot(device);
        ctx.job.artifacts.push({
          kind: "campaign-check-evidence",
          capturedAt: finishedAt,
          data: { checkId: step.check.id, nodes },
        });
      } catch {
        // The error remains useful even if the target cannot provide a tree.
      }
      await captureScreenshot({
        jobId: ctx.job.id,
        caption: `failed:${step.check.title}`,
        device,
      }).catch(() => undefined);
      ctx.job.artifacts.push({
        kind: "campaign-check-result",
        capturedAt: finishedAt,
        data: { ...step.check, status: "failed", error: message, startedAt, finishedAt },
      });
    }
    ctx.log(`check failed: ${step.check.title} — ${message}`);
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

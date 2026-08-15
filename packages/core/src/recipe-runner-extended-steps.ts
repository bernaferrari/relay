import type { Device } from "./device.js";
import { replaceText, scrollDown, scrollUp, sleep, snapshot, typeText } from "./device.js";
import { cooperativeCheckpoint } from "./control.js";
import { now } from "./events.js";
import { captureScreenshot } from "./workspace.js";
import { captureScrollableSurveyForTarget } from "./scrollable-survey.js";
import { persistLogicalScrollSurface } from "./logical-scroll-surface.js";
import { compareScreenIdentity, observeScreenIdentity } from "./screen-identity.js";
import {
  resilientScreenIdentityMatch,
  isCancel,
  longPressRecordedTarget,
  tapRecordedTarget,
} from "./recipe-runner-support.js";
import { screenIdentityMatches } from "./recipe-target-match.js";
import type { RecipeStep } from "./recipes.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";

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

export async function runCaptureSurfaceStep(
  step: Extract<RecipeStep, { kind: "capture-surface" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const job = ctx.job;
  if (!job?.serial || !job.targetProfile) {
    throw new Error("capture-surface requires a frozen device target profile");
  }
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
): Promise<void> {
  const startedAt = now();
  try {
    await execute();
    const finishedAt = now();
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

import type { Device, SnapshotNode } from "./device.js";
import { snapshot, sleep } from "./device.js";
import { now } from "./events.js";
import type { RecipeStep } from "./recipes.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { MAX_WAIT_MS } from "./recipe-validation-primitives.js";
import { describeTarget } from "./recipe-presentation.js";
import { nodeMatchesTarget, sameTarget, textForTarget } from "./recipe-target-match.js";
import {
  captureResponseBoundary,
  quotasAfterBoundary,
  turnsAfterBoundary,
  type ResponseBoundary,
} from "./recipe-response-boundary.js";
import { captureStillScreenFingerprint, stillScreenUnchanged } from "./still-screen-wait.js";

export function recordInitiatingResponseBoundary(
  nodes: readonly SnapshotNode[],
  ctx: RecipeStepContext,
  initiatingActionId?: string,
): ResponseBoundary {
  const boundary = captureResponseBoundary(nodes, "initiating-action", initiatingActionId);
  ctx.runtime ??= {};
  ctx.runtime.responseBoundary = boundary;
  return boundary;
}

function currentActionStarted(
  nodes: SnapshotNode[],
  step: Extract<RecipeStep, { kind: "wait-response" }>,
  boundary: ResponseBoundary | undefined,
  fallback: { changedFromInitial: boolean; emptyToContent: boolean; idleReturned: boolean },
): { started: boolean; quotaOnly: boolean } {
  if (boundary?.source === "initiating-action") {
    const completed = turnsAfterBoundary(nodes, step.target, boundary).filter(
      (turn) => turn.observation === "completed",
    );
    const quota = quotasAfterBoundary(nodes, boundary);
    return {
      started: completed.length > 0 || quota.length > 0,
      quotaOnly: completed.length === 0 && quota.length > 0,
    };
  }
  return {
    started: fallback.changedFromInitial || fallback.emptyToContent || fallback.idleReturned,
    quotaOnly: false,
  };
}

export async function waitForResponseCompletion(
  device: Device,
  step: Extract<RecipeStep, { kind: "wait-response" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const timeoutMs = Math.min(step.timeoutMs ?? 90_000, MAX_WAIT_MS);
  const stableForMs = step.stableForMs ?? 2_000;
  const pollMs = 250;
  const waitBeganAt = now();
  const boundary = ctx.runtime?.responseBoundary;
  const beganAt = boundary?.source === "initiating-action" ? boundary.capturedAt : waitBeganAt;
  const timingBasis =
    boundary?.source === "initiating-action" ? "input-to-readiness" : "wait-to-readiness";
  const deadline = beganAt + timeoutMs;
  const observedInitially = now() < deadline;
  const initialNodes = observedInitially ? await snapshot(device) : [];
  const initialCapturedAt = now();
  const initialText = textForTarget(initialNodes, step.target);
  let previousText = initialText;
  const initiallyIdle = step.idleTarget
    ? initialNodes.some((node) => nodeMatchesTarget(node, step.idleTarget!))
    : false;
  const completionTargetIsIdle = Boolean(
    step.idleTarget && sameTarget(step.target, step.idleTarget),
  );
  let sawIdleLeave = !initiallyIdle;
  const initialAction = currentActionStarted(initialNodes, step, boundary, {
    changedFromInitial: false,
    emptyToContent: false,
    idleReturned: false,
  });
  const leftoverComplete =
    Boolean(initialText && initiallyIdle && !completionTargetIsIdle) &&
    boundary?.source !== "initiating-action";
  let startedAt: number | undefined =
    leftoverComplete || initialAction.started ? initialCapturedAt : undefined;
  let quotaOnly = initialAction.quotaOnly;
  let stableSince: number | undefined = startedAt;
  let samples = observedInitially ? 1 : 0;
  let lastSignals: string[] = startedAt
    ? ["response-started", ...(initiallyIdle ? ["idle-visible"] : [])]
    : [];
  const pollDiagnostics: Array<Record<string, unknown>> = [];
  const firstPollDiagnostics: Array<Record<string, unknown>> = [];
  let previousPixels: string | undefined;

  if (startedAt && leftoverComplete) {
    ctx.log(`response completion: content already complete (${initialText.length} characters)`);
  } else if (startedAt) {
    ctx.log(`response completion: content started (${initialText.length} characters)`);
  }

  const record = (status: "complete" | "timeout", completedAt: number, text: string) => {
    ctx.job?.artifacts.push({
      kind: "response-completion",
      capturedAt: completedAt,
      data: {
        status,
        timingBasis,
        beganAt,
        waitBeganAt,
        deadline,
        startedAt,
        completedAt,
        durationMs: completedAt - beganAt,
        stableForMs,
        timeoutMs,
        ...(step.maxMs !== undefined ? { maxMs: step.maxMs } : {}),
        ...(boundary?.initiatingActionId
          ? { initiatingActionId: boundary.initiatingActionId }
          : {}),
        samples,
        signals: lastSignals,
        observedCharacters: text.length,
        usedBusyTarget: Boolean(step.busyTarget),
        usedIdleTarget: Boolean(step.idleTarget),
        pollDiagnostics: [
          ...new Map(
            [...firstPollDiagnostics, ...pollDiagnostics].map((entry) => [entry.sample, entry]),
          ).values(),
        ],
      },
    });
  };

  const finish = (capturedAt: number, text: string) => {
    record("complete", capturedAt, text);
    ctx.log(`response completion: complete · ${lastSignals.join(" + ")}`);
    if (quotaOnly) {
      throw new Error("response completion: quota or error, no completed assistant turn");
    }
    if (step.maxMs !== undefined && capturedAt - beganAt > step.maxMs) {
      throw new Error(
        `response completion: exceeded maxMs ${step.maxMs} (${capturedAt - beganAt}ms)`,
      );
    }
  };

  if (initialCapturedAt < deadline && startedAt && leftoverComplete && stableForMs <= 0) {
    finish(initialCapturedAt, initialText);
    return;
  }

  while (now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())), device);
    if (now() >= deadline) break;
    const nodes = await snapshot(device);
    const capturedAt = now();
    // A slow read cannot make evidence arriving after the budget look timely.
    if (capturedAt >= deadline) break;
    samples += 1;
    const text = textForTarget(nodes, step.target);
    const matched = nodes.filter((node) => nodeMatchesTarget(node, step.target));
    const diagnostic = {
      sample: samples,
      characters: text.length,
      matchedCount: matched.length,
      matchedNodes: matched.slice(0, 8).map((node) => ({
        role: node.role ?? node.type,
        ...(node.identifier ? { identifier: node.identifier } : {}),
      })),
    };
    if (firstPollDiagnostics.length < 3) firstPollDiagnostics.push(diagnostic);
    pollDiagnostics.push(diagnostic);
    if (pollDiagnostics.length > 3) pollDiagnostics.shift();
    const changedFromInitial = text.length > 0 && text !== initialText;
    const idleVisible = step.idleTarget
      ? nodes.some((node) => nodeMatchesTarget(node, step.idleTarget!))
      : false;
    if (step.idleTarget && !idleVisible) sawIdleLeave = true;
    const action = currentActionStarted(nodes, step, boundary, {
      changedFromInitial,
      emptyToContent: !initialText && text.length > 0,
      idleReturned: completionTargetIsIdle && sawIdleLeave && idleVisible && text.length > 0,
    });

    if (!startedAt && action.started) {
      startedAt = capturedAt;
      stableSince = capturedAt;
      quotaOnly = action.quotaOnly;
      ctx.log(`response completion: content started (${text.length} characters)`);
    }
    if (startedAt) {
      quotaOnly = action.quotaOnly;
      if (text !== previousText) stableSince = capturedAt;
      const stable = Boolean(text && stableSince && capturedAt - stableSince >= stableForMs);
      const busyGone = step.busyTarget
        ? !nodes.some((node) => nodeMatchesTarget(node, step.busyTarget!))
        : false;
      lastSignals = [
        "response-started",
        ...(stable ? ["text-stable"] : []),
        ...(busyGone ? ["busy-gone"] : []),
        ...(idleVisible ? ["idle-visible"] : []),
        ...(quotaOnly ? ["quota-or-error"] : []),
      ];
      const hasIndependentCompletionTarget = Boolean(step.busyTarget || step.idleTarget);
      const completionSignal = step.busyTarget ? busyGone : idleVisible;
      if (stable && (!hasIndependentCompletionTarget || completionSignal || quotaOnly)) {
        finish(capturedAt, text);
        return;
      }
    }
    previousText = text;
    if (!startedAt) {
      const fingerprint = await captureStillScreenFingerprint(device);
      if (stillScreenUnchanged(previousPixels, fingerprint)) {
        ctx.log(
          `wait-response: pixels unchanged after ${capturedAt - beganAt}ms waiting for ${describeTarget(step.target)}`,
        );
      }
      previousPixels = fingerprint ?? previousPixels;
    }
  }

  record("timeout", now(), previousText);
  throw new Error(
    `response completion: timed out after ${Math.round(timeoutMs / 1000)}s (${lastSignals.join(" + ") || "no response observed"})`,
  );
}

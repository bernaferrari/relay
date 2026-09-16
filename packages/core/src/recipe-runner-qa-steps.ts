import { readFile, copyFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { RecipeStep, SemanticEvaluationResult } from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";
import { currentTargetContext, selectedPlatform, targetIdentity } from "./target-context.js";
import { execAndroidAdb } from "./android-adb-host.js";
import {
  cooperativeCheckpoint,
  getExecutingJobId,
  raceCancel,
  throwIfCancelled,
} from "./control.js";
import { runTargetMutation } from "./target-control.js";
import { pressKey, sleep, type Device } from "./device.js";
import { openAppAndVerifyForeground } from "./recipe-runner-app.js";
import { captureScreenshot, cleanupScreenshot } from "./workspace-capture.js";
import { evaluateVisual } from "./evaluation-visual.js";
import { formatEvaluationCost } from "./evaluation.js";
import { now } from "./events.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { applyBrowserOffline, uploadBrowserFile } from "./browser-live-controls.js";
import { describeTarget } from "./recipes.js";

function logEvaluation(
  log: (line: string) => void,
  artifactKind: string,
  result: SemanticEvaluationResult,
): void {
  log(
    `${artifactKind}: ${result.status} · ${result.score.toFixed(2)} · ${result.summary}${formatEvaluationCost(result.costUsd)}`,
  );
}

function judgeReasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function throwJudgeOutcome(reason: unknown, prefix: string): never {
  const summary = judgeReasonMessage(reason);
  if (/judge unavailable/i.test(summary)) {
    throw reason instanceof Error ? reason : new Error(summary);
  }
  throw new Error(`judge uncertain: ${prefix}: ${summary}`);
}

export async function runJudgeConsensus(
  evaluate: (provider?: string, model?: string) => Promise<SemanticEvaluationResult>,
  step: {
    provider?: string;
    model?: string;
    requireAgreement?: boolean;
    secondProvider?: string;
    secondModel?: string;
  },
  ctx: RecipeStepContext,
  artifactKind: "semantic-evaluation" | "visual-evaluation",
  failPrefix: string,
): Promise<void> {
  const job = ctx.job;
  const log = ctx.log;
  const prior = job?.artifacts ?? ctx.artifacts ?? [];
  if (
    prior.some(
      (item) =>
        item.kind === "content-assertion" &&
        item.data &&
        typeof item.data === "object" &&
        "passed" in item.data &&
        (item.data as { passed?: boolean }).passed === false,
    )
  ) {
    throw new Error("deterministic content assertion already failed");
  }
  if (
    prior.some(
      (item) =>
        item.kind === "conversation-turn" &&
        item.data &&
        typeof item.data === "object" &&
        "observation" in item.data &&
        (item.data as { observation?: string }).observation !== "completed",
    )
  ) {
    throw new Error("deterministic content assertion already failed");
  }
  if (!step.requireAgreement) {
    const result = await evaluate(step.provider, step.model);
    (job?.artifacts ?? ctx.artifacts)?.push({
      kind: artifactKind,
      capturedAt: now(),
      data: result,
    });
    logEvaluation(log, artifactKind, result);
    if (result.status === "uncertain") throw new Error(`judge uncertain: ${result.summary}`);
    if (result.status === "fail") throw new Error(`${failPrefix}: ${result.summary}`);
    return;
  }
  const [firstOutcome, secondOutcome] = await Promise.allSettled([
    evaluate(step.provider, step.model),
    evaluate(step.secondProvider, step.secondModel),
  ]);
  if (firstOutcome.status === "rejected") {
    const summary = `Primary judge unavailable: ${judgeReasonMessage(firstOutcome.reason)}`;
    job?.artifacts.push({
      kind: "judge-consensus",
      capturedAt: now(),
      data: {
        status: "uncertain",
        error: summary,
        second:
          secondOutcome.status === "fulfilled"
            ? { ...secondOutcome.value, judge: "independent" }
            : undefined,
      },
    });
    throwJudgeOutcome(firstOutcome.reason, "Primary judge unavailable");
  }
  const result = firstOutcome.value;
  (job?.artifacts ?? ctx.artifacts)?.push({ kind: artifactKind, capturedAt: now(), data: result });
  logEvaluation(log, artifactKind, result);
  if (secondOutcome.status === "rejected") {
    const summary = `Independent judge unavailable: ${judgeReasonMessage(secondOutcome.reason)}`;
    job?.artifacts.push({
      kind: "judge-consensus",
      capturedAt: now(),
      data: { status: "uncertain", first: result, error: summary },
    });
    throwJudgeOutcome(secondOutcome.reason, "Independent judge unavailable");
  }
  const second = secondOutcome.value;
  job?.artifacts.push({
    kind: artifactKind,
    capturedAt: now(),
    data: { ...second, judge: "independent" },
  });
  const agreed = result.status === second.status;
  job?.artifacts.push({
    kind: "judge-consensus",
    capturedAt: now(),
    data: { status: agreed ? result.status : "uncertain", agreed, first: result, second },
  });
  if (!agreed) {
    throw new Error(
      `judge uncertain: judges disagree (${result.provider}: ${result.status}; ${second.provider}: ${second.status})`,
    );
  }
  if (result.status === "uncertain") throw new Error(`judge uncertain: ${result.summary}`);
  if (result.status === "fail") throw new Error(`${failPrefix}: ${result.summary}`);
}

export function runIdentityIgnoreStep(
  step: Extract<RecipeStep, { kind: "identity-ignore" }>,
  ctx: RecipeStepContext,
  bind?: { stepId?: string; screenId?: string; checkpointId?: string },
): void {
  if (!ctx.runtime) throw new Error("identity-ignore: recipe runtime is required");
  const frameIndex = ctx.job?.frames?.length ?? 0;
  const region = {
    ...step.region,
    ...(step.name ? { name: step.name } : {}),
    ...(step.id ? { authoredStepId: step.id } : {}),
    frameIndex,
    ...(bind?.stepId ? { stepId: bind.stepId } : {}),
    ...(bind?.screenId ? { screenId: bind.screenId } : {}),
    ...(bind?.checkpointId ? { checkpointId: bind.checkpointId } : {}),
  };
  ctx.runtime.identityIgnoreRegions = [...(ctx.runtime.identityIgnoreRegions ?? []), region];
  (ctx.job?.artifacts ?? ctx.artifacts)?.push({
    kind: "identity-ignore",
    capturedAt: now(),
    data: {
      ...region,
      // Provenance for the identity step. Not a visual exclusion or review mask.
    },
  });
  ctx.log(
    `identity-ignore: ${step.name ?? "region"} ${step.region.x},${step.region.y},${step.region.width},${step.region.height}`,
  );
}

export async function runEvaluateVisualStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "evaluate-visual" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const shot = await captureScreenshot({ device, ephemeral: true, includeScreenMatch: false });
  try {
    const png = Buffer.from(shot.base64, "base64");
    const sha256 = createHash("sha256").update(png).digest("hex");
    let path = shot.path;
    if (ctx.job?.runDir) {
      const dest = join(ctx.job.runDir, `judged-visual-${sha256.slice(0, 12)}.png`);
      await copyFile(shot.path, dest);
      path = dest;
    }
    (ctx.job?.artifacts ?? ctx.artifacts)?.push({
      kind: "judged-image",
      capturedAt: now(),
      data: { mimeType: "image/png", sha256, bytes: png.byteLength, path },
    });
    await runJudgeConsensus(
      (provider, model) =>
        evaluateVisual({
          criteria: step.criteria,
          threshold: step.threshold,
          provider,
          model,
          image: { mimeType: "image/png", data: shot.base64 },
          region: step.region,
        }),
      step,
      ctx,
      "visual-evaluation",
      "visual assertion",
    );
  } finally {
    await cleanupScreenshot(shot.path);
  }
}

export async function runOfflineStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "offline" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  await applyBrowserOffline(step.state === "on", device);
  ctx.log(`browser network: ${step.state === "on" ? "offline" : "online"}`);
}

function resolveUploadFile(file: string): string {
  return isAbsolute(file) ? file : resolve(findWorkspaceRoot(), file);
}

export async function runUploadStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "upload" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const path = resolveUploadFile(step.file);
  await readFile(path);
  const context = currentTargetContext();
  if (context.kind === "browser") {
    await uploadBrowserFile(path, step.target, device);
    ctx.log(`upload: attached ${path}${step.target ? ` to ${describeTarget(step.target)}` : ""}`);
    return;
  }
  if (selectedPlatform() !== "android") {
    throw new Error(
      "upload on iOS requires a reviewed Files-app handoff; disable this step or record that path",
    );
  }
  const serial = targetIdentity();
  const name = path.split("/").pop() ?? "upload.bin";
  const remote = `/sdcard/Download/${name}`;
  await cooperativeCheckpoint();
  throwIfCancelled();
  await runTargetMutation(serial, getExecutingJobId(), () =>
    raceCancel(execAndroidAdb(["-s", serial, "push", path, remote], { timeout: 30_000 })),
  );
  ctx.job?.artifacts.push({
    kind: "upload",
    capturedAt: now(),
    data: { file: path, remote, platform: "android" },
  });
  ctx.log(`upload: pushed ${name} to ${remote}`);
}

export async function runAppBackgroundStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "app" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const ms = Math.min(Math.max(step.backgroundMs ?? 1_000, 0), 300_000);
  await pressKey(device, "home");
  ctx.log(`app background: home for ${ms}ms`);
  if (ms > 0) await sleep(ms, device);
  const app = step.app?.trim();
  if (app) await openAppAndVerifyForeground(device, app, { relaunch: false }, ctx.log);
}

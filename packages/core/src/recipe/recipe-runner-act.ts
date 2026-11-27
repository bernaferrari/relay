/**
 * Plain-English `act` steps. The model never touches the target directly: it
 * picks concrete actions from the live UI tree — or, as a bounded fallback, a
 * screenshot coordinate — and the runner executes them as ordinary recipe
 * steps so tracing, target resolution, cancellation, and evidence stay
 * identical to recorded steps.
 */
import type { RecipeStep } from "@relay/protocol";
import { snapshot, type Device } from "../device/device.js";
import { captureScreenshot, cleanupScreenshot } from "../workspace/workspace-capture.js";
import { createModelClient } from "../model/model-provider.js";
import { now } from "../collaboration/events.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { isCancel } from "./recipe-runner-support.js";
import { unknownErrorText } from "../unknown-text.js";
import { describeRecipeStep } from "./recipe-presentation.js";
import { rethrowIosMutationOutcomeUnknown } from "../ios/ios-mutation-policy.js";
import { rethrowInputOutcomeUnknown } from "../device/input-not-dispatched.js";
import { savedPathStepsAreExecutable } from "../app-map/act-cache-steps.js";
import { browserSessionForDevice } from "../browser/browser-live-handles.js";
import {
  actCandidates,
  actDecisionSchema,
  actPrompt,
  concreteStepsForDecision,
  normalizeActDecision,
  type ActAtomicDecision,
  type ActCandidate,
  type ActDecision,
  type ActObservationGeometry,
} from "./recipe-runner-act-decision.js";
import {
  assertSignInActDecision,
  prepareActiveSignIn,
  scrubSignInCandidates,
  scrubSignInText,
  signInCachedStepsAreExecutable,
  signInPromptLines,
} from "./recipe-runner-act-sign-in.js";
import {
  assertInboxCodeActDecision,
  inboxCodePromptLines,
  scrubInboxCodeCandidates,
  scrubInboxCodeText,
} from "./recipe-runner-act-inbox.js";

export const DEFAULT_ACT_MAX_ACTIONS = 5;

export {
  actCandidates,
  concreteStepsForDecision,
  normalizeActDecision,
  MAX_CANDIDATES,
} from "./recipe-runner-act-decision.js";
export type {
  ActAtomicDecision,
  ActCandidate,
  ActDecision,
  ActObservationGeometry,
} from "./recipe-runner-act-decision.js";

export type ActDecisionInput = {
  intent: string;
  candidates: ActCandidate[];
  history: string[];
  screenshot?: { mimeType: string; data: string };
  model?: string;
  geometry?: ActObservationGeometry;
  /** Non-secret authentication context. Secret values are never part of a prompt. */
  auth?: { type: "sign-in"; accountKey: string } | { type: "inbox-code"; inboxKey: string };
};

export type ActDecider = (input: ActDecisionInput) => Promise<ActDecision>;

let registeredDecider: ActDecider | undefined;

/** Test seam and local-provider hook. Returns an unregister function. */
export function registerActDecider(decider: ActDecider): () => void {
  registeredDecider = decider;
  return () => {
    if (registeredDecider === decider) registeredDecider = undefined;
  };
}

async function decideViaModel(input: ActDecisionInput): Promise<ActDecision> {
  const { sdk, provider, model } = await createModelClient("act", {
    ...(input.model ? { model: input.model } : {}),
    httpReferer: process.env.OPENROUTER_HTTP_REFERER,
    appTitle: process.env.OPENROUTER_APP_TITLE ?? "Relay",
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "ModelProviderNotConfiguredError") {
      throw new Error(
        "This step is written in plain English and needs a model. Configure a model provider in Settings, or record the step.",
      );
    }
    throw error;
  });
  const generated = await sdk.generateObject({
    model: provider.chat(model),
    schema: actDecisionSchema,
    schemaName: "relay_act_decision",
    maxRetries: 1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: actPrompt({
              intent: input.intent,
              candidates: input.candidates,
              history: input.history,
              ...(input.geometry ? { geometry: input.geometry } : {}),
              coordinateActuation: input.geometry !== undefined,
              extraLines: [
                ...(input.auth?.type === "sign-in" ? signInPromptLines(input.auth.accountKey) : []),
                ...(input.auth?.type === "inbox-code"
                  ? inboxCodePromptLines(input.auth.inboxKey)
                  : []),
              ],
            }),
          },
          ...(input.screenshot
            ? [
                {
                  type: "file" as const,
                  data: Buffer.from(input.screenshot.data, "base64"),
                  mediaType: input.screenshot.mimeType,
                },
              ]
            : []),
        ],
      },
    ],
  });
  return normalizeActDecision(generated.object);
}

export type ActObservation = {
  candidates: ActCandidate[];
  screenshot?: { mimeType: string; data: string };
  geometry?: ActObservationGeometry;
};

export type ActObservationOptions = { includeScreenshot?: boolean };

/** PNG width/height live at fixed offsets in the IHDR chunk: bytes 16–24. */
export function pngDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 24 || buffer.readUInt32BE(12) !== 0x49484452) return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * The affine mapping between the screenshot the model sees and the logical
 * coordinates actuation uses. Only browser targets can prove it today: the
 * screenshot is exactly the viewport raster, so image pixels scale uniformly
 * into the page's CSS pixel space. Anything else — a missing session, a
 * non-uniform ratio — disables coordinate conversion rather than guessing.
 */
export function browserActObservationGeometry(
  device: Device,
  screenshot: { data: string } | undefined,
): ActObservationGeometry | undefined {
  if (!screenshot) return undefined;
  const session = browserSessionForDevice(device);
  if (!session) return undefined;
  const viewport = session.page.viewportSize();
  const dims = pngDimensions(Buffer.from(screenshot.data, "base64"));
  if (!viewport || !dims || viewport.width <= 0 || viewport.height <= 0) return undefined;
  const scaleX = dims.width / viewport.width;
  const scaleY = dims.height / viewport.height;
  if (scaleX <= 0 || Math.abs(scaleX - scaleY) / scaleX > 0.02) return undefined;
  return {
    scale: scaleX,
    imageWidth: dims.width,
    imageHeight: dims.height,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  };
}

async function observe(
  device: Device,
  options: ActObservationOptions = {},
): Promise<ActObservation> {
  const nodes = await snapshot(device, { interactiveOnly: false });
  let screenshot: { mimeType: string; data: string } | undefined;
  if (options.includeScreenshot !== false) {
    try {
      const shot = await captureScreenshot({ device, ephemeral: true, includeScreenMatch: false });
      screenshot = { mimeType: "image/png", data: shot.base64 };
      await cleanupScreenshot(shot.path);
    } catch {
      screenshot = undefined;
    }
  }
  const geometry = browserActObservationGeometry(device, screenshot);
  return {
    candidates: actCandidates(nodes, geometry),
    ...(screenshot ? { screenshot } : {}),
    ...(geometry ? { geometry } : {}),
  };
}

export type ActStepResolutionEvidence = { strategy: string; key?: string };

function resolutionEvidence(data: unknown): ActStepResolutionEvidence | undefined {
  const value = data as { strategy?: unknown; target?: Record<string, unknown> } | undefined;
  if (typeof value?.strategy !== "string" || !value.strategy) return undefined;
  const keyed = value.target?.[value.strategy];
  const fallback = ["identifier", "ref", "label", "text"]
    .map((field) => value.target?.[field])
    .find((item) => typeof item === "string" && item.trim());
  const key = typeof keyed === "string" && keyed.trim() ? keyed : fallback;
  return {
    strategy: value.strategy,
    ...(typeof key === "string" && key.trim() ? { key: key.trim() } : {}),
  };
}

export type ActScreenObserver = (
  device: Device,
  options?: ActObservationOptions,
) => Promise<ActObservation>;

/** Decisions that need coordinates the current target cannot honor. */
function decisionNeedsUnavailableGeometry(
  decision: ActDecision,
  geometry: ActObservationGeometry | undefined,
): boolean {
  if (geometry) return false;
  const atomicPoint = (item: ActAtomicDecision) =>
    (item.action === "tap" || item.action === "hover") &&
    item.point !== undefined &&
    !item.candidateId;
  if (decision.action === "batch") return decision.actions.some(atomicPoint);
  if (decision.action === "done" || decision.action === "impossible") return false;
  return atomicPoint(decision);
}

async function runActStepLoop(
  device: Device,
  step: Extract<RecipeStep, { kind: "act" }>,
  ctx: RecipeStepContext,
  runConcrete: (concrete: RecipeStep) => Promise<void>,
  observeScreen: ActScreenObserver,
  inboxCodePolicy?: { inboxKey: string },
): Promise<void> {
  const signIn = step.auth?.type === "sign-in" ? ctx.runtime?.activeSignIn : undefined;
  const inboxCode = inboxCodePolicy ? ctx.runtime?.activeInboxCode : undefined;
  if (inboxCodePolicy && (!inboxCode || inboxCode.inboxKey !== inboxCodePolicy.inboxKey)) {
    throw new Error(`Test inbox code "${inboxCodePolicy.inboxKey}" is not active in this run`);
  }
  const secretText = (value: string) =>
    signIn
      ? scrubSignInText(value, signIn)
      : inboxCode
        ? scrubInboxCodeText(value, inboxCode)
        : value;
  const decide = registeredDecider ?? decideViaModel;
  const max = Math.max(1, Math.min(step.maxActions ?? DEFAULT_ACT_MAX_ACTIONS, 20));
  const history: string[] = [];
  const executed: RecipeStep[] = [];
  const resolutions: (ActStepResolutionEvidence | null)[] = [];
  const sink = () => ctx.job?.artifacts ?? ctx.artifacts;
  const record = (data: Record<string, unknown>) =>
    sink()?.push({
      kind: "act-decision",
      capturedAt: now(),
      data: { intent: step.intent, ...(step.id ? { recipeStepId: step.id } : {}), ...data },
    });
  /** What carried out the step, so a later run can replay it without a model. */
  const finish = (source: "cache" | "model") => {
    sink()?.push({
      kind: "act-result",
      capturedAt: now(),
      data: {
        intent: step.intent,
        ...(step.id ? { recipeStepId: step.id } : {}),
        source,
        steps: structuredClone(executed),
        resolutions: structuredClone(resolutions),
      },
    });
  };
  const runAndKeep = async (concrete: RecipeStep) => {
    const artifacts = sink();
    const before = artifacts?.length ?? 0;
    await runConcrete(concrete);
    executed.push(concrete);
    const emitted = artifacts?.slice(before) ?? [];
    const hit = emitted.find((artifact) => artifact.kind === "target-resolution");
    resolutions.push(hit ? (resolutionEvidence(hit.data) ?? null) : null);
  };

  // Replay what worked last time; ask the model only if the screen changed.
  // A sign-in path is cacheable only when every typed value is an opaque
  // secret reference. Anything else is ignored without being echoed.
  const cached =
    step.cached?.length && (!signIn || signInCachedStepsAreExecutable(step.cached))
      ? step.cached
      : undefined;
  if (cached?.length && savedPathStepsAreExecutable(cached, "action")) {
    try {
      for (const concrete of cached) await runAndKeep(structuredClone(concrete));
      record({ action: "cached", steps: cached });
      ctx.log(`act: replayed ${cached.length} saved action(s) for “${step.intent}”`);
      finish("cache");
      return;
    } catch (error) {
      // Never retry around a cancel, or an input whose outcome is unknown.
      if (isCancel(error)) throw error;
      rethrowIosMutationOutcomeUnknown(error);
      rethrowInputOutcomeUnknown(error);
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = secretText(rawMessage);
      record({ action: "cache-miss", reason: message, replayed: executed.length });
      ctx.log(`act: saved path no longer fits (${message}); asking the model`);
      history.push(...executed.map((concrete) => describeRecipeStep(concrete)));
    }
  }
  for (let attempt = 0; attempt <= max; attempt += 1) {
    const observation = await observeScreen(device, {
      includeScreenshot: signIn === undefined && inboxCode === undefined,
    });
    const candidates = signIn
      ? scrubSignInCandidates(observation.candidates, signIn)
      : inboxCode
        ? scrubInboxCodeCandidates(observation.candidates, inboxCode)
        : observation.candidates;
    // Conservative sign-in discipline: even a custom observation hook never
    // supplies pixels to the model while credentials are active.
    const screenshot = signIn || inboxCode ? undefined : observation.screenshot;
    const geometry = signIn || inboxCode ? undefined : observation.geometry;
    const decision = await decide({
      intent: step.intent,
      candidates,
      history,
      ...(screenshot ? { screenshot } : {}),
      ...(geometry ? { geometry } : {}),
      ...(step.model ? { model: step.model } : {}),
      ...(signIn
        ? { auth: { type: "sign-in" as const, accountKey: signIn.accountKey } }
        : inboxCode
          ? { auth: { type: "inbox-code" as const, inboxKey: inboxCode.inboxKey } }
          : {}),
    });
    if (signIn) assertSignInActDecision(decision, candidates);
    if (inboxCode) assertInboxCodeActDecision(decision, candidates);
    const reason = secretText(decision.reason);
    if (decision.action === "done") {
      record({ action: "done", reason, history });
      ctx.log(`act: done — ${reason}`);
      finish("model");
      return;
    }
    if (decision.action === "impossible") {
      record({ action: "impossible", reason, history });
      throw new Error(`Could not ${lowerFirst(step.intent)}: ${reason}`);
    }
    if (decisionNeedsUnavailableGeometry(decision, geometry)) {
      // Coordinate actuation without a proven screenshot-to-logical mapping
      // would be a guess at physical geometry. That fails closed: the model
      // is told why, and the refusal consumes one attempt like any action.
      const feedback =
        "Visual coordinate actuation is unavailable on this target; choose a semantic candidate instead";
      record({ action: "coordinate-unavailable", reason: feedback });
      ctx.log(`act: ${feedback}`);
      history.push(feedback);
      if (attempt === max) break;
      continue;
    }
    if (attempt === max) break;
    const {
      steps,
      summary: decisionSummary,
      coordinateVisual,
    } = concreteStepsForDecision(decision, candidates, geometry);
    const summary = secretText(decisionSummary);
    record({
      action: decision.action,
      summary,
      reason,
      steps,
      ...(coordinateVisual ? { coordinateVisual: true } : {}),
      ...(decision.action === "batch" ? { batchSize: decision.actions.length } : {}),
    });
    ctx.log(`act: ${summary} — ${reason}`);
    if (decision.action === "batch") {
      // Per-item failure honesty: the batch aborts at the first failure and
      // the evidence names exactly which items ran. Items after the failure
      // did not happen, and nothing claims they did.
      const executedBefore = executed.length;
      let batchFailure: unknown;
      try {
        for (const concrete of steps) await runAndKeep(concrete);
      } catch (error) {
        batchFailure = error;
      }
      const ranSteps = executed.length - executedBefore;
      history.push(summary);
      if (batchFailure !== undefined) {
        record({
          action: "batch-failed",
          summary,
          reason: secretText(unknownErrorText(batchFailure)),
          executedSteps: ranSteps,
          totalSteps: steps.length,
        });
        throw batchFailure;
      }
    } else {
      for (const concrete of steps) await runAndKeep(concrete);
      history.push(summary);
    }
    if ("finishesIntent" in decision && decision.finishesIntent) {
      finish("model");
      return;
    }
  }
  throw new Error(
    `Could not ${lowerFirst(step.intent)} within ${max} actions (tried: ${history.join(", ") || "nothing"})`,
  );
}

export async function runInboxCodeActStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "act" }>,
  ctx: RecipeStepContext,
  runConcrete: (concrete: RecipeStep) => Promise<void>,
  inboxKey: string,
  observeScreen: ActScreenObserver = observe,
): Promise<void> {
  await runActStepLoop(device, step, ctx, runConcrete, observeScreen, { inboxKey });
}

export async function runActStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "act" }>,
  ctx: RecipeStepContext,
  runConcrete: (concrete: RecipeStep) => Promise<void>,
  observeScreen: ActScreenObserver = observe,
): Promise<void> {
  if (step.auth?.type !== "sign-in") {
    return runActStepLoop(device, step, ctx, runConcrete, observeScreen);
  }
  ctx.runtime ??= {};
  const active = await prepareActiveSignIn({ ctx, accountKey: step.auth.accountKey });
  // The active account deliberately remains in the run-local runtime after
  // this act. A later test-inbox step in the same run uses its start time and
  // inbox link; the runtime object itself is discarded when the run ends.
  ctx.runtime.activeSignIn = active;
  await runActStepLoop(device, step, ctx, runConcrete, observeScreen);
}

function lowerFirst(text: string): string {
  const trimmed = text.trim().replace(/[.!]+$/u, "");
  return trimmed ? trimmed[0]!.toLowerCase() + trimmed.slice(1) : "complete this step";
}

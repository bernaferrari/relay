/**
 * Plain-English `act` steps. The model never touches the target directly: it
 * picks one concrete tap/type/scroll/back from the live UI tree, and the runner
 * executes that as an ordinary recipe step so tracing, target resolution,
 * cancellation, and evidence stay identical to recorded steps.
 */
import { z } from "zod";
import type { RecipeStep, StepTarget } from "@relay/protocol";
import { snapshot, type Device, type SnapshotNode } from "../device/device.js";
import { captureScreenshot, cleanupScreenshot } from "../workspace/workspace-capture.js";
import { createModelClient } from "../model/model-provider.js";
import { now } from "../collaboration/events.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { isCancel } from "./recipe-runner-support.js";
import { describeRecipeStep } from "./recipe-presentation.js";
import { rethrowIosMutationOutcomeUnknown } from "../ios/ios-mutation-policy.js";
import { rethrowInputOutcomeUnknown } from "../device/input-not-dispatched.js";
import { savedPathStepsAreExecutable } from "../app-map/act-cache-steps.js";
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
const MAX_CANDIDATES = 80;

export type ActCandidate = {
  id: string;
  label?: string;
  role?: string;
  identifier?: string;
  editable?: boolean;
  target: StepTarget;
};

export type ActDecision =
  | { action: "done"; reason: string }
  | { action: "impossible"; reason: string }
  | { action: "tap"; candidateId: string; reason: string; finishesIntent?: boolean }
  | {
      action: "type";
      text: string;
      candidateId?: string;
      submit?: boolean;
      reason: string;
      finishesIntent?: boolean;
    }
  | { action: "scroll"; direction: "down" | "up"; reason: string }
  | { action: "back"; reason: string; finishesIntent?: boolean }
  | { action: "wait"; reason: string };

export type ActDecisionInput = {
  intent: string;
  candidates: ActCandidate[];
  history: string[];
  screenshot?: { mimeType: string; data: string };
  model?: string;
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

const EDITABLE_TYPES =
  /textfield|textarea|edittext|searchfield|securetextfield|input|textbox|combobox/i;

function nodeText(node: SnapshotNode): string {
  return (node.label ?? node.value ?? "").trim();
}

export function actCandidates(nodes: SnapshotNode[]): ActCandidate[] {
  const out: ActCandidate[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.visibleToUser === false || node.enabled === false) continue;
    const label = nodeText(node) || node.content?.trim() || node.description?.trim() || "";
    const identifier = node.identifier?.trim() || undefined;
    const role = (node.role ?? node.type)?.trim() || undefined;
    const editable =
      node.editable === true || EDITABLE_TYPES.test(`${node.type ?? ""} ${node.role ?? ""}`);
    if (!label && !identifier && !editable) continue;
    const point = node.rect
      ? {
          x: Math.round(node.rect.x + node.rect.width / 2),
          y: Math.round(node.rect.y + node.rect.height / 2),
        }
      : undefined;
    const key = `${identifier ?? ""}|${label}|${point?.x ?? ""},${point?.y ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const target: StepTarget = identifier
      ? { identifier, ...(label ? { label } : {}) }
      : label
        ? { label, ...(point ? { point } : {}) }
        : point
          ? { point }
          : {};
    out.push({
      id: `c${out.length + 1}`,
      ...(label ? { label: label.slice(0, 120) } : {}),
      ...(role ? { role } : {}),
      ...(identifier ? { identifier } : {}),
      ...(editable ? { editable } : {}),
      target,
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

const decisionSchema = z.object({
  action: z.enum(["done", "impossible", "tap", "type", "scroll", "back", "wait"]),
  candidateId: z.string().optional(),
  text: z.string().optional(),
  submit: z.boolean().optional(),
  direction: z.enum(["down", "up"]).optional(),
  finishesIntent: z.boolean().optional(),
  reason: z.string(),
});

function actPrompt(input: ActDecisionInput): string {
  return [
    "You operate an app under test to accomplish ONE plain-English step.",
    `Step: ${JSON.stringify(input.intent)}`,
    input.history.length
      ? `Actions already taken for this step: ${JSON.stringify(input.history)}`
      : "No actions taken yet for this step.",
    ...(input.auth?.type === "sign-in" ? signInPromptLines(input.auth.accountKey) : []),
    ...(input.auth?.type === "inbox-code" ? inboxCodePromptLines(input.auth.inboxKey) : []),
    "Visible controls (choose by id):",
    JSON.stringify(input.candidates.map(({ target: _target, ...candidate }) => candidate)),
    "Reply with exactly one next action:",
    '- "done" if the screen shows the step is already accomplished.',
    '- "impossible" if the step cannot be done from this screen (explain what you see instead).',
    '- "tap" with candidateId.',
    '- "type" with text (and candidateId of the field when known; submit=true to press Enter).',
    '- "scroll" with direction, "back", or "wait" when the screen is still loading.',
    "Set finishesIntent=true when this action alone completes the step.",
    "Only act toward this step; never perform unrelated or destructive actions.",
  ].join("\n");
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
    schema: decisionSchema,
    schemaName: "relay_act_decision",
    maxRetries: 1,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: actPrompt(input) },
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

export function normalizeActDecision(raw: unknown): ActDecision {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success)
    return { action: "impossible", reason: "The model returned an invalid action." };
  const value = parsed.data;
  const reason = value.reason.trim() || value.action;
  switch (value.action) {
    case "tap":
      return value.candidateId
        ? {
            action: "tap",
            candidateId: value.candidateId,
            reason,
            finishesIntent: value.finishesIntent,
          }
        : { action: "impossible", reason: "The model chose tap without a control." };
    case "type":
      return value.text === undefined
        ? { action: "impossible", reason: "The model chose type without text." }
        : {
            action: "type",
            text: value.text,
            ...(value.candidateId ? { candidateId: value.candidateId } : {}),
            ...(value.submit ? { submit: true } : {}),
            reason,
            finishesIntent: value.finishesIntent,
          };
    case "scroll":
      return { action: "scroll", direction: value.direction ?? "down", reason };
    case "back":
      return { action: "back", reason, finishesIntent: value.finishesIntent };
    default:
      return { action: value.action, reason };
  }
}

/** Translate one decision into the concrete recipe steps the engine runs. */
export function concreteStepsForDecision(
  decision: ActDecision,
  candidates: ActCandidate[],
): { steps: RecipeStep[]; summary: string } {
  const find = (id: string | undefined) => candidates.find((candidate) => candidate.id === id);
  switch (decision.action) {
    case "tap": {
      const candidate = find(decision.candidateId);
      if (!candidate)
        throw new Error(`act: the model chose an unknown control (${decision.candidateId})`);
      return {
        steps: [{ kind: "tap", target: candidate.target }],
        summary: `Tap ${candidate.label ?? candidate.identifier ?? "control"}`,
      };
    }
    case "type": {
      const candidate = find(decision.candidateId);
      const steps: RecipeStep[] = [
        {
          kind: "type",
          text: decision.text,
          mode: "replace",
          ...(candidate ? { target: candidate.target } : {}),
        },
      ];
      if (decision.submit) steps.push({ kind: "device", action: "keyboard-enter" });
      return {
        steps,
        summary: `Type ${JSON.stringify(decision.text)}${candidate?.label ? ` into ${candidate.label}` : ""}`,
      };
    }
    case "scroll":
      return {
        steps: [{ kind: "scroll", direction: decision.direction }],
        summary: `Scroll ${decision.direction}`,
      };
    case "back":
      return { steps: [{ kind: "key", key: "back" }], summary: "Go back" };
    case "wait":
      return { steps: [{ kind: "sleep", ms: 1_000 }], summary: "Wait" };
    default:
      return { steps: [], summary: decision.action };
  }
}

export type ActObservation = {
  candidates: ActCandidate[];
  screenshot?: { mimeType: string; data: string };
};

export type ActObservationOptions = { includeScreenshot?: boolean };

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
  return { candidates: actCandidates(nodes), ...(screenshot ? { screenshot } : {}) };
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
    const decision = await decide({
      intent: step.intent,
      candidates,
      history,
      ...(screenshot ? { screenshot } : {}),
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
    if (attempt === max) break;
    const { steps, summary: decisionSummary } = concreteStepsForDecision(decision, candidates);
    const summary = secretText(decisionSummary);
    record({ action: decision.action, summary, reason, steps });
    ctx.log(`act: ${summary} — ${reason}`);
    for (const concrete of steps) await runAndKeep(concrete);
    history.push(summary);
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

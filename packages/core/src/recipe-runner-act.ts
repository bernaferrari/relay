/**
 * Plain-English `act` steps. The model never touches the target directly: it
 * picks one concrete tap/type/scroll/back from the live UI tree, and the runner
 * executes that as an ordinary recipe step so tracing, target resolution,
 * cancellation, and evidence stay identical to recorded steps.
 */
import { z } from "zod";
import type { RecipeStep, StepTarget } from "@relay/protocol";
import { snapshot, type Device, type SnapshotNode } from "./device.js";
import { captureScreenshot, cleanupScreenshot } from "./workspace-capture.js";
import { createOpenRouterClient } from "./openrouter-ai-sdk.js";
import { now } from "./events.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { isCancel } from "./recipe-runner-support.js";
import { rethrowIosMutationOutcomeUnknown } from "./ios-mutation-policy.js";
import { rethrowInputOutcomeUnknown } from "./input-not-dispatched.js";

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

async function decideViaOpenRouter(input: ActDecisionInput): Promise<ActDecision> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "This step is written in plain English and needs a model. Set OPENROUTER_API_KEY, or record the step.",
    );
  }
  const model =
    input.model ??
    process.env.OPENROUTER_ACT_MODEL ??
    process.env.OPENROUTER_VISION_MODEL ??
    "openai/gpt-4o-mini";
  const { sdk, provider } = await createOpenRouterClient({
    apiKey: key,
    httpReferer: process.env.OPENROUTER_HTTP_REFERER,
    appTitle: process.env.OPENROUTER_APP_TITLE ?? "Relay",
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

async function observe(device: Device): Promise<ActObservation> {
  const nodes = await snapshot(device, { interactiveOnly: false });
  let screenshot: { mimeType: string; data: string } | undefined;
  try {
    const shot = await captureScreenshot({ device, ephemeral: true, includeScreenMatch: false });
    screenshot = { mimeType: "image/png", data: shot.base64 };
    await cleanupScreenshot(shot.path);
  } catch {
    screenshot = undefined;
  }
  return { candidates: actCandidates(nodes), ...(screenshot ? { screenshot } : {}) };
}

export async function runActStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "act" }>,
  ctx: RecipeStepContext,
  runConcrete: (concrete: RecipeStep) => Promise<void>,
  observeScreen: (device: Device) => Promise<ActObservation> = observe,
): Promise<void> {
  const decide = registeredDecider ?? decideViaOpenRouter;
  const max = Math.max(1, Math.min(step.maxActions ?? DEFAULT_ACT_MAX_ACTIONS, 20));
  const history: string[] = [];
  const executed: RecipeStep[] = [];
  const record = (data: Record<string, unknown>) =>
    (ctx.job?.artifacts ?? ctx.artifacts)?.push({
      kind: "act-decision",
      capturedAt: now(),
      data: { intent: step.intent, ...data },
    });
  /** What carried out the step, so a later run can replay it without a model. */
  const finish = (source: "cache" | "model") => {
    (ctx.job?.artifacts ?? ctx.artifacts)?.push({
      kind: "act-result",
      capturedAt: now(),
      data: {
        intent: step.intent,
        ...(step.id ? { recipeStepId: step.id } : {}),
        source,
        steps: structuredClone(executed),
      },
    });
  };
  const runAndKeep = async (concrete: RecipeStep) => {
    await runConcrete(concrete);
    executed.push(concrete);
  };

  // Replay what worked last time; ask the model only if the screen changed.
  if (step.cached?.length) {
    try {
      for (const concrete of step.cached) await runAndKeep(structuredClone(concrete));
      record({ action: "cached", steps: step.cached });
      ctx.log(`act: replayed ${step.cached.length} saved action(s) for “${step.intent}”`);
      finish("cache");
      return;
    } catch (error) {
      // Never retry around a cancel, or an input whose outcome is unknown.
      if (isCancel(error)) throw error;
      rethrowIosMutationOutcomeUnknown(error);
      rethrowInputOutcomeUnknown(error);
      const message = error instanceof Error ? error.message : String(error);
      record({ action: "cache-miss", reason: message, replayed: executed.length });
      ctx.log(`act: saved actions no longer fit (${message}); asking the model`);
      history.push(...executed.map(() => "Replayed a saved action"));
    }
  }
  for (let attempt = 0; attempt <= max; attempt += 1) {
    const { candidates, screenshot } = await observeScreen(device);
    const decision = await decide({
      intent: step.intent,
      candidates,
      history,
      ...(screenshot ? { screenshot } : {}),
      ...(step.model ? { model: step.model } : {}),
    });
    if (decision.action === "done") {
      record({ action: "done", reason: decision.reason, history });
      ctx.log(`act: done — ${decision.reason}`);
      finish("model");
      return;
    }
    if (decision.action === "impossible") {
      record({ action: "impossible", reason: decision.reason, history });
      throw new Error(`Could not ${lowerFirst(step.intent)}: ${decision.reason}`);
    }
    if (attempt === max) break;
    const { steps, summary } = concreteStepsForDecision(decision, candidates);
    record({ action: decision.action, summary, reason: decision.reason, steps });
    ctx.log(`act: ${summary} — ${decision.reason}`);
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

function lowerFirst(text: string): string {
  const trimmed = text.trim().replace(/[.!]+$/u, "");
  return trimmed ? trimmed[0]!.toLowerCase() + trimmed.slice(1) : "complete this step";
}

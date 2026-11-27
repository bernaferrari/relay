/**
 * Semantic resolution for plain-English checks. The model is allowed only to
 * choose visible snapshot evidence; Relay turns that evidence into ordinary
 * `expect` steps and the visual judge confirms the first resolution. Later
 * runs can replay those expectations without asking the model again.
 */
import { z } from "zod";
import type { RecipeStep, StepTarget } from "@relay/protocol";
import { snapshot, type Device, type SnapshotNode } from "../device/device.js";
import { createModelClient } from "../model/model-provider.js";

const MAX_CANDIDATES = 120;
const MAX_EVIDENCE = 4;

export type CheckCandidate = {
  id: string;
  text?: string;
  role?: string;
  identifier?: string;
  target: StepTarget;
};

export type CheckDecision =
  | { action: "expect"; candidateIds: string[]; reason: string }
  | { action: "judge"; reason: string };

export type CheckDecisionInput = {
  criteria: string[];
  candidates: CheckCandidate[];
  model?: string;
};

export type CheckDecider = (input: CheckDecisionInput) => Promise<CheckDecision>;

let registeredDecider: CheckDecider | undefined;

/** Test seam and local-provider hook. Returns an unregister function. */
export function registerCheckDecider(decider: CheckDecider): () => void {
  registeredDecider = decider;
  return () => {
    if (registeredDecider === decider) registeredDecider = undefined;
  };
}

function visibleText(node: SnapshotNode): string {
  if (typeof node.content === "string" && node.content.trim()) return node.content.trim();
  if (typeof node.value === "string" && node.value.trim()) return node.value.trim();
  if (typeof node.label === "string" && node.label.trim()) return node.label.trim();
  return "";
}

/** Passive evidence keeps disabled controls: a disabled button can still be
 * the visible thing a validation is about. Coordinates are never exposed. */
export function checkCandidates(nodes: SnapshotNode[]): CheckCandidate[] {
  const out: CheckCandidate[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.visibleToUser === false) continue;
    const text = visibleText(node);
    const identifier = node.identifier?.trim() || undefined;
    const ref = node.ref?.trim() || undefined;
    const role = (node.role ?? node.type)?.trim() || undefined;
    const target: StepTarget = text
      ? { text: text.slice(0, 240), ...(role ? { role } : {}) }
      : identifier
        ? { identifier, ...(role ? { role } : {}) }
        : ref
          ? { ref, ...(role ? { role } : {}) }
          : {};
    if (!target.text && !target.identifier && !target.ref) continue;
    const key = JSON.stringify(target);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `c${out.length + 1}`,
      ...(text ? { text: text.slice(0, 160) } : {}),
      ...(role ? { role } : {}),
      ...(identifier ? { identifier } : {}),
      target,
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

const decisionSchema = z.object({
  action: z.enum(["expect", "judge"]),
  candidateIds: z.array(z.string()).max(MAX_EVIDENCE).optional(),
  reason: z.string(),
});

function checkPrompt(input: CheckDecisionInput): string {
  return [
    "You are resolving ONE plain-English product check into visible semantic evidence.",
    `Check: ${JSON.stringify(input.criteria.join(" and "))}`,
    "Visible semantic evidence (choose by id):",
    JSON.stringify(input.candidates.map(({ target: _target, ...candidate }) => candidate)),
    "Reply with exactly one action:",
    '- "expect" with candidateIds only when the continued visibility of all chosen evidence directly proves the check.',
    '- "judge" when the check depends on layout, color, imagery, absence, ordering, counting, style, or any judgment that visible text/identity alone cannot prove.',
    "Prefer exact visible text over container identities. Choose the smallest sufficient evidence set, at most four items.",
    "Never infer evidence that is not listed. When uncertain, choose judge.",
  ].join("\n");
}

export function normalizeCheckDecision(raw: unknown): CheckDecision {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success)
    return { action: "judge", reason: "The model returned unusable semantic evidence." };
  const reason = parsed.data.reason.trim() || parsed.data.action;
  if (parsed.data.action === "judge") return { action: "judge", reason };
  const candidateIds = [...new Set(parsed.data.candidateIds ?? [])].filter(Boolean);
  return candidateIds.length
    ? { action: "expect", candidateIds, reason }
    : { action: "judge", reason: "The model chose semantic evidence without naming it." };
}

async function decideViaModel(input: CheckDecisionInput): Promise<CheckDecision> {
  const { sdk, provider, model } = await createModelClient("check", {
    ...(input.model ? { model: input.model } : {}),
    httpReferer: process.env.OPENROUTER_HTTP_REFERER,
    appTitle: process.env.OPENROUTER_APP_TITLE ?? "Relay",
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "ModelProviderNotConfiguredError") {
      throw new Error(
        "This check is written in plain English and needs a model. Configure a model provider in Settings, or record the check.",
      );
    }
    throw error;
  });
  const generated = await sdk.generateObject({
    model: provider.chat(model),
    schema: decisionSchema,
    schemaName: "relay_check_decision",
    maxRetries: 1,
    messages: [{ role: "user", content: [{ type: "text", text: checkPrompt(input) }] }],
  });
  return normalizeCheckDecision(generated.object);
}

/** Translate semantic evidence into deterministic recipe assertions. Unknown
 * or duplicate ids are ignored rather than trusted. */
export function checkStepsForDecision(
  decision: CheckDecision,
  candidates: CheckCandidate[],
): { steps: RecipeStep[]; summary: string } | undefined {
  if (decision.action !== "expect") return undefined;
  const steps: RecipeStep[] = [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const id of decision.candidateIds) {
    if (seen.has(id) || steps.length >= MAX_EVIDENCE) continue;
    seen.add(id);
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate) return undefined;
    steps.push({ kind: "expect", target: structuredClone(candidate.target), condition: "visible" });
    labels.push(candidate.text ?? candidate.identifier ?? candidate.id);
  }
  if (!steps.length) return undefined;
  return { steps, summary: `Expect ${labels.join(" + ")}` };
}

export type ResolvedCheckSteps = {
  steps: RecipeStep[];
  summary: string;
  reason: string;
};

/** Ask the model whether this check reduces to visible semantic evidence.
 * `undefined` is not failure; it means the visual judge owns the check. */
export async function resolveSemanticCheckSteps(
  device: Device,
  criteria: string[],
  model?: string,
): Promise<ResolvedCheckSteps | undefined> {
  const candidates = checkCandidates(await snapshot(device, { interactiveOnly: false }));
  if (!candidates.length) return undefined;
  const decide = registeredDecider ?? decideViaModel;
  const decision = normalizeCheckDecision(
    await decide({ criteria, candidates, ...(model ? { model } : {}) }),
  );
  const concrete = checkStepsForDecision(decision, candidates);
  if (!concrete) return undefined;
  return { ...concrete, reason: decision.reason };
}

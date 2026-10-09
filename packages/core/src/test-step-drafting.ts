/**
 * Turn "what should work?" into a short list of plain-English Act and Check
 * steps. A configured model writes the steps; without one, each line or
 * sentence becomes a step and verification phrasing becomes a Check.
 */
import { z } from "zod";
import { APP_MAP_TEST_INTENT_LIMITS, type AppMap } from "@relay/protocol";
import { createOpenRouterClient } from "./openrouter-ai-sdk.js";

export type DraftedTestStep = { kind: "instruction" | "validation"; intent: string };

export type DraftedTest = {
  name: string;
  steps: DraftedTestStep[];
  /** "model" when a provider wrote the steps, "lines" for the offline split. */
  source: "model" | "lines";
};

export type TestStepDrafter = (input: {
  goal: string;
  startUrl?: string;
  knownScreens: string[];
}) => Promise<{ name: string; steps: DraftedTestStep[] }>;

const MAX_DRAFT_STEPS = 15;
const CHECK_PREFIX =
  /^(?:check|verify|assert|expect|ensure|confirm|make sure|see|should|validate)\b|\b(?:is|are) (?:visible|shown|displayed)\b|\bshould\b/iu;
const LABEL_PREFIX = /^(?:act|action|do|assert|check|verify|expect|screenshot)\s*:\s*/iu;
const LIST_PREFIX = /^(?:[-*•]|\d+[.)])\s*/u;

let registeredDrafter: TestStepDrafter | undefined;

/** Test seam and local-provider hook. Returns an unregister function. */
export function registerTestStepDrafter(drafter: TestStepDrafter): () => void {
  registeredDrafter = drafter;
  return () => {
    if (registeredDrafter === drafter) registeredDrafter = undefined;
  };
}

function clip(text: string): string {
  return text.trim().slice(0, APP_MAP_TEST_INTENT_LIMITS.maxIntentLength);
}

export function classifyDraftLine(line: string): DraftedTestStep | undefined {
  const withoutList = line.trim().replace(LIST_PREFIX, "");
  const labelled = LABEL_PREFIX.exec(withoutList)?.[0]?.toLowerCase() ?? "";
  const intent = clip(withoutList.replace(LABEL_PREFIX, "").replace(/\s+/gu, " "));
  if (!intent) return undefined;
  const isCheck = labelled ? !/^(?:act|action|do)\b/u.test(labelled) : CHECK_PREFIX.test(intent);
  return { kind: isCheck ? "validation" : "instruction", intent: capitalize(intent) };
}

/** Offline draft: lines first; a single line splits on sentences and "then". */
export function draftStepsFromLines(goal: string): DraftedTestStep[] {
  const lines = goal
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const pieces =
    lines.length > 1
      ? lines
      : (lines[0] ?? "")
          .split(/(?<=[.!?])\s+|,?\s+(?:and )?then\s+/iu)
          .map((piece) => piece.trim().replace(/[.]+$/u, ""))
          .filter(Boolean);
  return pieces.flatMap((piece) => classifyDraftLine(piece) ?? []).slice(0, MAX_DRAFT_STEPS);
}

export function draftTestName(goal: string): string {
  const first = goal.trim().split(/\r?\n/u)[0] ?? "";
  const words = first
    .replace(LABEL_PREFIX, "")
    .replace(/[.!?]+$/u, "")
    .trim();
  return capitalize(words.length > 80 ? `${words.slice(0, 77).trimEnd()}…` : words) || "New test";
}

function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

const draftSchema = z.object({
  name: z.string(),
  steps: z
    .array(z.object({ type: z.enum(["act", "check"]), text: z.string() }))
    .min(1)
    .max(MAX_DRAFT_STEPS),
});

async function draftViaOpenRouter(input: {
  goal: string;
  startUrl?: string;
  knownScreens: string[];
}): Promise<{ name: string; steps: DraftedTestStep[] } | undefined> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return undefined;
  const model =
    process.env.OPENROUTER_DRAFT_MODEL ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const { sdk, provider } = await createOpenRouterClient({
    apiKey: key,
    httpReferer: process.env.OPENROUTER_HTTP_REFERER,
    appTitle: process.env.OPENROUTER_APP_TITLE ?? "Relay",
  });
  const generated = await sdk.generateObject({
    model: provider.chat(model),
    schema: draftSchema,
    schemaName: "relay_test_draft",
    maxRetries: 1,
    messages: [
      {
        role: "user",
        content: [
          "Write an end-to-end UI test as short plain-English steps a person could follow.",
          `What should work: ${JSON.stringify(input.goal)}`,
          input.startUrl ? `The test starts at ${input.startUrl}.` : "",
          input.knownScreens.length
            ? `Screens already seen in this app: ${JSON.stringify(input.knownScreens.slice(0, 40))}`
            : "",
          "Use type 'act' for one user action each (tap, type, choose, open, scroll).",
          "Use type 'check' for something visible that proves the flow worked; end with at least one check.",
          "Do not include opening the start address. Keep each step under 120 characters.",
          `Use at most ${MAX_DRAFT_STEPS} steps. Name the test in under 8 words.`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
  const steps = generated.object.steps.flatMap((step) => {
    const intent = clip(step.text);
    return intent
      ? [{ kind: step.type === "check" ? "validation" : "instruction", intent } as const]
      : [];
  });
  return steps.length ? { name: generated.object.name.trim(), steps } : undefined;
}

export async function draftTestSteps(input: {
  goal: string;
  startUrl?: string;
  appMap?: Pick<AppMap, "screens">;
}): Promise<DraftedTest> {
  const goal = input.goal.trim();
  if (!goal) throw new Error("Describe what should work.");
  const knownScreens = Object.values(input.appMap?.screens ?? {}).map((screen) => screen.title);
  const fallback = (): DraftedTest => ({
    name: draftTestName(goal),
    steps: draftStepsFromLines(goal),
    source: "lines",
  });
  // A list the author already wrote is respected as-is.
  if (goal.split(/\r?\n/u).filter((line) => line.trim()).length > 1) return fallback();
  const drafter = registeredDrafter ?? draftViaOpenRouter;
  try {
    const drafted = await drafter({
      goal,
      ...(input.startUrl ? { startUrl: input.startUrl } : {}),
      knownScreens,
    });
    if (!drafted?.steps.length) return fallback();
    return {
      name: drafted.name || draftTestName(goal),
      steps: drafted.steps.slice(0, MAX_DRAFT_STEPS),
      source: "model",
    };
  } catch {
    return fallback();
  }
}

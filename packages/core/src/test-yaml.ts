/**
 * A Test as a small file people and agents can write by hand:
 *
 *   name: Create an API key
 *   url: https://shop.example/settings
 *   steps:
 *     - Open the API keys page
 *     - Create a new API key
 *     - check: The new key is listed
 *
 * A plain string is an Action; `check:` is a Check; `do:` is an explicit
 * Action. `app` (id or name) is optional when `url` names the website.
 * `id` keeps a Test stable across renames; without it the name is the key.
 */
import { randomUUID } from "node:crypto";
import { parseDocument, stringify } from "yaml";
import {
  APP_MAP_TEST_INTENT_LIMITS,
  type AppMapScenarioTest,
  type AppMapScenarioTestStep,
} from "@relay/protocol";

export type TestYamlStep = { kind: "instruction" | "validation"; intent: string };

export type TestYaml = {
  name: string;
  id?: string;
  app?: string;
  url?: string;
  steps: TestYamlStep[];
};

export class TestYamlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestYamlError";
  }
}

const KEYS = new Set(["name", "id", "app", "url", "steps"]);

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new TestYamlError(`${where} must be non-empty text.`);
  return value.trim();
}

export function parseTestYaml(source: string): TestYaml {
  const document = parseDocument(source, { prettyErrors: true });
  if (document.errors.length) throw new TestYamlError(document.errors[0]!.message);
  const value = document.toJS() as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TestYamlError("A test file needs `name` and `steps`.");
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !KEYS.has(key));
  if (unknown.length)
    throw new TestYamlError(
      `Unknown field${unknown.length === 1 ? "" : "s"} ${unknown.map((key) => `\`${key}\``).join(", ")}. Use name, app, url, id, steps.`,
    );
  const name = text(record.name, "`name`");
  if (name.length > 200) throw new TestYamlError("`name` must be under 200 characters.");
  const url = record.url === undefined ? undefined : text(record.url, "`url`");
  if (url && !/^https?:\/\/\S+$/iu.test(url))
    throw new TestYamlError("`url` must start with http:// or https://");
  const app = record.app === undefined ? undefined : text(record.app, "`app`");
  const id = record.id === undefined ? undefined : text(record.id, "`id`");
  if (id && !/^[A-Za-z0-9][\w.-]{0,127}$/u.test(id))
    throw new TestYamlError("`id` may use letters, digits, dots, dashes and underscores.");
  if (!Array.isArray(record.steps) || !record.steps.length)
    throw new TestYamlError("`steps` must list at least one step.");
  if (record.steps.length > APP_MAP_TEST_INTENT_LIMITS.maxSteps)
    throw new TestYamlError(`Use at most ${APP_MAP_TEST_INTENT_LIMITS.maxSteps} steps.`);
  const steps = record.steps.map((raw, index): TestYamlStep => {
    const where = `Step ${index + 1}`;
    if (typeof raw === "string") return { kind: "instruction", intent: text(raw, where) };
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const entries = Object.entries(raw as Record<string, unknown>);
      if (entries.length === 1) {
        const [key, body] = entries[0]!;
        if (key === "check") return { kind: "validation", intent: text(body, where) };
        if (key === "do") return { kind: "instruction", intent: text(body, where) };
      }
    }
    throw new TestYamlError(`${where} must be text, \`check: …\`, or \`do: …\`.`);
  });
  for (const [index, step] of steps.entries())
    if (step.intent.length > APP_MAP_TEST_INTENT_LIMITS.maxIntentLength)
      throw new TestYamlError(
        `Step ${index + 1} must be under ${APP_MAP_TEST_INTENT_LIMITS.maxIntentLength + 1} characters.`,
      );
  if (!app && !url)
    throw new TestYamlError("Say which app (`app`) or which website the test opens (`url`).");
  return { name, ...(id ? { id } : {}), ...(app ? { app } : {}), ...(url ? { url } : {}), steps };
}

function flatSteps(steps: readonly AppMapScenarioTestStep[]): AppMapScenarioTestStep[] {
  return steps.flatMap((step) =>
    step.kind === "decision"
      ? [step, ...flatSteps(step.thenSteps), ...flatSteps(step.elseSteps ?? [])]
      : step.kind === "loop"
        ? [step, ...flatSteps(step.steps)]
        : [step],
  );
}

/** The same Test as a file. Recorded steps appear by their words. */
export function testToYaml(test: AppMapScenarioTest, appName: string, testId?: string): string {
  const steps = flatSteps(test.steps)
    .filter((step) => step.kind !== "decision" && step.kind !== "loop")
    .map((step) => (step.kind === "validation" ? { check: step.intent } : step.intent));
  return stringify(
    {
      name: test.name,
      ...(testId ? { id: testId } : {}),
      ...(test.startUrl ? { url: test.startUrl } : { app: appName }),
      steps,
    },
    { lineWidth: 0 },
  );
}

/**
 * Steps for a Test written from a file. A step whose words and kind did not
 * change keeps whatever made it exact (a recording, a saved path), so editing
 * the file never throws that work away. Other steps run from their words.
 */
export function stepsFromYaml(
  testId: string,
  wanted: readonly TestYamlStep[],
  existing: readonly AppMapScenarioTestStep[] = [],
): AppMapScenarioTestStep[] {
  const available = [...existing];
  return wanted.map((step, index) => {
    const match = available.findIndex(
      (candidate) => candidate.kind === step.kind && candidate.intent.trim() === step.intent,
    );
    if (match >= 0) return available.splice(match, 1)[0]!;
    return {
      id: `${testId}-step-${index + 1}-${randomUUID().slice(0, 8)}`,
      kind: step.kind,
      intent: step.intent,
      binding: {
        status: "unresolved",
        reason: "Runs from its description. Record it to make it faster and exact.",
        fromText: true,
      },
    } as AppMapScenarioTestStep;
  });
}

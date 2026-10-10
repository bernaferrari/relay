import { operationDefinition } from "@relay/protocol";
import type { RelayOutcomeJobs } from "@relay/workflows";
import * as z from "zod/v4";
import type { RelayOutcomeToolDescriptor } from "./outcome-tools.js";
import type { RelayMcpProfile } from "./tools.js";
import type { OperationInvoker } from "./server.js";
import { waitForRunVerdict, agentVerdict, type RunWaitContext } from "./run-verdict-wait.js";

/**
 * The everyday agent loop: describe a Test in a sentence, run it, read one
 * verdict. These tools compose existing server operations (test.create-from-goal,
 * the durable run workflow, run.verdict.get); they add no second runtime.
 */
const identifier = z.string().trim().min(1);
/** Either a description (Relay writes the steps) or a test file written as-is. */
const createTestInput = z
  .object({
    goal: z
      .string()
      .trim()
      .min(1)
      .max(4_000)
      .optional()
      .describe("What should work, or one step per line"),
    yaml: z
      .string()
      .min(1)
      .max(100_000)
      .optional()
      .describe(
        "A test file: name, url or app, and steps (plain text for actions, `check:` for checks)",
      ),
    url: z
      .string()
      .trim()
      .max(2048)
      .regex(/^https?:\/\//iu)
      .optional()
      .describe("Website the Test opens first"),
    app: z.string().trim().min(1).max(200).optional().describe("App id or name"),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.goal) !== Boolean(input.yaml), {
    message: "Pass either goal (a description) or yaml (a test file), not both.",
  });
const timeoutSeconds = z
  .number()
  .int()
  .min(5)
  .max(1_800)
  .optional()
  .describe("How long to wait for verdicts before returning (default 900)");
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const writes = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const relayEverydayTools = Object.freeze([
  {
    name: "relay_create_test",
    title: "Write a Test from a description",
    description:
      'Create or update a Test. Either describe what should work (goal: one sentence, or one step per line; Relay writes the Action and Check steps) or pass a test file (yaml: name, url or app, steps — plain text is an action, `check:` a check; the same name or id updates in place and keeps recorded steps whose words did not change). Finds or creates the App (url for a website, app for an existing App). Returns the Test plus the exact relay_run_test call that runs it and returns a verdict. Steps run from their words, which needs a model key (OPENROUTER_API_KEY or one saved in Settings); record a step later to make it exact and model-free. Examples: {goal:"Sign in and see the dashboard",url:"http://localhost:3000"} or {yaml:"name: Checkout\nurl: https://shop.example\nsteps:\n  - Add a shirt to the cart\n  - check: The cart shows 1 item"}.',
    requiresConfirmation: false,
    inputSchema: createTestInput as unknown as z.ZodType<Record<string, unknown>>,
    annotations: writes,
  },
  {
    name: "relay_get_verdict",
    title: "Read a Run's verdict",
    description:
      "Did the Run pass? Returns passed, failed, blocked, cancelled or running, a one-line reason, and each step's status. Failed steps include what was expected, what Relay saw, and a screenshot reference.",
    requiresConfirmation: false,
    inputSchema: z.object({ runId: identifier }).strict(),
    annotations: readOnly,
  },
  {
    name: "relay_check_change",
    title: "Check a code change quickly",
    description:
      "Quick check after you change code: runs the App's ready Tests one after another on the selected target and returns each verdict plus one overall result. Narrow it with testIds, or with areas (words for what changed, matched against Test names and steps); with nothing narrower it runs every ready Test of the App, up to maxTests. Tests that still need recording are listed as skipped. This is a fast signal for you, not a merge decision: gated, human-approved merge checks use the separate Proof flow (proof profile). Tests flagged as risky need transport confirm: true, like relay_run_test.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        app: identifier.max(200).optional().describe("App id or name; optional with one App"),
        testIds: z.array(identifier).min(1).max(20).optional(),
        areas: z
          .array(identifier.max(120))
          .min(1)
          .max(20)
          .optional()
          .describe('What changed, in words, e.g. ["checkout","sign in"]'),
        targetId: identifier.optional().describe("Target from relay_connect_target"),
        maxTests: z.number().int().min(1).max(20).optional().describe("Default 10"),
        timeoutSeconds,
      })
      .strict(),
    annotations: writes,
  },
] as const satisfies readonly RelayOutcomeToolDescriptor[]);

export type RelayEverydayToolName = (typeof relayEverydayTools)[number]["name"];
const everydayNames = new Set<string>(relayEverydayTools.map(({ name }) => name));

export function isRelayEverydayTool(name: string): name is RelayEverydayToolName {
  return everydayNames.has(name);
}

const authorEveryday = new Set<string>(["relay_create_test", "relay_get_verdict"]);
const everydayProfiles = new Set<RelayMcpProfile>([
  "qa",
  "outcome",
  "operator",
  "test",
  "run",
  "execute",
  "full",
]);

/** Profiles that author or run Tests get the describe → run → verdict loop. */
export function relayEverydayToolsForProfile(
  profile: RelayMcpProfile,
): readonly RelayOutcomeToolDescriptor[] {
  if (profile === "author")
    return relayEverydayTools.filter(({ name }) => authorEveryday.has(name));
  return everydayProfiles.has(profile) ? relayEverydayTools : [];
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export async function invokeRelayEverydayTool(input: {
  name: RelayEverydayToolName;
  argumentsValue: Record<string, unknown>;
  confirmed: boolean;
  invoker: OperationInvoker;
  jobs: RelayOutcomeJobs;
  signal: AbortSignal;
  sleep?: RunWaitContext["sleep"];
  now?: RunWaitContext["now"];
}): Promise<unknown> {
  const descriptor = relayEverydayTools.find(({ name }) => name === input.name)!;
  const parsed = descriptor.inputSchema.parse(input.argumentsValue) as Record<string, unknown>;
  const context: RunWaitContext = {
    invoker: input.invoker,
    jobs: input.jobs,
    signal: input.signal,
    ...(input.sleep ? { sleep: input.sleep } : {}),
    ...(input.now ? { now: input.now } : {}),
  };
  if (input.name === "relay_create_test") {
    const created = await createTest(parsed, input.invoker, input.signal);
    return {
      ...created,
      next: {
        tool: "relay_run_test",
        arguments: { appMapId: created.appId, testId: created.testId },
        hint: "Runs the Test and waits for its verdict. Add targetId from relay_connect_target when several targets are ready.",
      },
    };
  }
  if (input.name === "relay_get_verdict") {
    const result = object(
      await input.invoker.invoke("run.verdict.get", parsed, { signal: input.signal }),
    );
    return agentVerdict(result.verdict);
  }
  return checkChange(parsed, input.confirmed, context);
}

/** One place picks the server operation that writes the Test: a test file
 * is applied as written; a description is drafted into steps. */
async function createTest(
  parsed: Record<string, unknown>,
  invoker: OperationInvoker,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (typeof parsed.yaml === "string")
    return object(await invoker.invoke("test.apply-yaml", { yaml: parsed.yaml }, { signal }));
  const { yaml: _yaml, ...goal } = parsed;
  return object(await invoker.invoke("test.create-from-goal", goal, { signal }));
}

type TestCandidate = { id: string; name: string; text: string; ready: boolean };

function testCandidates(appMap: Record<string, unknown>): TestCandidate[] {
  return Object.entries(object(appMap.tests)).map(([id, value]) => {
    const test = object(value);
    const steps = Array.isArray(test.steps) ? test.steps.map(object) : [];
    const blocked = steps.some((step) => {
      const binding = object(step.binding);
      return (
        binding.status === "unresolved" &&
        binding.fromText !== true &&
        object(step.execution).status !== "disabled"
      );
    });
    const name = typeof test.name === "string" ? test.name : id;
    const text = [id, name, ...steps.map((step) => String(step.intent ?? ""))]
      .join(" ")
      .toLowerCase();
    return { id, name, text, ready: steps.length > 0 && !blocked };
  });
}

async function resolveAppId(app: string | undefined, context: RunWaitContext): Promise<string> {
  const listed = object(
    await context.invoker.invoke("app-map.list", {}, { signal: context.signal }),
  );
  const apps = (Array.isArray(listed.appMaps) ? listed.appMaps : []).map(object);
  if (!app) {
    if (apps.length === 1 && typeof apps[0]!.id === "string") return apps[0]!.id;
    throw new TypeError(
      `Say which App to check (app). Available: ${apps.map((item) => String(item.id)).join(", ") || "none"}.`,
    );
  }
  const wanted = app.toLowerCase();
  const match =
    apps.find((item) => item.id === app) ??
    apps.find((item) => String(item.name ?? "").toLowerCase() === wanted);
  if (!match || typeof match.id !== "string") throw new TypeError(`No App named "${app}".`);
  return match.id;
}

async function checkChange(
  parsed: Record<string, unknown>,
  confirmed: boolean,
  context: RunWaitContext,
): Promise<unknown> {
  const appMapId = await resolveAppId(parsed.app as string | undefined, context);
  const map = object(
    object(await context.invoker.invoke("app-map.get", { appMapId }, { signal: context.signal }))
      .appMap,
  );
  const candidates = testCandidates(map);
  const testIds = parsed.testIds as string[] | undefined;
  const areas = ((parsed.areas as string[] | undefined) ?? []).map((area) => area.toLowerCase());
  let scope: "tests" | "areas" | "all" = "all";
  let selected = candidates;
  if (testIds) {
    const unknown = testIds.filter((id) => !candidates.some((test) => test.id === id));
    if (unknown.length)
      throw new TypeError(`Unknown Test ids for ${appMapId}: ${unknown.join(", ")}`);
    selected = candidates.filter((test) => testIds.includes(test.id));
    scope = "tests";
  } else if (areas.length) {
    const matched = candidates.filter((test) => areas.some((area) => test.text.includes(area)));
    if (matched.some((test) => test.ready)) {
      selected = matched;
      scope = "areas";
    }
  }
  const maxTests = (parsed.maxTests as number | undefined) ?? 10;
  const ready = selected.filter((test) => test.ready);
  const toRun = ready.slice(0, maxTests);
  const skipped = [
    ...selected
      .filter((test) => !test.ready)
      .map((test) => ({ testId: test.id, name: test.name, reason: "needs recording" })),
    ...ready
      .slice(maxTests)
      .map((test) => ({ testId: test.id, name: test.name, reason: "over maxTests" })),
  ];
  const now = context.now ?? Date.now;
  const deadline = now() + ((parsed.timeoutSeconds as number | undefined) ?? 900) * 1_000;
  const results: Record<string, unknown>[] = [];
  for (const test of toRun) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      skipped.push({ testId: test.id, name: test.name, reason: "out of time" });
      continue;
    }
    try {
      const started = await context.jobs.run({
        kind: "run-test",
        appMapId,
        testId: test.id,
        ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
        ...(confirmed ? { confirmRisk: true } : {}),
      });
      const outcome = await waitForRunVerdict(started, context, remaining);
      results.push({ testId: test.id, name: test.name, ...summarizeOutcome(outcome) });
    } catch (error) {
      if (context.signal.aborted) throw error;
      results.push({
        testId: test.id,
        name: test.name,
        status: "blocked",
        reason: error instanceof Error ? error.message.slice(0, 300) : "Run could not start",
      });
    }
  }
  const statuses = results.map((item) => item.status);
  const overall = !results.length
    ? "nothing-to-run"
    : statuses.every((status) => status === "passed")
      ? "passed"
      : statuses.includes("failed")
        ? "failed"
        : statuses.includes("running")
          ? "running"
          : "blocked";
  return {
    appId: appMapId,
    overall,
    scope,
    ...(areas.length && scope === "all"
      ? { note: "No ready Test matched the areas, so every ready Test ran." }
      : {}),
    results,
    skipped,
    next:
      overall === "failed"
        ? "Read the failing step (expected vs. saw); call relay_inspect_failure with its runId for evidence."
        : overall === "running"
          ? "Call relay_get_verdict with each running runId later."
          : !results.length
            ? "Create a Test with relay_create_test, or record one with relay_record_test."
            : "For a merge decision, use the gated Proof flow (proof profile).",
  };
}

function summarizeOutcome(outcome: Record<string, unknown>): Record<string, unknown> {
  const verdict = object(outcome.verdict);
  if (!outcome.verdict) {
    return {
      status: outcome.status,
      ...(outcome.runId ? { runId: outcome.runId } : {}),
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    };
  }
  const steps = Array.isArray(verdict.steps) ? verdict.steps.map(object) : [];
  const failing = steps.find((step) => step.status === "failed");
  return {
    status: verdict.status,
    runId: verdict.runId,
    summary: verdict.summary,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    ...(failing ? { failingStep: failing } : {}),
  };
}

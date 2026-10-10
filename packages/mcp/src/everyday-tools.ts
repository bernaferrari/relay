import { operationDefinition } from "@relay/protocol";
import type { RelayOutcomeJobs } from "@relay/workflows";
import * as z from "zod/v4";
import type { RelayOutcomeToolDescriptor } from "./outcome-tools.js";
import { formatRelayTaskGuide, relayTaskGuideCatalog } from "@relay/workflows/task-guides";
import type { OperationInvoker } from "./server.js";
import {
  agentVerdict,
  compactRunSnapshot,
  defaultRunWaitSeconds,
  waitForRunVerdict,
  withFailingStep,
  type RunWaitContext,
} from "./run-verdict-wait.js";

/**
 * The qa loop every profile registers: describe a Test, run it, read one
 * verdict, check a change, inspect a failure, plus what an agent needs to
 * orient (Tests, ready devices, guides). These compose existing server
 * operations and the durable run workflow; they add no second runtime.
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
      .describe('What should work, or one step per line, e.g. "Sign in and see the dashboard"'),
    yaml: z
      .string()
      .min(1)
      .max(100_000)
      .optional()
      .describe(
        "A test file: name, url or app, and steps (plain text for actions, `check: ...` for checks). The same name updates the Test in place.",
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

const guideTopics = relayTaskGuideCatalog.map(({ topic }) => topic) as [string, ...string[]];

export const relayEverydayTools = Object.freeze([
  {
    name: "relay_create_test",
    title: "Write a Test",
    description:
      "Create or update a Test from a plain-English description (goal) or a test file (yaml), finding or creating its App. Returns the Test and the relay_run_test call that runs it.",
    requiresConfirmation: false,
    inputSchema: createTestInput as unknown as z.ZodType<Record<string, unknown>>,
    annotations: writes,
  },
  {
    name: "relay_run_test",
    title: "Run a Test",
    description:
      "Run one saved Test and wait for its verdict: passed, failed, blocked or cancelled, with the failing step's expected vs. saw. If Relay reports a risk, review it and repeat the call with confirm: true.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        appMapId: identifier.optional().describe("App id; optional when there is one App"),
        testId: identifier,
        targetId: identifier
          .optional()
          .describe("Device or browser from relay_list_devices; needed when several are ready"),
        wait: z
          .boolean()
          .optional()
          .describe("Wait for the verdict (default true); false returns the runId at once"),
        timeoutSeconds: z
          .number()
          .int()
          .min(5)
          .max(1_800)
          .optional()
          .describe("Longest wait before returning status running (default 600)"),
      })
      .strict(),
    annotations: writes,
  },
  {
    name: "relay_get_verdict",
    title: "Read a verdict",
    description:
      "Read whether a Run passed: its status, a one-line reason and each step's result. Failed steps include what was expected, what Relay saw and a screenshot.",
    requiresConfirmation: false,
    inputSchema: z.object({ runId: identifier }).strict(),
    annotations: readOnly,
  },
  {
    name: "relay_inspect_failure",
    title: "Inspect a failure",
    description:
      "Explain one failed Run: the failing step (expected vs. saw, screenshot), the saved evidence and any suggested fixes.",
    requiresConfirmation: false,
    inputSchema: z.object({ runId: identifier }).strict(),
    annotations: readOnly,
  },
  {
    name: "relay_check_change",
    title: "Check a code change",
    description:
      "After you change code, run the App's ready Tests (or the ones matching testIds or areas) and return each verdict plus one overall result. A quick signal for you, not a merge decision.",
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
          .describe(
            'What changed, in words, matched against Test names and steps, e.g. ["checkout"]',
          ),
        targetId: identifier.optional().describe("Device or browser from relay_list_devices"),
        maxTests: z.number().int().min(1).max(20).optional().describe("Default 10"),
        timeoutSeconds,
      })
      .strict(),
    annotations: writes,
  },
  {
    name: "relay_list_tests",
    title: "List Tests",
    description:
      "List one App's saved Tests with their ids, names, step counts and whether they are ready to run. Check here before writing a Test that may already exist.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        app: identifier.max(200).optional().describe("App id or name; optional with one App"),
      })
      .strict(),
    annotations: readOnly,
  },
  {
    name: "relay_list_devices",
    title: "List devices",
    description:
      "List the phones, emulators and browsers that are ready to run Tests, with the targetId to pass to other tools. When exactly one is ready it is returned as current.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        targetId: identifier.optional().describe("Check that this device or browser is ready"),
        targetKind: z.enum(["device", "browser"]).optional(),
        phase: z.enum(["android", "ios"]).optional().describe("Only list this phone platform"),
      })
      .strict(),
    annotations: readOnly,
  },
  {
    name: "relay_get_guide",
    title: "Read a guide",
    description:
      "Read Relay's how-to guides, bundled with this version and available offline. Call without a topic for the list, then with a topic before a task.",
    requiresConfirmation: false,
    inputSchema: z.object({ topic: z.enum(guideTopics).optional() }).strict(),
    annotations: readOnly,
  },
] as const satisfies readonly RelayOutcomeToolDescriptor[]);

export type RelayEverydayToolName = (typeof relayEverydayTools)[number]["name"];
const everydayNames = new Set<string>(relayEverydayTools.map(({ name }) => name));

export function isRelayEverydayTool(name: string): name is RelayEverydayToolName {
  return everydayNames.has(name);
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
        hint: "Runs the Test and waits for its verdict. Add targetId from relay_list_devices when several are ready.",
      },
    };
  }
  if (input.name === "relay_run_test") {
    const started = await input.jobs.run({
      kind: "run-test",
      ...(typeof parsed.appMapId === "string" ? { appMapId: parsed.appMapId } : {}),
      testId: parsed.testId as string,
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
      ...(input.confirmed ? { confirmRisk: true } : {}),
    });
    return presentOutcomeForAgent(input.name, parsed, started, context);
  }
  if (input.name === "relay_inspect_failure") {
    const inspected = await input.jobs.inspectFailure({
      kind: "inspect-failure",
      runId: parsed.runId as string,
    });
    return presentOutcomeForAgent(input.name, parsed, inspected, context);
  }
  if (input.name === "relay_list_tests") {
    const appMapId = await resolveAppId(parsed.app as string | undefined, context);
    const map = object(
      object(await input.invoker.invoke("app-map.get", { appMapId }, { signal: input.signal }))
        .appMap,
    );
    return {
      appId: appMapId,
      tests: testCandidates(map).map(({ id, name, steps, ready }) => ({
        testId: id,
        name,
        steps,
        ready,
      })),
    };
  }
  if (input.name === "relay_list_devices") {
    return input.jobs.connect({
      kind: "connect-target",
      ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
      ...(parsed.targetKind === "device" || parsed.targetKind === "browser"
        ? { targetKind: parsed.targetKind }
        : {}),
      ...(parsed.phase === "android" || parsed.phase === "ios" ? { phase: parsed.phase } : {}),
    });
  }
  if (input.name === "relay_get_guide") return readGuide(parsed.topic as string | undefined);
  if (input.name === "relay_get_verdict") {
    const result = object(
      await input.invoker.invoke("run.verdict.get", parsed, { signal: input.signal }),
    );
    return agentVerdict(result.verdict);
  }
  return checkChange(parsed, input.confirmed, context);
}

/** Agents get a verdict, not a workflow snapshot with a compiled plan. */
export async function presentOutcomeForAgent(
  name: string,
  argumentsValue: Record<string, unknown>,
  result: unknown,
  context: RunWaitContext,
): Promise<unknown> {
  if (name === "relay_inspect_failure" && typeof argumentsValue.runId === "string") {
    return withFailingStep(result, argumentsValue.runId, context);
  }
  if (name !== "relay_run_test") return result;
  if (argumentsValue.wait === false) return compactRunSnapshot(result);
  const seconds =
    typeof argumentsValue.timeoutSeconds === "number"
      ? argumentsValue.timeoutSeconds
      : defaultRunWaitSeconds;
  try {
    return await waitForRunVerdict(result, context, seconds * 1_000);
  } catch (error) {
    if (context.signal.aborted) throw error;
    return {
      status: "unknown",
      reason: error instanceof Error ? error.message.slice(0, 300) : "Verdict unavailable",
      run: compactRunSnapshot(result),
      next: "Call relay_get_verdict with the runId later.",
    };
  }
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

function readGuide(topic: string | undefined): unknown {
  if (!topic) {
    return {
      guides: relayTaskGuideCatalog.map(({ topic: id, title, summary }) => ({
        topic: id,
        title,
        summary,
      })),
      next: "Call relay_get_guide with a topic before the task.",
    };
  }
  const guide = relayTaskGuideCatalog.find((item) => item.topic === topic)!;
  return { topic: guide.topic, title: guide.title, markdown: formatRelayTaskGuide(guide) };
}

type TestCandidate = { id: string; name: string; text: string; steps: number; ready: boolean };

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
    return { id, name, text, steps: steps.length, ready: steps.length > 0 && !blocked };
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
            ? "Create a Test with relay_create_test."
            : "All checked Tests passed.",
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

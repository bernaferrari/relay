/**
 * `relay ci`: run every ready Test of an App, wait for each verdict, print
 * one table in Test order, and exit 0 (all passed), 1 (a Test failed), or 3
 * (Relay could not run something). The same verdicts go to --output/--junit.
 *
 * Independent Tests start together instead of strictly one after another:
 * the server already serializes what genuinely shares state (one physical
 * device, one account fixture, one invoked Lane, restrictive declared
 * effects), so queueing everything serially here only ever added wall-clock
 * time to unsigned browser suites. Starts are bounded so a cancellation
 * still leaves most of the suite unstarted rather than orphaned.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import type { WorkflowSnapshot } from "@relay/workflows";
import { createRelayOutcomeJobs } from "@relay/workflow-runners/outcomes";
import { callerCwd } from "./caller-cwd.js";
import { classifyError, ExitCode, UsageError } from "./errors.js";
import {
  ciJunit,
  ciMarkdown,
  formatCiReport,
  type CiSkipped,
  type CiTotals,
  type Verdict,
} from "./everyday-format.js";
import {
  appName,
  chooseApp,
  pickTest,
  readProjectConfig,
  resolveDevice,
  scenarioTests,
  type EverydayInvoke,
} from "./everyday-names.js";
import type { OperationInvoker } from "./invoke.js";
import { readVerdict } from "./outcome-runner.js";
import { waitForOutcome } from "./outcome-wait.js";
import type { CliOutput } from "./output.js";
import { testReadiness } from "./test-discovery.js";

export type CiOptions = {
  app?: string;
  tests: string[];
  device?: string;
  output?: string;
  junit?: string;
  confirmRisk?: true;
};

/** How many Tests may be in flight at once. Mirroring the default browser
 * host ceiling keeps a cancellation small: unpulled Tests never start, and
 * the server already queues any overflow behind its own target lanes. */
export const CI_START_CONCURRENCY = 8;

export type CiReport = {
  schemaVersion: 1;
  kind: "relay-ci";
  app: { id: string; name: string };
  device?: string;
  totals: CiTotals;
  verdicts: Verdict[];
  skipped: CiSkipped[];
};

/**
 * Which Tests to run. Named Tests (--test) always run; otherwise every ready
 * Test runs and the rest are listed as skipped. A future `--file`/folder of
 * YAML Tests would apply them first and feed their ids through here.
 */
export function selectCiTests(
  app: AppMap,
  wanted: readonly string[],
): { tests: AppMapScenarioTest[]; skipped: CiSkipped[] } {
  if (wanted.length) {
    const tests = wanted.map((name) => pickTest(app, name));
    return { tests: [...new Map(tests.map((test) => [test.id, test])).values()], skipped: [] };
  }
  const tests: AppMapScenarioTest[] = [];
  const skipped: CiSkipped[] = [];
  for (const test of scenarioTests(app).sort((a, b) => a.name.localeCompare(b.name))) {
    const readiness = testReadiness(app, test);
    if (readiness.ready) tests.push(test);
    else
      skipped.push({
        testId: test.id,
        name: test.name,
        reason: readiness.reason ?? readiness.label,
      });
  }
  return { tests, skipped };
}

function verdictWithoutRun(test: AppMapScenarioTest, snapshot: WorkflowSnapshot): Verdict {
  const problem = snapshot.problems[0];
  return {
    runId: "",
    title: test.name,
    status: snapshot.phase === "cancelled" ? "cancelled" : "blocked",
    summary: problem?.title ?? snapshot.progress.label,
    ...(problem?.detail ? { reason: problem.detail } : {}),
    steps: [],
  };
}

export function ciTotals(verdicts: readonly Verdict[], skipped: number): CiTotals {
  const count = (status: Verdict["status"]) =>
    verdicts.filter((verdict) => verdict.status === status).length;
  return {
    total: verdicts.length + skipped,
    passed: count("passed"),
    failed: count("failed"),
    blocked: count("blocked") + count("running"),
    cancelled: count("cancelled"),
    skipped,
    ...(verdicts.some((v) => (v.review?.pending ?? 0) > 0)
      ? { pendingReview: verdicts.reduce((sum, v) => sum + (v.review?.pending ?? 0), 0) }
      : {}),
  };
}

export function ciExitCode(totals: CiTotals, interrupted: boolean): ExitCode {
  if (interrupted) return ExitCode.cancellation;
  if (totals.failed > 0) return ExitCode.testFailed;
  if (totals.blocked > 0 || totals.cancelled > 0) return ExitCode.blocked;
  if (totals.pendingReview) return ExitCode.verificationIncomplete;
  return totals.passed > 0 ? ExitCode.success : ExitCode.blocked;
}

export async function runCiCommand(input: {
  options: CiOptions;
  client: OperationInvoker;
  invoke: EverydayInvoke;
  actorId: string;
  env: Record<string, string | undefined>;
  output: CliOutput;
  human: boolean;
  signal: AbortSignal;
  pollIntervalMs: number;
  /** Start one Test and wait for it to settle. Tests replace the workflow façade. */
  runTest?: (input: {
    appMapId: string;
    testId: string;
    targetId?: string;
    confirmRisk?: true;
  }) => Promise<WorkflowSnapshot>;
}): Promise<{ report: CiReport; exitCode: ExitCode; text: string }> {
  const { options, invoke, output, signal } = input;
  const config = readProjectConfig(input.env);
  const app = await chooseApp(invoke, options.app, config);
  const { tests, skipped } = selectCiTests(app, options.tests);
  const deviceName = options.device ?? config.device;
  const browserStartUrl = config.url ?? tests.find((test) => test.startUrl)?.startUrl;
  const targetId = deviceName
    ? await resolveDevice(invoke, deviceName, {
        ...(browserStartUrl ? { browserStartUrl } : {}),
      })
    : undefined;
  const runTest =
    input.runTest ??
    (async (request: {
      appMapId: string;
      testId: string;
      targetId?: string;
      confirmRisk?: true;
    }) => {
      const jobs = createRelayOutcomeJobs(
        {
          invoke: (id, payload) => invoke(id, payload as Record<string, unknown>),
          events: (onEvent, eventOptions) => input.client.events(onEvent, eventOptions),
        },
        { actorId: input.actorId },
      );
      const started = await jobs.run({ kind: "run-test", ...request });
      return waitForOutcome(
        jobs,
        started,
        signal,
        output,
        "outcome.run-test",
        input.pollIntervalMs,
      );
    });
  if (!tests.length) {
    output.heartbeat(`No ready Tests in ${appName(app)}. Run 'relay tests ${app.id}' to see why.`);
  }
  // Tests pipeline through a bounded pool in suite order. Verdicts are
  // assembled by index afterwards, so parallel execution never reorders the
  // report, and a cancellation still leaves unpulled Tests unstarted.
  const settled: (Verdict | undefined)[] = tests.map(() => undefined);
  let interrupted = false;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (!interrupted && !signal.aborted) {
      const index = cursor;
      cursor += 1;
      if (index >= tests.length) return;
      const test = tests[index]!;
      output.heartbeat(`[${index + 1}/${tests.length}] ${test.name}`);
      try {
        const result = await runTest({
          appMapId: app.id,
          testId: test.id,
          ...(targetId ? { targetId } : {}),
          ...(options.confirmRisk ? { confirmRisk: true } : {}),
        });
        const verdict = await readVerdict(input.client, result, signal);
        settled[index] =
          verdict && verdict.status !== "running"
            ? {
                ...verdict,
                title: verdict.title || test.name,
                review: {
                  pending: (result.kind === "run-test" ? result.review?.pending : undefined) ?? 0,
                },
              }
            : verdictWithoutRun(test, result);
      } catch (error) {
        const classified = classifyError(error);
        if (classified.exitCode === ExitCode.cancellation || signal.aborted) {
          interrupted = true;
          settled[index] = {
            runId: "",
            title: test.name,
            status: "cancelled",
            summary: "Stopped",
            steps: [],
          };
          return;
        }
        settled[index] = {
          runId: "",
          title: test.name,
          status: "blocked",
          summary: "Relay could not run this Test",
          reason: classified.message,
          steps: [],
        };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CI_START_CONCURRENCY, tests.length) }, () => worker()),
  );
  const verdicts: Verdict[] = settled.flatMap((verdict) => (verdict ? [verdict] : []));
  const totals = ciTotals(verdicts, skipped.length);
  const report: CiReport = {
    schemaVersion: 1,
    kind: "relay-ci",
    app: { id: app.id, name: appName(app) },
    ...(targetId ? { device: targetId } : {}),
    totals,
    verdicts,
    skipped,
  };
  const cwd = callerCwd(input.env);
  if (options.output)
    await writeReport(resolve(cwd, options.output), `${JSON.stringify(report, null, 2)}\n`);
  if (options.junit) {
    await writeReport(
      resolve(cwd, options.junit),
      ciJunit({ app: appName(app), verdicts, skipped, totals }),
    );
  }
  // Inside GitHub Actions, the verdicts also land on the job's summary page.
  const summaryPath = input.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(
      summaryPath,
      ciMarkdown({ app: appName(app), verdicts, skipped, totals }),
    ).catch(() => undefined);
  }
  return {
    report,
    exitCode: ciExitCode(totals, interrupted),
    text: formatCiReport({ app: appName(app), verdicts, skipped, totals }),
  };
}

async function writeReport(path: string, contents: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  } catch (error) {
    throw new UsageError(`Could not write ${path}: ${(error as Error).message}`);
  }
}

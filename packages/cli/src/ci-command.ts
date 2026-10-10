/**
 * `relay ci`: run every ready Test of an App, one after another, wait for each
 * verdict, print one table, and exit 0 (all passed), 1 (a Test failed), or 3
 * (Relay could not run something). The same verdicts go to --output/--junit.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import type { WorkflowSnapshot } from "@relay/workflows";
import { createRelayOutcomeJobs } from "@relay/workflows/outcomes";
import { callerCwd } from "./caller-cwd.js";
import { classifyError, ExitCode, UsageError } from "./errors.js";
import {
  ciJunit,
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
};

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
  };
}

export function ciExitCode(totals: CiTotals, interrupted: boolean): ExitCode {
  if (interrupted) return ExitCode.cancellation;
  if (totals.failed > 0) return ExitCode.testFailed;
  if (totals.blocked > 0 || totals.cancelled > 0) return ExitCode.blocked;
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
  }) => Promise<WorkflowSnapshot>;
}): Promise<{ report: CiReport; exitCode: ExitCode; text: string }> {
  const { options, invoke, output, signal } = input;
  const config = readProjectConfig(input.env);
  const app = await chooseApp(invoke, options.app, config);
  const { tests, skipped } = selectCiTests(app, options.tests);
  const deviceName = options.device ?? config.device;
  const targetId = deviceName ? await resolveDevice(invoke, deviceName) : undefined;
  const runTest =
    input.runTest ??
    (async (request: { appMapId: string; testId: string; targetId?: string }) => {
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
  const verdicts: Verdict[] = [];
  let interrupted = false;
  for (const [index, test] of tests.entries()) {
    output.heartbeat(`[${index + 1}/${tests.length}] ${test.name}`);
    try {
      const settled = await runTest({
        appMapId: app.id,
        testId: test.id,
        ...(targetId ? { targetId } : {}),
      });
      const verdict = await readVerdict(input.client, settled, signal);
      verdicts.push(
        verdict && verdict.status !== "running"
          ? { ...verdict, title: verdict.title || test.name }
          : verdictWithoutRun(test, settled),
      );
    } catch (error) {
      const classified = classifyError(error);
      if (classified.exitCode === ExitCode.cancellation || signal.aborted) {
        interrupted = true;
        verdicts.push({
          runId: "",
          title: test.name,
          status: "cancelled",
          summary: "Stopped",
          steps: [],
        });
        break;
      }
      verdicts.push({
        runId: "",
        title: test.name,
        status: "blocked",
        summary: "Relay could not run this Test",
        reason: classified.message,
        steps: [],
      });
    }
  }
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

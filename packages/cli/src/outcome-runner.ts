/** Everyday outcome verbs (run, record, connect, …) on top of the workflow façade. */
import { createRequire } from "node:module";
import type { WorkflowSnapshot } from "@relay/workflows";
import { createRelayOutcomeJobs } from "@relay/workflows/outcomes";
import type { parseCli } from "./config.js";
import { writeEvidenceReviewDir } from "./cli-out.js";
import { ExitCode } from "./errors.js";
import {
  chooseApp,
  findTestInApps,
  listApps,
  pickTest,
  readProjectConfig,
  resolveDevice,
  type EverydayInvoke,
} from "./everyday-names.js";
import type { Verdict } from "./everyday-format.js";
import { inspectRunOrWorkflow } from "./inspect-command.js";
import { invokeOperation, type OperationInvoker } from "./invoke.js";
import type { OutcomeCliIntent } from "./outcome-command.js";
import { assertOutcomeSucceeded, waitForOutcome } from "./outcome-wait.js";
import type { CliOutput } from "./output.js";
import { protocolOperationInput } from "./protocol-input.js";
import { readReplayLabTracePacks } from "./replay-lab-files.js";

function invoke(
  client: OperationInvoker,
  operationId: string,
  input: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  return invokeOperation(client, operationId, protocolOperationInput(operationId, input), signal);
}

/** The Run a settled `relay run` produced, if it got that far. */
export function settledRunId(snapshot: WorkflowSnapshot): string | undefined {
  if (snapshot.kind !== "run-test") return undefined;
  return snapshot.execution?.runId ?? snapshot.evidenceRefs.find((ref) => ref.kind === "run")?.id;
}

export async function readVerdict(
  client: OperationInvoker,
  snapshot: WorkflowSnapshot,
  signal: AbortSignal,
): Promise<Verdict | undefined> {
  const runId = settledRunId(snapshot);
  if (!runId) return undefined;
  try {
    const response = (await invoke(client, "run.verdict.get", { runId }, signal)) as {
      verdict?: Verdict;
    };
    return response?.verdict;
  } catch {
    // An older server without verdicts still gets the snapshot result.
    return undefined;
  }
}

/** 0 passed, 1 failed, 3 blocked, 7 cancelled, 10 passed with captures awaiting review. */
export function verdictExitCode(result: unknown): ExitCode | undefined {
  if (!result || typeof result !== "object" || !("verdict" in result)) return undefined;
  const verdict = (result as { verdict?: Verdict }).verdict;
  if (!verdict) return undefined;
  if (verdict.status === "failed") return ExitCode.testFailed;
  if (verdict.status === "blocked") return ExitCode.blocked;
  if (verdict.status === "cancelled") return ExitCode.cancellation;
  const pending = (result as { review?: { pending?: number } }).review?.pending ?? 0;
  return pending > 0 ? ExitCode.verificationIncomplete : ExitCode.success;
}

/**
 * Turn the names people type into ids: `relay run "Checkout works" --app Shop
 * --device ios`. relay.json in the caller's directory supplies app/device
 * defaults. Ids keep working unchanged.
 */
export async function resolveOutcomeNames(
  intent: OutcomeCliIntent,
  invokeOperation: EverydayInvoke,
  env: Record<string, string | undefined>,
): Promise<OutcomeCliIntent> {
  const usesDefaults =
    intent.kind === "run-test" ||
    intent.kind === "repeat-test" ||
    intent.kind === "record-test" ||
    intent.kind === "connect-target" ||
    intent.kind === "observe-target";
  const usesDevice = usesDefaults || intent.kind === "goal-start" || intent.kind === "goal-explore";
  if (!usesDevice) return intent;
  const config = usesDefaults ? readProjectConfig(env) : {};
  const next = { ...intent } as OutcomeCliIntent & {
    appMapId?: string;
    testId?: string;
    targetId?: string;
    laneId?: string;
  };
  if (next.kind === "run-test" || next.kind === "repeat-test") {
    if (next.appMapId ?? config.app) {
      const app = await chooseApp(invokeOperation, next.appMapId, config);
      next.appMapId = app.id;
      next.testId = pickTest(app, next.testId!).id;
    } else {
      const apps = await listApps(invokeOperation);
      if (apps.length) {
        const found = findTestInApps(apps, next.testId!);
        next.appMapId = found.app.id;
        next.testId = found.test.id;
      }
    }
  } else if (next.kind === "record-test" && (next.appMapId ?? config.app)) {
    next.appMapId = (await chooseApp(invokeOperation, next.appMapId, config)).id;
  }
  const device = next.targetId ?? (next.laneId ? undefined : config.device);
  if (device) next.targetId = await resolveDevice(invokeOperation, device);
  return next;
}

export function outcomeOperationId(kind: string): string {
  return kind === "proof-analyze" ? "outcome.proof-analyze" : `outcome.${kind}`;
}

export async function runOutcomeCommand(input: {
  parsed: Extract<ReturnType<typeof parseCli>, { command: "outcome" }>;
  client: OperationInvoker;
  signal: AbortSignal;
  output: CliOutput;
  pollIntervalMs: number;
  env: Record<string, string | undefined>;
}): Promise<unknown> {
  const { parsed, client, signal } = input;
  const jobs = createRelayOutcomeJobs(
    {
      invoke: (operationId, operationInput) => invoke(client, operationId, operationInput, signal),
      events: (onEvent, options) => client.events(onEvent, options),
    },
    { actorId: parsed.config.connection.actorId },
  );
  const intent = await resolveOutcomeNames(
    parsed.intent,
    (operationId, operationInput) => invoke(client, operationId, operationInput, signal),
    input.env,
  );
  if (intent.kind === "connect-target") return jobs.connect(intent);
  if (intent.kind === "observe-target") return jobs.observe(intent);
  if (intent.kind === "edit-recording") {
    const edited = await jobs.editRecording(intent);
    assertOutcomeSucceeded(edited);
    return edited;
  }
  if (intent.kind === "continue-repeat") {
    const started = await jobs.continueRepeat(intent);
    const settled = parsed.config.wait
      ? await waitForOutcome(
          jobs,
          started,
          signal,
          input.output,
          outcomeOperationId(intent.kind),
          input.pollIntervalMs,
        )
      : started;
    assertOutcomeSucceeded(settled);
    return settled;
  }
  if (intent.kind === "inspect-workflow") {
    return "workflowId" in intent
      ? jobs.inspect({ workflowId: intent.workflowId })
      : jobs.inspect({ legacyRef: intent.legacyRef });
  }
  if (intent.kind === "inspect") {
    return inspectRunOrWorkflow(client, intent.runOrWorkflowId, signal, (workflowId) =>
      jobs.inspect({ workflowId }),
    );
  }
  if (intent.kind === "cancel-run") {
    const cancelled = await jobs.cancelRun(intent);
    assertOutcomeSucceeded(cancelled);
    return cancelled;
  }
  if (intent.kind === "inspect-failure") return jobs.inspectFailure(intent);
  if (intent.kind === "goal-start") return jobs.goal(intent);
  if (intent.kind === "goal-resume") return jobs.resumeGoal(intent);
  if (intent.kind === "goal-reproduce") return jobs.reproduceGoal(intent);
  if (intent.kind === "goal-inspect") return jobs.inspectGoal(intent);
  if (intent.kind === "goal-cancel") return jobs.cancelGoal(intent);
  if (intent.kind === "goal-promote") return jobs.promoteGoal(intent);
  if (intent.kind === "goal-explore") return jobs.explore(intent);
  if (intent.kind === "goal-explore-resume") return jobs.resumeExploration(intent);
  if (intent.kind === "goal-explore-inspect") return jobs.inspectExploration(intent);
  if (intent.kind === "propose-repair") return jobs.proposeRepair(intent);
  if (intent.kind === "doctor") {
    const cliVersion = cliPackageVersion();
    const notAccepted = ["signing", "unfamiliar reviewer", "publication", "design partners"];
    try {
      const doctor = await invoke(client, "system.doctor.get", {}, signal);
      let serverVersion: string | undefined;
      try {
        const health = await invoke(client, "system.health.get", {}, signal);
        if (health && typeof health === "object" && "version" in health) {
          const version = (health as { version?: unknown }).version;
          if (typeof version === "string") serverVersion = version;
        }
      } catch {
        serverVersion = undefined;
      }
      return {
        schemaVersion: 1,
        kind: "relay-doctor",
        server: "reachable",
        cliVersion,
        ...(serverVersion ? { serverVersion } : {}),
        versionMatch: serverVersion === undefined ? undefined : serverVersion === cliVersion,
        doctor,
        notAccepted,
      };
    } catch (error) {
      return {
        schemaVersion: 1,
        kind: "relay-doctor",
        server: "unreachable",
        cliVersion,
        message: error instanceof Error ? error.message : String(error),
        notAccepted,
      };
    }
  }
  if (intent.kind === "export-evidence") {
    const evidence = await jobs.exportEvidence({ kind: "export-evidence", runId: intent.runId });
    if (intent.outputDir) {
      const walkthrough = await invoke(
        client,
        "run.walkthrough-pack.get",
        { runId: intent.runId },
        signal,
      );
      await writeEvidenceReviewDir({
        dir: intent.outputDir,
        evidence,
        walkthrough,
        runId: intent.runId,
      });
    }
    return evidence;
  }
  if (intent.kind === "replay-lab") {
    return jobs.replayLab({
      kind: "replay-lab",
      analysis: intent.analysis,
      tracePacks: await readReplayLabTracePacks(intent.paths),
    });
  }
  if (intent.kind === "verify-change" || intent.kind === "proof-analyze") {
    return jobs.verifyChange({ ...intent, kind: "verify-change" });
  }
  const started =
    intent.kind === "record-test"
      ? await jobs.record(intent)
      : intent.kind === "repeat-test"
        ? await jobs.repeat(intent)
        : await jobs.run(intent);
  const settled = parsed.config.wait
    ? await waitForOutcome(
        jobs,
        started,
        signal,
        input.output,
        outcomeOperationId(intent.kind),
        input.pollIntervalMs,
      )
    : started;
  if (intent.kind === "run-test" && parsed.config.wait && settled.kind === "run-test") {
    const verdict = await readVerdict(client, settled, signal);
    // The verdict owns the exit code (see verdictExitCode) so people and
    // agents see each step even when the Test failed.
    if (verdict && verdict.status !== "running") return { ...settled, verdict };
  }
  assertOutcomeSucceeded(settled);
  return settled;
}

export function doctorExitCode(result: unknown): ExitCode | undefined {
  if (
    !result ||
    typeof result !== "object" ||
    !("kind" in result) ||
    result.kind !== "relay-doctor"
  ) {
    return undefined;
  }
  const report = result as {
    server?: unknown;
    versionMatch?: unknown;
    doctor?: { ok?: unknown };
  };
  if (
    report.server !== "reachable" ||
    report.versionMatch === false ||
    report.doctor?.ok === false
  ) {
    return ExitCode.operationFailure;
  }
  return ExitCode.success;
}

export function cliPackageVersion(): string {
  const version = createRequire(import.meta.url)("../package.json").version;
  return typeof version === "string" && version ? version : "unknown";
}

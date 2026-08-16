import { createMemo, createSignal, type Accessor } from "solid-js";
import type { AppMap, AppMapCompiledTest, AppMapScenarioTest } from "@relay/protocol";
import type { DeviceInfo, JobInfo } from "./api-types";
import { isActiveTestRun, type TestRunLaunchState } from "../components/app-map-test-run-control";

type SaveState = "saved" | "saving" | "error";

/**
 * Compile, launch, cancel and attribute one Test run.
 *
 * It is kept out of the workspace component because a run has its own lifecycle:
 * a run belongs to the exact saved revision it compiled from, so editing a step
 * has to drop the plan rather than let a stale result look current.
 */
export function createAppMapTestRun(options: {
  appMap: Accessor<AppMap | null | undefined>;
  draft: Accessor<AppMapScenarioTest | undefined>;
  selectedDevice: Accessor<DeviceInfo | undefined>;
  saveState: Accessor<SaveState>;
  blockerCount: Accessor<number>;
  offline: Accessor<boolean>;
  jobs: Accessor<JobInfo[]>;
  refreshJobs: () => Promise<unknown>;
  cancelJob: (id: string) => Promise<unknown>;
  compileAndRun: (input: {
    appMapId: string;
    testId: string;
    expectedRevision: number;
    target:
      | { kind: "browser"; platform: "browser"; targetId: string }
      | { kind: "device"; platform: "android" | "ios"; targetId: string };
  }) => Promise<{
    plan: AppMapCompiledTest;
    planIdentity: { rootRecipeId: string };
    job: { id: string };
  }>;
  awaitPendingSaves: () => Promise<void>;
}) {
  const [plan, setPlan] = createSignal<AppMapCompiledTest>();
  const [jobId, setJobId] = createSignal<string>();
  const [launchState, setLaunchState] = createSignal<TestRunLaunchState>("idle");
  const [error, setError] = createSignal("");
  const [mismatched, setMismatched] = createSignal(false);
  const job = createMemo(() => {
    const id = jobId();
    return id ? options.jobs().find((candidate) => candidate.id === id) : undefined;
  });

  function forget(): void {
    setJobId();
    setLaunchState("idle");
    setError("");
    setMismatched(false);
  }

  const blockedReason = createMemo(() => {
    if (options.offline()) return "Reconnect Relay before running this Test.";
    if (options.saveState() === "saving") return "Wait for the latest changes to finish saving.";
    if (options.saveState() === "error") return "Retry the local changes before running.";
    const count = options.blockerCount();
    if (count) {
      return `Resolve ${count} authoring ${count === 1 ? "issue" : "issues"} before running.`;
    }
    const device = options.selectedDevice();
    if (!device) return "Choose a target before running this Test.";
    if (!device.platform) return "Refresh the selected target before running this Test.";
    return undefined;
  });

  async function run(): Promise<void> {
    const map = options.appMap();
    const test = options.draft();
    const device = options.selectedDevice();
    if (!map || !test || !device || blockedReason() || isActiveTestRun(job())) return;
    setLaunchState("preparing");
    setError("");
    setMismatched(false);
    setJobId();
    try {
      await options.awaitPendingSaves();
      const target =
        device.platform === "browser"
          ? ({ kind: "browser", platform: "browser", targetId: device.serial } as const)
          : ({ kind: "device", platform: device.platform!, targetId: device.serial } as const);
      const result = await options.compileAndRun({
        appMapId: map.id,
        testId: test.id,
        expectedRevision: map.revision,
        target,
      });
      setPlan(result.plan);
      setJobId(result.job.id);
      await options.refreshJobs();
      setLaunchState("idle");
      const queued = options.jobs().find((candidate) => candidate.id === result.job.id);
      if (queued && queued.action !== result.planIdentity.rootRecipeId) {
        setMismatched(true);
        setError("The queued job does not match this saved Test revision.");
        setLaunchState("error");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setLaunchState("error");
    }
  }

  async function cancel(): Promise<void> {
    const id = jobId();
    if (!id || !isActiveTestRun(job()) || launchState() === "canceling") return;
    setLaunchState("canceling");
    await options.cancelJob(id);
    await options.refreshJobs();
    setLaunchState(mismatched() ? "error" : "idle");
  }

  return {
    plan,
    job,
    jobId,
    launchState,
    error,
    blockedReason,
    run,
    cancel,
    /** A canonical reload invalidates the compiled plan but keeps run history. */
    clearPlan: () => setPlan(),
    /** A queued edit means the compiled plan no longer describes the draft. */
    onDraftEdited(): void {
      setPlan();
      if (!isActiveTestRun(job())) forget();
    },
    /** Switching Test or map starts a clean run slate. */
    reset(): void {
      setPlan();
      forget();
    },
    consumeResult(): string | undefined {
      const id = jobId();
      if (id) setJobId();
      return id;
    },
  };
}

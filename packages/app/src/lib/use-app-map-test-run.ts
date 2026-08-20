import { createMemo, createSignal, type Accessor } from "solid-js";
import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapTestStartup,
  OfflineTestPreflightReport,
} from "@relay/protocol";
import type { DeviceInfo, JobInfo } from "./api-types";
import { isActiveTestRun, type TestRunLaunchState } from "../components/app-map-test-run-control";
import { fullSurfaceScreenIds } from "./app-map-test-editor-model";
import { coldAppMapTestStartup, sameAppMapTestStartup } from "./app-map-test-startup-policy";

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
    surfaceCapture?: { forceRecaptureScreenIds: string[] };
    startup: AppMapTestStartup;
  }) => Promise<{
    plan: AppMapCompiledTest;
    planIdentity: { rootRecipeId: string };
    job: { id: string };
  }>;
  compile: (input: {
    appMapId: string;
    testId: string;
    entryCheckpointScreenId?: string;
  }) => Promise<{
    plan: AppMapCompiledTest;
    preflight: OfflineTestPreflightReport;
  }>;
  awaitPendingSaves: () => Promise<void>;
}) {
  const [plan, setPlan] = createSignal<AppMapCompiledTest>();
  const [jobId, setJobId] = createSignal<string>();
  const [launchState, setLaunchState] = createSignal<TestRunLaunchState>("idle");
  const [error, setError] = createSignal("");
  const [mismatched, setMismatched] = createSignal(false);
  const [freshEvidence, setFreshEvidence] = createSignal(false);
  const [startup, setStartupState] = createSignal<AppMapTestStartup>(coldAppMapTestStartup);
  const [preflight, setPreflight] = createSignal<OfflineTestPreflightReport>();
  const [preflightBusy, setPreflightBusy] = createSignal(false);
  const fullSurfaceIds = createMemo(() => {
    const test = options.draft();
    return test ? fullSurfaceScreenIds(test) : [];
  });
  const job = createMemo(() => {
    const id = jobId();
    return id ? options.jobs().find((candidate) => candidate.id === id) : undefined;
  });

  function forget(): void {
    setJobId();
    setLaunchState("idle");
    setError("");
    setMismatched(false);
    setPreflight();
  }

  /** Startup is part of the frozen run contract. Switching it invalidates any
   * plan/preflight compiled for the previous entry; leaving those visible
   * would make a warm selection look as if it had already been proved. */
  function setStartup(next: AppMapTestStartup): void {
    if (sameAppMapTestStartup(startup(), next)) return;
    setStartupState(next);
    setPlan();
    setPreflight();
    setError("");
  }

  const blockedReason = createMemo(() => {
    if (options.offline()) return "Reconnect Relay before running this Test.";
    if (options.saveState() === "saving") return "Wait for the latest changes to finish saving.";
    if (options.saveState() === "error") return "Retry the local changes before running.";
    const count = options.blockerCount();
    if (count) {
      return `Resolve ${count} authoring ${count === 1 ? "issue" : "issues"} before running.`;
    }
    const offlineBlockers = preflight()?.summary.blockers ?? 0;
    if (offlineBlockers) {
      return `Review ${offlineBlockers} offline ${offlineBlockers === 1 ? "issue" : "issues"} before Relay controls the device.`;
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
    const chosenStartup = startup();
    setLaunchState("preparing");
    setError("");
    setMismatched(false);
    setJobId();
    try {
      const compiled = await checkOffline(chosenStartup);
      if (!compiled) {
        setLaunchState("idle");
        return;
      }
      if (compiled.preflight.summary.blockers) {
        setLaunchState("idle");
        return;
      }
      const target =
        device.platform === "browser"
          ? ({ kind: "browser", platform: "browser", targetId: device.serial } as const)
          : ({ kind: "device", platform: device.platform!, targetId: device.serial } as const);
      const result = await options.compileAndRun({
        appMapId: map.id,
        testId: test.id,
        expectedRevision: map.revision,
        target,
        ...(freshEvidence() && fullSurfaceIds().length
          ? { surfaceCapture: { forceRecaptureScreenIds: fullSurfaceIds() } }
          : {}),
        startup: chosenStartup,
      });
      setPlan(result.plan);
      setJobId(result.job.id);
      await options.refreshJobs();
      setLaunchState("idle");
      const queued = options.jobs().find((candidate) => candidate.id === result.job.id);
      if (!sameAppMapTestStartup(result.plan.startup, chosenStartup)) {
        setMismatched(true);
        setError("Relay returned a plan with a different startup policy. Review this queued run.");
        setLaunchState("error");
      } else if (queued && queued.action !== result.planIdentity.rootRecipeId) {
        setMismatched(true);
        setError("The queued job does not match this saved Test revision.");
        setLaunchState("error");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setLaunchState("error");
    }
  }

  /** Compile against frozen evidence without allocating a target lease or
   * touching a device. This is the normal way to make authoring improvements
   * while hardware is unavailable. */
  async function checkOffline(
    chosenStartup = startup(),
  ): Promise<{ plan: AppMapCompiledTest; preflight: OfflineTestPreflightReport } | undefined> {
    const map = options.appMap();
    const test = options.draft();
    if (!map || !test || options.saveState() === "saving") return undefined;
    setPreflightBusy(true);
    setError("");
    try {
      await options.awaitPendingSaves();
      const currentMap = options.appMap();
      const currentTest = options.draft();
      if (!currentMap || !currentTest) return undefined;
      const compiled = await options.compile({
        appMapId: currentMap.id,
        testId: currentTest.id,
        ...(chosenStartup.mode === "verified-checkpoint"
          ? { entryCheckpointScreenId: chosenStartup.screenId }
          : {}),
      });
      if (!sameAppMapTestStartup(compiled.plan.startup, chosenStartup)) {
        setError("Relay compiled a different startup policy. It was not run.");
        return undefined;
      }
      setPlan(compiled.plan);
      setPreflight(compiled.preflight);
      return compiled;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    } finally {
      setPreflightBusy(false);
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
    preflight,
    preflightBlockers: () => preflight()?.summary.blockers ?? 0,
    preflightBusy,
    job,
    jobId,
    launchState,
    error,
    blockedReason,
    freshEvidence,
    setFreshEvidence,
    freshEvidenceAvailable: () => fullSurfaceIds().length > 0,
    startup,
    setStartup,
    run,
    checkOffline,
    cancel,
    /** A canonical reload invalidates the compiled plan but keeps run history. */
    clearPlan: () => setPlan(),
    /** A queued edit means the compiled plan no longer describes the draft. */
    onDraftEdited(): void {
      setPlan();
      setPreflight();
      if (!isActiveTestRun(job())) forget();
    },
    /** Switching Test or map starts a clean run slate. */
    reset(): void {
      setPlan();
      setStartupState(coldAppMapTestStartup);
      forget();
    },
    consumeResult(): string | undefined {
      const id = jobId();
      if (id) setJobId();
      return id;
    },
  };
}

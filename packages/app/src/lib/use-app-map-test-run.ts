import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapTestStartup,
  OfflineTestPreflightReport,
} from "@relay/protocol";
import type { DeviceInfo, JobInfo } from "./api-types";
import { isActiveTestRun, type TestRunLaunchState } from "./app-map-test-run-state";
import { fullSurfaceScreenIds } from "./app-map-test-editor-model";
import { coldAppMapTestStartup, sameAppMapTestStartup } from "./app-map-test-startup-policy";
import {
  appMapTestRuntimeProfileScope,
  appMapTestRuntimeProfileLabel,
  appMapTestRuntimeProfiles,
} from "./app-map-test-runtime-profile";
import {
  appMapTestCompileInput,
  createAppMapTestRunIntent,
  sameAppMapTestRunIntent,
  type AppMapTestRunIntent,
} from "./app-map-test-run-intent";

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
    targetProfileId?: string;
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
    targetProfileId?: string;
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
  const [freshEvidence, setFreshEvidenceState] = createSignal(false);
  const [startup, setStartupState] = createSignal<AppMapTestStartup>(coldAppMapTestStartup);
  const [targetProfileId, setTargetProfileIdState] = createSignal<string>();
  const [preflight, setPreflight] = createSignal<OfflineTestPreflightReport>();
  const [preflightBusy, setPreflightBusy] = createSignal(false);
  let runGeneration = 0;
  let preflightRequest = 0;
  let runContextKey: string | undefined;
  const fullSurfaceIds = createMemo(() => {
    const test = options.draft();
    return test ? fullSurfaceScreenIds(test) : [];
  });
  const targetProfiles = createMemo(() => appMapTestRuntimeProfiles(options.appMap()));
  const targetProfileScope = createMemo(() =>
    appMapTestRuntimeProfileScope({
      profiles: targetProfiles(),
      device: options.selectedDevice(),
      requestedProfileId: targetProfileId(),
    }),
  );
  const selectedTargetProfileId = createMemo(() => targetProfileScope().selectedProfileId);
  const targetProfileOptions = createMemo(() =>
    targetProfiles().map((profile) => ({
      id: profile.id,
      label: appMapTestRuntimeProfileLabel(profile),
    })),
  );
  const targetProfileMatchesSelectedDevice = createMemo(
    () =>
      targetProfileScope().status === "no-saved-profiles" ||
      targetProfileScope().status === "selected",
  );
  const requiresTargetProfileSelection = createMemo(() =>
    Boolean(
      preflight()?.findings.some(
        (finding) => finding.code === "raw-evidence-variant-selection-required",
      ),
    ),
  );
  const job = createMemo(() => {
    const id = jobId();
    return id ? options.jobs().find((candidate) => candidate.id === id) : undefined;
  });

  function currentRunIntent(chosenStartup = startup()): AppMapTestRunIntent | undefined {
    const map = options.appMap();
    const test = options.draft();
    if (!map || !test) return undefined;
    return createAppMapTestRunIntent({
      generation: runGeneration,
      appMap: map,
      test,
      device: options.selectedDevice(),
      targetProfileId: selectedTargetProfileId(),
      freshSurfaceScreenIds: freshEvidence() ? fullSurfaceIds() : undefined,
      startup: chosenStartup,
    });
  }

  function runContext(): string {
    const map = options.appMap();
    const test = options.draft();
    const device = options.selectedDevice();
    return JSON.stringify({
      map: map && [map.id, map.revision],
      test: test && [test.id, test.updatedAt],
      device: device && [device.serial, device.platform],
      targetProfileId: selectedTargetProfileId(),
      startup: startup(),
      freshEvidence: freshEvidence(),
    });
  }

  function invalidateRunContext(): void {
    runGeneration += 1;
    setPlan();
    setPreflight();
    setError("");
    if (launchState() === "preparing") setLaunchState("idle");
  }

  function syncRunContext(): void {
    const next = runContext();
    if (runContextKey === undefined) {
      runContextKey = next;
      return;
    }
    if (runContextKey === next) return;
    runContextKey = next;
    invalidateRunContext();
  }

  createEffect(syncRunContext);

  function isCurrentRunIntent(intent: AppMapTestRunIntent): boolean {
    const current = currentRunIntent(intent.startup);
    return Boolean(current && sameAppMapTestRunIntent(intent, current));
  }

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
    syncRunContext();
  }

  /** Selecting a profile only scopes the next offline proof. It never edits a
   * Test, changes device state, or chooses a locale from rendered copy. */
  function setTargetProfile(next: string | undefined): void {
    const profileId = next?.trim() || undefined;
    if (profileId !== undefined && !targetProfiles().some((profile) => profile.id === profileId)) {
      return;
    }
    if (targetProfileId() === profileId) return;
    setTargetProfileIdState(profileId);
    syncRunContext();
  }

  function setFreshEvidence(next: boolean): void {
    if (freshEvidence() === next) return;
    setFreshEvidenceState(next);
    syncRunContext();
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
    if (targetProfileScope().status === "no-compatible-profile") {
      return "No saved evidence profile matches this target. Capture one for the selected target before running.";
    }
    if (targetProfileScope().status === "selected-profile-incompatible") {
      return "The selected evidence profile belongs to a different target. Choose a profile captured for this target.";
    }
    if (targetProfileScope().status === "selection-required") {
      return "Choose a runtime evidence profile for the selected target before running this Test.";
    }
    if (!targetProfileMatchesSelectedDevice()) {
      return "Choose a runtime evidence profile for the selected target before running this Test.";
    }
    return undefined;
  });

  async function run(): Promise<void> {
    const intent = currentRunIntent();
    if (!intent?.target || blockedReason() || isActiveTestRun(job())) return;
    setLaunchState("preparing");
    setError("");
    setMismatched(false);
    setJobId();
    try {
      const compiled = await checkOffline(intent);
      if (!compiled) {
        if (isCurrentRunIntent(intent)) setLaunchState("idle");
        return;
      }
      if (compiled.preflight.summary.blockers) {
        if (isCurrentRunIntent(intent)) setLaunchState("idle");
        return;
      }
      const result = await options.compileAndRun({
        appMapId: intent.appMapId,
        testId: intent.testId,
        expectedRevision: intent.expectedRevision,
        target: intent.target,
        ...(intent.targetProfileId ? { targetProfileId: intent.targetProfileId } : {}),
        ...(intent.surfaceCapture ? { surfaceCapture: intent.surfaceCapture } : {}),
        startup: intent.startup,
      });
      if (!isCurrentRunIntent(intent)) {
        await options.cancelJob(result.job.id).catch(() => undefined);
        await options.refreshJobs();
        return;
      }
      setPlan(result.plan);
      setJobId(result.job.id);
      await options.refreshJobs();
      setLaunchState("idle");
      const queued = options.jobs().find((candidate) => candidate.id === result.job.id);
      if (!sameAppMapTestStartup(result.plan.startup, intent.startup)) {
        setMismatched(true);
        setError("Relay returned a plan with a different startup policy. Review this queued run.");
        setLaunchState("error");
      } else if (queued && queued.action !== result.planIdentity.rootRecipeId) {
        setMismatched(true);
        setError("The queued job does not match this saved Test revision.");
        setLaunchState("error");
      }
    } catch (failure) {
      if (!isCurrentRunIntent(intent)) return;
      setError(failure instanceof Error ? failure.message : String(failure));
      setLaunchState("error");
    }
  }

  /** Compile against frozen evidence without allocating a target lease or
   * touching a device. This is the normal way to make authoring improvements
   * while hardware is unavailable. */
  async function checkOffline(
    suppliedIntent?: AppMapTestRunIntent,
  ): Promise<{ plan: AppMapCompiledTest; preflight: OfflineTestPreflightReport } | undefined> {
    const intent = suppliedIntent ?? currentRunIntent();
    if (!intent || options.saveState() === "saving") return undefined;
    const request = ++preflightRequest;
    setPreflightBusy(true);
    setError("");
    try {
      await options.awaitPendingSaves();
      if (!isCurrentRunIntent(intent)) return undefined;
      const compiled = await options.compile(appMapTestCompileInput(intent));
      if (!isCurrentRunIntent(intent)) return undefined;
      if (
        compiled.plan.appMapId !== intent.appMapId ||
        compiled.plan.test.id !== intent.testId ||
        compiled.plan.appMapRevision !== intent.expectedRevision ||
        !sameAppMapTestStartup(compiled.plan.startup, intent.startup)
      ) {
        setError("Relay compiled a different startup policy. It was not run.");
        return undefined;
      }
      setPlan(compiled.plan);
      setPreflight(compiled.preflight);
      return compiled;
    } catch (failure) {
      if (!isCurrentRunIntent(intent)) return undefined;
      setError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    } finally {
      if (request === preflightRequest) setPreflightBusy(false);
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
    targetProfileId: selectedTargetProfileId,
    targetProfileOptions,
    targetProfileMatchesSelectedDevice,
    requiresTargetProfileSelection,
    setTargetProfile,
    run,
    checkOffline,
    cancel,
    /** A canonical reload invalidates the compiled plan but keeps run history. */
    clearPlan: () => setPlan(),
    /** A queued edit means the compiled plan no longer describes the draft. */
    onDraftEdited(): void {
      invalidateRunContext();
      if (!isActiveTestRun(job())) forget();
    },
    /** Switching Test or map starts a clean run slate. */
    reset(): void {
      setStartupState(coldAppMapTestStartup);
      invalidateRunContext();
      forget();
    },
    consumeResult(): string | undefined {
      const id = jobId();
      if (id) setJobId();
      return id;
    },
  };
}

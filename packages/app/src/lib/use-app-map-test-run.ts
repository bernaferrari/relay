import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import {
  createRelayWorkflows,
  type DurableWorkflowHandle,
  type FrozenRunTestIdentity,
  type RelayInvokeClient,
  type RunTestSnapshot,
  type WorkflowRef,
} from "@relay/workflows";
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
import { goldenLoopTelemetry } from "./golden-loop-telemetry";

type SaveState = "saved" | "saving" | "error";
type RunAttentionMarker = {
  schemaVersion: 1;
  frozen: FrozenRunTestIdentity;
  startedAfter: number;
  workflow?: DurableWorkflowHandle;
  /** Read-only compatibility for a marker written before durable Runs. */
  ref?: string;
};
type RunMarkerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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
  client: RelayInvokeClient;
  compile: (input: {
    appMapId: string;
    testId: string;
    entryCheckpointScreenId?: string;
    targetProfileId?: string;
    forceRecaptureScreenIds?: string[];
  }) => Promise<{
    plan: AppMapCompiledTest;
    preflight: OfflineTestPreflightReport;
  }>;
  awaitPendingSaves: () => Promise<void>;
  /** Injectable only for deterministic remount/recovery tests. */
  storage?: RunMarkerStorage;
}) {
  const workflows = createRelayWorkflows(options.client);
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
  const [workflow, setWorkflow] = createSignal<RunTestSnapshot>();
  const [attentionMarker, setAttentionMarker] = createSignal<RunAttentionMarker>();
  let runGeneration = 0;
  let preflightRequest = 0;
  let recoveryRequest = 0;
  const measuredJobs = new Set<string>();
  let runContextKey: string | undefined;
  let recoveredMarkerKey: string | undefined;
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
  const targetProfileNotice = createMemo(() => {
    const scope = targetProfileScope();
    if (scope.status === "selected-profile-incompatible" && scope.selectedProfile) {
      return `Evidence only: ${appMapTestRuntimeProfileLabel(scope.selectedProfile)}. Capture evidence for this target.`;
    }
    if (scope.status !== "no-compatible-profile") return undefined;
    const profiles = targetProfiles();
    return profiles.length === 1
      ? `Evidence only: ${appMapTestRuntimeProfileLabel(profiles[0]!)}. Capture evidence for this target.`
      : "Saved evidence belongs to a different target. Capture evidence for this target.";
  });
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
  createEffect(() => {
    const current = job();
    const intent = currentRunIntent();
    if (
      !current ||
      !intent ||
      measuredJobs.has(current.id) ||
      !["ok", "healed", "error", "cancelled"].includes(current.status)
    ) {
      return;
    }
    measuredJobs.add(current.id);
    void goldenLoopTelemetry.emit({
      projectKey: intent.appMapId,
      journeyKey: intent.testId,
      type: "boundary",
      boundary: "run",
      outcome: current.status === "ok" || current.status === "healed" ? "completed" : "failed",
    });
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

  function markerStorage(): RunMarkerStorage | undefined {
    if (options.storage) return options.storage;
    try {
      return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
      return undefined;
    }
  }

  function attentionKey(): string | undefined {
    const intent = currentRunIntent();
    if (!intent?.target) return undefined;
    const target =
      intent.target.kind === "device"
        ? `${intent.target.platform}:${intent.target.targetId}`
        : `browser:${intent.target.targetId}`;
    return `relay.run-test-attention.v1:${encodeURIComponent(intent.appMapId)}:${encodeURIComponent(intent.testId)}:${encodeURIComponent(target)}`;
  }

  function readAttentionMarker(key: string): RunAttentionMarker | undefined {
    try {
      const raw = markerStorage()?.getItem(key);
      if (!raw) return undefined;
      const value = JSON.parse(raw) as Partial<RunAttentionMarker>;
      const intent = currentRunIntent();
      if (
        value.schemaVersion !== 1 ||
        typeof value.startedAfter !== "number" ||
        !value.frozen ||
        !intent ||
        value.frozen.appMapId !== intent.appMapId ||
        value.frozen.testId !== intent.testId ||
        JSON.stringify(value.frozen.target) !== JSON.stringify(intent.target) ||
        (value.workflow !== undefined &&
          (typeof value.workflow.workflowId !== "string" ||
            !value.workflow.workflowId ||
            !Number.isSafeInteger(value.workflow.expectedVersion) ||
            value.workflow.expectedVersion < 0)) ||
        (value.ref !== undefined && typeof value.ref !== "string")
      ) {
        return undefined;
      }
      return value as RunAttentionMarker;
    } catch {
      return undefined;
    }
  }

  function persistAttention(marker: RunAttentionMarker, explicitKey?: string): void {
    const key = explicitKey ?? attentionKey();
    if (!key) return;
    try {
      markerStorage()?.setItem(key, JSON.stringify(marker));
    } catch {
      // Losing local persistence must not clear the in-memory review boundary.
    }
    if (key === attentionKey()) setAttentionMarker(marker);
  }

  function clearAttention(explicitKey?: string): void {
    const key = explicitKey ?? attentionKey();
    if (key) {
      try {
        markerStorage()?.removeItem(key);
      } catch {
        // Canonical reconciliation already succeeded; a stale marker is safe.
      }
    }
    if (key === attentionKey()) setAttentionMarker();
  }

  function persistedAttention(): RunAttentionMarker | undefined {
    const key = attentionKey();
    return attentionMarker() ?? (key ? readAttentionMarker(key) : undefined);
  }

  async function reconcileAttention(marker: RunAttentionMarker, key: string): Promise<void> {
    const request = ++recoveryRequest;
    const recovered = marker.workflow
      ? await workflows.inspectDurable(marker.workflow.workflowId)
      : marker.ref
        ? await workflows.inspect(marker.ref as WorkflowRef)
        : await workflows.recover({
            kind: "run-test",
            frozen: marker.frozen,
            startedAfter: marker.startedAfter,
          });
    if (request !== recoveryRequest || attentionKey() !== key || recovered.kind !== "run-test") {
      return;
    }
    setWorkflow(recovered);
    setJobId(recovered.execution?.jobId);
    setError(recovered.problems.at(-1)?.detail ?? "");
    if (
      (recovered.workflow || recovered.ref) &&
      (recovered.phase === "queued" ||
        recovered.phase === "running" ||
        recovered.phase === "paused" ||
        recovered.phase === "needs-attention")
    ) {
      persistAttention(
        {
          ...marker,
          frozen: recovered.frozen ?? marker.frozen,
          ...(recovered.workflow ? { workflow: recovered.workflow } : {}),
          ...(recovered.ref ? { ref: recovered.ref } : {}),
        },
        key,
      );
    } else if (recovered.execution?.jobId) {
      clearAttention(key);
    }
    await options.refreshJobs();
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
  createEffect(() => {
    const key = attentionKey();
    if (!key) {
      recoveredMarkerKey = undefined;
      setAttentionMarker();
      return;
    }
    const marker = readAttentionMarker(key);
    setAttentionMarker(marker);
    const markerKey = marker
      ? `${key}:${marker.startedAfter}:${marker.workflow?.workflowId ?? marker.ref ?? "unresolved"}:${marker.workflow?.expectedVersion ?? ""}`
      : undefined;
    if (!marker || markerKey === recoveredMarkerKey) return;
    recoveredMarkerKey = markerKey;
    void reconcileAttention(marker, key);
  });

  function isCurrentRunIntent(intent: AppMapTestRunIntent): boolean {
    const current = currentRunIntent(intent.startup);
    return Boolean(current && sameAppMapTestRunIntent(intent, current));
  }

  function forget(): void {
    setJobId();
    setWorkflow();
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

  const blockedReason = () => {
    const persisted = persistedAttention();
    if (persisted && !isActiveTestRun(job())) {
      return persisted.workflow || persisted.ref
        ? "Inspect the existing run before starting another run."
        : "Inspect the uncertain run outcome before starting another run.";
    }
    const currentWorkflow = workflow();
    if (currentWorkflow?.phase === "needs-attention") {
      return (
        currentWorkflow.problems.at(-1)?.recovery ??
        "Inspect the uncertain run outcome before starting another run."
      );
    }
    if (options.offline()) return "Reconnect Relay before running this Test.";
    if (options.saveState() === "saving") return "Wait for the latest changes to finish saving.";
    if (options.saveState() === "error") return "Retry the local changes before running.";
    const count = options.blockerCount();
    if (count) {
      return `This Test needs ${count} ${count === 1 ? "fix" : "fixes"} before it can run.`;
    }
    const offlineBlockers = preflight()?.summary.blockers ?? 0;
    if (offlineBlockers) {
      return `Review ${offlineBlockers} offline ${offlineBlockers === 1 ? "issue" : "issues"} before Relay controls the device.`;
    }
    const device = options.selectedDevice();
    if (!device) return "Choose a Device before running this Test.";
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
  };

  async function run(): Promise<void> {
    const pendingAttention = persistedAttention();
    const pendingKey = attentionKey();
    if (pendingAttention && pendingKey) {
      await reconcileAttention(pendingAttention, pendingKey);
      return;
    }
    const intent = currentRunIntent();
    if (!intent?.target || blockedReason() || isActiveTestRun(job())) return;
    setLaunchState("preparing");
    setError("");
    setMismatched(false);
    setJobId();
    const startedAfter = Date.now();
    const workflowRequestId = crypto.randomUUID();
    void goldenLoopTelemetry.emit({
      projectKey: intent.appMapId,
      journeyKey: intent.testId,
      type: "boundary",
      boundary: "run",
      outcome: "started",
    });
    const dispatchKey = attentionKey();
    const preliminaryMarker: RunAttentionMarker = {
      schemaVersion: 1,
      frozen: {
        appMapId: intent.appMapId,
        appMapRevision: intent.expectedRevision,
        testId: intent.testId,
        planDigest: "pending",
        target: intent.target,
        startup: intent.startup,
        workflowRequestId,
        ...(intent.targetProfileId ? { targetProfileId: intent.targetProfileId } : {}),
        ...(intent.surfaceCapture
          ? {
              capture: {
                fullSurfaceScreenIds: [...intent.surfaceCapture.forceRecaptureScreenIds],
              },
            }
          : {}),
      },
      startedAfter,
    };
    persistAttention(preliminaryMarker, dispatchKey);
    try {
      const result = await workflows.start({
        kind: "run-test",
        appMapId: intent.appMapId,
        testId: intent.testId,
        revision: { exact: intent.expectedRevision },
        target: intent.target,
        ...(intent.targetProfileId ? { targetProfileId: intent.targetProfileId } : {}),
        ...(intent.surfaceCapture
          ? { capture: { fullSurfaceScreenIds: intent.surfaceCapture.forceRecaptureScreenIds } }
          : {}),
        startup: intent.startup,
        workflowRequestId,
        continuation: "durable",
      });
      setWorkflow(result);
      void goldenLoopTelemetry.emit({
        projectKey: intent.appMapId,
        journeyKey: intent.testId,
        type: "action-latency",
        action: "run",
        durationMs: Math.max(0, Date.now() - startedAfter),
      });
      if (
        result.phase === "queued" ||
        result.phase === "running" ||
        result.phase === "paused" ||
        result.phase === "needs-attention"
      ) {
        persistAttention(
          {
            ...preliminaryMarker,
            frozen: result.frozen ?? preliminaryMarker.frozen,
            startedAfter,
            ...(result.workflow ? { workflow: result.workflow } : {}),
            ...(result.ref ? { ref: result.ref } : {}),
          },
          dispatchKey,
        );
      } else {
        clearAttention(dispatchKey);
      }
      if (result.compiled) {
        setPlan(result.compiled.plan);
        setPreflight(result.compiled.preflight);
      }
      if (!isCurrentRunIntent(intent)) {
        if (result.allowedNextActions.includes("cancel")) {
          if (result.workflow) {
            await workflows.cancelRun(result.workflow).catch(() => undefined);
          } else if (result.ref) {
            await workflows
              .advance({ action: "cancel", ref: result.ref, expectedVersion: result.version })
              .catch(() => undefined);
          }
        }
        await options.refreshJobs();
        return;
      }
      setJobId(result.execution?.jobId);
      await options.refreshJobs();
      setLaunchState("idle");
      const queued = options.jobs().find((candidate) => candidate.id === result.execution?.jobId);
      if (
        result.phase === "needs-attention" ||
        (!result.workflow && !result.ref) ||
        !result.execution?.jobId
      ) {
        setError(result.problems.at(-1)?.detail ?? result.progress.label);
      } else if (
        result.compiled &&
        !sameAppMapTestStartup(result.compiled.plan.startup, intent.startup)
      ) {
        setMismatched(true);
        setError("Relay returned a plan with a different startup policy. Review this queued run.");
        setLaunchState("error");
      } else if (queued && queued.action !== result.frozen?.rootRecipeId) {
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
    const active = workflow();
    if (
      (!active?.workflow && !active?.ref) ||
      !isActiveTestRun(job()) ||
      launchState() === "canceling"
    ) {
      return;
    }
    setLaunchState("canceling");
    const inspected = active.workflow
      ? await workflows.inspectDurable(active.workflow.workflowId)
      : await workflows.inspect(active.ref!);
    if (inspected.kind !== "run-test") return;
    setWorkflow(inspected);
    if (!inspected.allowedNextActions.includes("cancel")) {
      setError(inspected.problems.at(-1)?.detail ?? inspected.progress.label);
      setLaunchState(inspected.phase === "needs-attention" ? "idle" : "error");
      return;
    }
    const cancelled = inspected.workflow
      ? await workflows.cancelRun(inspected.workflow)
      : await workflows.advance({
          action: "cancel",
          ref: inspected.ref!,
          expectedVersion: inspected.version,
        });
    if (cancelled.kind !== "run-test") return;
    setWorkflow(cancelled);
    if (cancelled.phase === "needs-attention") {
      persistAttention({
        schemaVersion: 1,
        frozen: cancelled.frozen ?? active.frozen!,
        startedAfter: Date.now(),
        ...(cancelled.workflow ? { workflow: cancelled.workflow } : {}),
        ...(cancelled.ref ? { ref: cancelled.ref } : {}),
      });
    } else {
      clearAttention();
    }
    setError(cancelled.problems.at(-1)?.detail ?? "");
    await options.refreshJobs();
    setLaunchState(
      cancelled.phase === "needs-attention" ? "idle" : mismatched() ? "error" : "idle",
    );
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
    targetProfileNotice,
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

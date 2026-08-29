import { createSignal, createEffect, createMemo, onCleanup } from "solid-js";
import { createSimpleContext } from "@relay/ui/context/helper";
import type {
  DiscoverySession,
  CompatibilityMatrix,
  TargetProfile,
  TargetDefinition,
} from "@relay/protocol";
import { usePlatform } from "./platform";
import { toast } from "./toast";
import { humanError } from "../lib/human-error";
import { createServerCapture } from "../lib/server-capture";
import {
  accessibilityCollectionEnabled,
  parseAccessibilityOverlayMode,
  type AccessibilityOverlayMode,
} from "../lib/accessibility-overlay-mode";
import { createServerTargetController } from "../lib/server-target-controller";
import { createServerDiscoveryController } from "../lib/server-discovery-controller";
import {
  listActions,
  bootDevice as bootDeviceRequest,
  authorizeDevice as authorizeDeviceRequest,
} from "../lib/server-target-remote";
import { createServerPrivacyController } from "../lib/server-privacy-controller";
import { createServerCombineController } from "../lib/server-combine-controller";
import { createServerRunReportController } from "../lib/server-run-report-controller";
import type {
  ActionInfo,
  DeviceInfo,
  Frame,
  HealthState,
  JobInfo,
  PersistedRun,
  SnapshotState,
} from "../lib/api-types";
import { visualBaselineFrameUrl as buildVisualBaselineFrameUrl } from "../lib/server-urls";
import { createServerAuthoringController } from "../lib/server-authoring-controller";
import { createServerProjectController } from "../lib/server-project-controller";
import { createServerJobController } from "../lib/server-job-controller";
import { createServerTimelineController } from "../lib/server-timeline-controller";
import { createServerEventController } from "../lib/server-event-controller";
import { createServerDeviceSetupController } from "../lib/server-device-setup-controller";
import { createServerDeviceInventoryController } from "../lib/server-device-inventory-controller";
import { createServerAppMapController } from "../lib/server-app-map-controller";
import { refreshLiveDeviceEvidence } from "../lib/live-device-refresh";
import { createServerTargetRecovery } from "../lib/server-target-recovery";
import { createServerTargetSessionController } from "../lib/server-target-session-controller";
import { createServerProviderLifecycle } from "../lib/server-provider-lifecycle";
import { createServerWorkspaceController } from "../lib/server-workspace-controller";
import { createServerConnectionController } from "../lib/server-connection-controller";
import { createServerTargetHealthController } from "../lib/server-target-health-controller";
import { createServerBrowserDeviceController } from "../lib/server-browser-device-controller";

// Re-export API types so existing `from "../context/server"` imports keep working.
export type {
  ActionInfo,
  DeviceInfo,
  Frame,
  HealthState,
  JobInfo,
  LogLine,
  PersistedRun,
  RecordedNodeEvidence,
  RecordedSelectorCandidate,
  RecordedStepEvidence,
  RecipeParameter,
  RecipeInfo,
  RecipeStability,
  RecipeStep,
  RunEvidenceQuery,
  SnapshotNode,
  SnapshotState,
  StepPoint,
  StepTarget,
  TraceFrameRef,
  TraceStep,
  LocalSchedule,
} from "../lib/api-types";

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  gate: false,
  init: (props: { pollMs?: number } = {}) => {
    const platform = usePlatform();
    const pollMs = props.pollMs ?? 5000;

    const [health, setHealth] = createSignal<HealthState>("unknown");
    const [devices, setDevices] = createSignal<DeviceInfo[]>([]);
    const [targets, setTargets] = createSignal<TargetDefinition[]>([]);
    const [targetProfiles, setTargetProfiles] = createSignal<TargetProfile[]>([]);
    const [matrices, setMatrices] = createSignal<CompatibilityMatrix[]>([]);
    const [discoverySessions, setDiscoverySessions] = createSignal<DiscoverySession[]>([]);
    const [activeDiscoverySessionId, setActiveDiscoverySessionId] = createSignal<string | null>(
      null,
    );
    const [actions, setActions] = createSignal<ActionInfo[]>([]);
    const {
      selectedAppMapId,
      setSelectedAppMapId,
      prodAccountMatch,
      setProdAccountMatch,
      restore: restoreWorkspace,
      normalizeSelection: normalizeWorkspaceSelection,
    } = createServerWorkspaceController({ storage: platform.storage, appMaps: () => appMaps() });
    const [jobs, setJobs] = createSignal<JobInfo[]>([]);
    const [persistedRuns, setPersistedRuns] = createSignal<PersistedRun[]>([]);
    const [runsRoot, setRunsRoot] = createSignal("");
    const [selectedDevice, setSelectedDevice] = createSignal<string | null>(null);
    const [selectedAction, setSelectedAction] = createSignal<string | null>(null);
    const [selectedJobId, setSelectedJobId] = createSignal<string | null>(null);
    const [running, setRunning] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [snapshot, setSnapshot] = createSignal<SnapshotState>(null);
    const [busyCapture, setBusyCapture] = createSignal(false);
    const [accessibilityMode, setAccessibilityModeState] =
      createSignal<AccessibilityOverlayMode>("hover");
    function setAccessibilityMode(mode: AccessibilityOverlayMode): void {
      setAccessibilityModeState(mode);
      if (!accessibilityCollectionEnabled(mode)) setSnapshot(null);
      void Promise.resolve(platform.storage.set("accessibilityOverlayMode", mode)).catch(
        () => undefined,
      );
    }
    const [liveFrame, setLiveFrame] = createSignal<Frame | null>(null);
    const [liveCaptureIssue, setLiveCaptureIssue] = createSignal<string | null>(null);
    let resetBrowserDeviceForConnection = (): void => undefined;
    const [clock, setClock] = createSignal(Date.now());
    let clockTimer: NodeJS.Timeout | undefined;

    const {
      serverUrl,
      actorId,
      resolveConnection,
      setServerUrl,
      connectedClient,
      runAction,
      previewRequestHeaders,
      currentClient,
      currentConnection,
      projectId,
    } = createServerConnectionController({
      platform,
      beforeServerChange: () => {
        clearPrivacyPolicies();
        resetBrowserDeviceForConnection();
      },
      afterServerChange: () => connectSse(),
    });
    const { targetHealth, refreshTargetHealth } = createServerTargetHealthController({
      selectedDevice,
      serverHealth: health,
      runAction,
    });

    const {
      logs,
      appendLog,
      clearLogs,
      frames,
      frameIndex,
      setFrameIndex,
      currentFrame,
      playing,
      pushFrame,
      clearFrames,
      togglePlayback,
      stopPlayback,
    } = createServerTimelineController();

    const {
      appleDeviceSetup,
      androidDeviceSetup,
      refreshAppleDeviceSetup,
      preflightAppleDeviceSetup,
      refreshAndroidDeviceSetup,
      loadAndroidAppLocales,
      saveAppleDeviceSetup,
      saveIosLivePreview,
    } = createServerDeviceSetupController({
      client: connectedClient,
      selectedDevice,
      setLiveCaptureIssue,
    });
    const {
      redactionPolicy,
      evidenceCollectionPolicy,
      refreshRedactionPolicy,
      refreshEvidenceCollectionPolicy,
      updateRedactionEnabled,
      updateSensitiveEvidenceConsent,
      clearPrivacyPolicies,
    } = createServerPrivacyController(connectedClient);

    function clearLiveCaptureIssue(): void {
      setLiveCaptureIssue(null);
    }

    let targetSession!: ReturnType<typeof createServerTargetSessionController>;
    const {
      deviceDiscoveryStatus,
      refreshDevices,
      selectedDeviceAvailable,
      setSelectedDeviceAvailable,
    } = createServerDeviceInventoryController({
      client: connectedClient,
      health,
      devices,
      setDevices,
      selectedDevice,
      selectDevice: (serial) => targetSession.selectDevice(serial),
      validateSelectedControl: (serial) => targetSession.validateSelectedControl(serial),
      resetLivePreview: () => resetLivePreview(),
      error,
      setError,
    });
    targetSession = createServerTargetSessionController({
      client: currentClient,
      connection: currentConnection,
      devices,
      health,
      selectedDevice,
      setSelectedDevice,
      selectedDeviceAvailable,
      setSelectedDeviceAvailable,
      persistSelectedDevice: (serial) => {
        void Promise.resolve(platform.storage.set("selectedDevice", serial ?? "")).catch(
          () => undefined,
        );
      },
      resetLivePreview: () => resetLivePreview(),
      setError,
    });
    const {
      selectedLeaseId,
      controlIssue,
      canTakeControl: canTakeControlOfSelectedDevice,
      takingControl: takingControlOfSelectedDevice,
      setControlIssue,
      selectDevice: selectDeviceRemote,
      takeControl: takeControlOfSelectedDevice,
      release: releaseSelectedTargetControl,
    } = targetSession;

    const {
      refreshTargets,
      refreshTargetProfiles,
      refreshMatrices,
      saveCompatibilityMatrix: saveCompatibilityMatrixRemote,
      deleteCompatibilityMatrix: deleteCompatibilityMatrixRemote,
      resolveCompatibilityMatrix: resolveCompatibilityMatrixRemote,
      loadCompatibilityMatrixYaml,
      importCompatibilityMatrixYaml,
      saveBrowserTarget,
      deleteTargetRemote,
      preflightTargetRemote,
      openBrowserTarget,
    } = createServerTargetController({
      client: connectedClient,
      health,
      matrices,
      selectedDevice,
      setTargets,
      setTargetProfiles,
      setMatrices,
      selectDevice: selectDeviceRemote,
      refreshDevices,
      appendLog,
    });

    function dismissError() {
      setError(null);
    }

    const isOffline = () => health() === "offline";
    const isEmptyDevices = () => devices().length === 0;

    async function refreshActions() {
      if (health() === "offline") return;
      try {
        const list = await listActions(await connectedClient());
        setActions(list);
      } catch (err) {
        if (health() === "offline") return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    const { refreshDiscoverySessions, ...discoveryApi } = createServerDiscoveryController({
      client: connectedClient,
      health,
      serverUrl,
      discoverySessions,
      setDiscoverySessions,
      activeDiscoverySessionId,
      setActiveDiscoverySessionId,
    });

    const { appMaps, appMapsLoaded, degradedAppMaps, refreshAppMaps, loadAppMap, createAppMap } =
      createServerAppMapController({ health, runAction });

    const {
      authoringSessions,
      refreshAuthoringSessions,
      createAuthoringSession,
      observeAuthoringSession,
      captureAuthoringScreen,
      startAuthoringSession,
      interactAuthoringSession,
      stopAuthoringSession,
      trimAuthoringTake,
      reorderAuthoringTake,
      replaceAuthoringAction,
      replayAuthoringTake,
      commitAuthoringSession,
      discardAuthoringSession,
      cancelAuthoringSession,
      authoringEvidenceUrl,
    } = createServerAuthoringController({
      client: connectedClient,
      serverUrl,
      selectedAppMapId,
      selectedDevice,
      refreshAppMaps,
    });

    const {
      projectVariables,
      refreshProjectVariables,
      saveProjectVariables,
      generate,
      schedules,
      scheduleRecipe,
      refreshSchedules,
      deleteLocalSchedule,
    } = createServerProjectController({
      client: connectedClient,
      currentClient,
      health,
      selectedDevice,
      devices,
    });

    const {
      refreshJobs,
      refreshRuns,
      cancelJob: cancelJobRemote,
      pauseJob: pauseJobRemote,
      resumeJob: resumeJobRemote,
      activeJob,
      isPaused,
      queuedJobs,
    } = createServerJobController({
      client: connectedClient,
      health,
      jobs,
      setJobs,
      persistedRuns,
      setPersistedRuns,
      setRunning,
      selectedJobId,
      appendLog,
    });

    const {
      loadRunDetail,
      loadRunSignals,
      loadRunEvidence,
      compareVisualRun,
      reviewVisualRun,
      reviewRun,
      listRunShares,
      createRunShare,
      revokeRunShare,
    } = createServerRunReportController({
      client: connectedClient,
      runAction,
      setJobs,
      setPersistedRuns,
      refreshRuns: async () => void (await refreshRuns()),
    });

    async function pollHealth() {
      try {
        const h = await (
          await connectedClient()
        ).invoke("system.health.get", {}, { signal: AbortSignal.timeout(8_000) });
        const wasOffline = health() === "offline" || health() === "unknown";
        setHealth("online");
        if (h.runsDir) setRunsRoot(h.runsDir);
        // clear stale connectivity errors when we recover
        if (wasOffline) setError(null);
      } catch {
        setHealth("offline");
        // do not setError — OfflineGate is the calm signal
      }
    }

    const recoverSelectedTarget = createServerTargetRecovery({
      selectedDevice,
      devices,
      selectDevice: selectDeviceRemote,
      runAction,
      appendLog,
      setLiveCaptureIssue,
      setControlIssue,
      telemetryScope: () => ({
        projectKey: selectedAppMapId() ?? "local-workspace",
        journeyKey: selectedJobId() ?? selectedAppMapId() ?? "local-workspace",
      }),
      refreshEvidence: () => {
        const device = devices().find((candidate) => candidate.serial === selectedDevice());
        return refreshLiveDeviceEvidence({
          frameSharesSemanticSession:
            device?.platform === "ios" &&
            device.kind === "Physical device" &&
            (appleDeviceSetup()?.setup.iosLivePreview?.backend ?? "go-ios-auto") ===
              "agent-device-png",
          pollFrame: () => pollLiveFrame(),
          pollSnapshot: () => pollLiveSnapshot(),
        });
      },
    });

    const [bootingSerial, setBootingSerial] = createSignal<string | null>(null);
    const [authorizingSerial, setAuthorizingSerial] = createSignal<string | null>(null);
    async function bootDeviceRemote(serial: string): Promise<boolean> {
      const device = devices().find((item) => item.serial === serial);
      if (!device || bootingSerial()) return false;
      setBootingSerial(serial);
      try {
        if (!currentClient() || !currentConnection()) await resolveConnection();
        await selectDeviceRemote(serial);
        if (!selectedLeaseId()) {
          throw new Error(`Relay could not reserve ${device.name ?? "this device"} to start it.`);
        }
        await bootDeviceRequest(await connectedClient(), { serial });
        await refreshDevices();
        return true;
      } catch (err) {
        const message = humanError(err, `Could not start ${device.name ?? "this device"}`);
        setError(message);
        toast(message, "error");
        return false;
      } finally {
        setBootingSerial(null);
      }
    }

    async function authorizeDeviceRemote(serial: string): Promise<boolean> {
      if (authorizingSerial()) return false;
      setAuthorizingSerial(serial);
      try {
        await authorizeDeviceRequest(await connectedClient(), { serial });
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          await refreshDevices();
          const current = devices().find((device) => device.serial === serial);
          if (current?.connectionState === "connected") return true;
        }
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setAuthorizingSerial(null);
      }
    }

    const browserDevice = createServerBrowserDeviceController({
      client: connectedClient,
      selectedDevice,
      setLiveFrame,
      setLiveCaptureIssue,
    });
    resetBrowserDeviceForConnection = browserDevice.reset;

    const {
      resetLivePreview,
      captureUiSnapshot,
      captureUiScreenshot,
      captureScrollablePage,
      copyUiScreenshot,
      recordingEvidenceUrl,
      pollLiveFrame,
      pollLiveSnapshot,
      touchDevice,
      keyDevice,
      scrollDevice,
      pressNode,
      interactStep,
      runStep,
      frameUrlForPersisted,
      videoUrlForRun,
      recordIosVideo,
      iosVideoUrl,
    } = createServerCapture({
      client: connectedClient,
      serverUrl,
      selectedDevice,
      selectedDevicePlatform: () =>
        devices().find((device) => device.serial === selectedDevice())?.platform,
      selectedAction,
      activeDiscoverySessionId,
      collectAccessibility: () => accessibilityCollectionEnabled(accessibilityMode()),
      setBusyCapture,
      setSnapshot,
      setLiveFrame,
      setLiveCaptureIssue,
      pushFrame,
      copyImage: platform.copyImage,
      appendLog,
      refreshDiscoverySessions,
      resetBrowserDevice: browserDevice.reset,
      pollBrowserDeviceFrame: browserDevice.poll,
      browserDeviceWheel: browserDevice.wheel,
      browserDeviceKey: browserDevice.key,
    });
    const {
      sseConnected,
      eventActivity,
      watchWorkflow,
      connect: connectSse,
      dispose: disposeSse,
    } = createServerEventController({
      client: currentClient,
      refreshers: {
        devices: refreshDevices,
        appMaps: refreshAppMaps,
        jobs: refreshJobs,
        runs: refreshRuns,
        variables: refreshProjectVariables,
        matrices: refreshMatrices,
        discoveries: refreshDiscoverySessions,
        authoring: refreshAuthoringSessions,
      },
      appendLog,
      pushFrame,
      setRunning,
      selectedJobId,
      setSelectedJobId,
      loadRunDetail,
      captureUiScreenshot,
    });
    const visualBaselineFrameUrl = (runId: string, frameIndex: number) =>
      buildVisualBaselineFrameUrl(serverUrl(), runId, frameIndex);

    function jumpToJob(jobId: string) {
      setSelectedJobId(jobId);
      const job = jobs().find((j) => j.id === jobId);
      if (job) setSelectedAction(job.action);
      const list = frames();
      const idx = list
        .map((f, i) => ({ f, i }))
        .reverse()
        .find((x) => x.f.jobId === jobId)?.i;
      if (idx !== undefined) setFrameIndex(idx);
      stopPlayback();
    }

    const serverLifecycle = createServerProviderLifecycle({
      pollMs,
      health,
      resolveConnection,
      restoreWorkspace: async () => {
        await Promise.all([
          restoreWorkspace(),
          Promise.resolve(platform.storage.get("selectedDevice"))
            .then((saved) => saved && setSelectedDevice(saved))
            .catch(() => undefined),
          Promise.resolve(platform.storage.get("accessibilityOverlayMode"))
            .then((saved) => setAccessibilityModeState(parseAccessibilityOverlayMode(saved)))
            .catch(() => undefined),
        ]);
      },
      pollHealth,
      refreshInitial: async () => {
        await Promise.all([
          refreshDevices(),
          refreshTargets(),
          refreshActions(),
          refreshAppMaps(),
          refreshJobs(),
          refreshRuns(),
          refreshSchedules(),
          refreshProjectVariables(),
          refreshAuthoringSessions(),
          refreshRedactionPolicy(),
          refreshEvidenceCollectionPolicy(),
        ]);
      },
      normalizeWorkspace: normalizeWorkspaceSelection,
      refreshRetry: async () => {
        await Promise.all([
          refreshDevices(),
          refreshActions(),
          refreshAppMaps(),
          refreshJobs(),
          refreshRuns(),
          refreshSchedules(),
          refreshProjectVariables(),
          refreshAuthoringSessions(),
          refreshRedactionPolicy(),
          refreshEvidenceCollectionPolicy(),
        ]);
      },
      refreshPoll: async () => {
        await Promise.allSettled([
          refreshDevices(),
          refreshJobs(),
          refreshAppMaps(),
          refreshTargetHealth(),
        ]);
      },
      refreshRecovered: async () => {
        await Promise.allSettled([
          refreshActions(),
          refreshTargets(),
          refreshRuns(),
          refreshAuthoringSessions(),
          refreshRedactionPolicy(),
          refreshEvidenceCollectionPolicy(),
        ]);
      },
      connectSse,
      disposeSse,
      stopPlayback,
      releaseTargetControl: releaseSelectedTargetControl,
    });
    const { retryConnection } = serverLifecycle;
    void serverLifecycle.start().catch(() => undefined);

    createEffect(() => {
      if (running()) {
        setClock(Date.now());
        if (!clockTimer) clockTimer = setInterval(() => setClock(Date.now()), 1000);
      } else if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = undefined;
      }
    });

    onCleanup(() => {
      clearInterval(clockTimer);
      void serverLifecycle.dispose();
    });

    const {
      inferVariableFromDevice,
      runPathAcrossVariables,
      combineCampaign,
      saveVariable,
      removeVariable,
      saveTest,
      editTest,
      saveCombine,
      preflightCombine,
      estimateCampaignDurationCohorts,
      preflightLocalCampaignAdmission,
      removeCombine,
      runAppMapConnection: runAppMapConnectionRemote,
      runAppMapFlow: runAppMapFlowRemote,
      loadCompatibilityReport,
      combineEvidence,
      retrySelectedJob,
      replayRecordedRunFromHistory,
    } = createServerCombineController({
      client: connectedClient,
      health,
      devices,
      selectedDevice,
      selectedLeaseId,
      selectedJobId,
      projectId,
      projectVariables: () => projectVariables().value,
      captureBeforeRun: (label, actionId) => captureUiScreenshot(label, undefined, actionId, true),
      appendLog,
      setSelectedJobId,
      setSelectedAction,
      setError,
      refreshJobs: async () => void (await refreshJobs()),
      notify: platform.notify,
    });
    const selectedAppMap = createMemo(
      () => appMaps().find((appMap) => appMap.id === selectedAppMapId()) ?? null,
    );

    return {
      projectId,
      serverUrl,
      actorId,
      previewRequestHeaders,
      setServerUrl,
      prodAccountMatch,
      setProdAccountMatch,
      appleDeviceSetup,
      androidDeviceSetup,
      refreshAppleDeviceSetup,
      preflightAppleDeviceSetup,
      refreshAndroidDeviceSetup,
      saveAppleDeviceSetup,
      saveIosLivePreview,
      projectVariables,
      refreshProjectVariables,
      saveProjectVariables,
      runAction,
      generate,
      scheduleRecipe,
      refreshSchedules,
      deleteLocalSchedule,
      health,
      isOffline,
      isEmptyDevices,
      deviceDiscoveryStatus,
      sseConnected,
      eventActivity,
      watchWorkflow,
      devices,
      targets,
      targetProfiles,
      matrices,
      discoverySessions,
      activeDiscoverySessionId,
      setActiveDiscoverySessionId,
      actions,
      appMaps,
      appMapsLoaded,
      degradedAppMaps,
      refreshAppMaps,
      loadAppMap,
      createAppMap,
      authoringSessions,
      selectedAppMapId,
      setSelectedAppMapId,
      selectedAppMap,
      jobs,
      persistedRuns,
      schedules,
      runsRoot,
      redactionPolicy,
      evidenceCollectionPolicy,
      refreshRedactionPolicy,
      refreshEvidenceCollectionPolicy,
      setRedactionEnabled: updateRedactionEnabled,
      setSensitiveEvidenceConsent: updateSensitiveEvidenceConsent,
      selectedDevice,
      targetHealth,
      refreshTargetHealth,
      selectedLeaseId,
      controlIssue,
      canTakeControlOfSelectedDevice,
      takingControlOfSelectedDevice,
      setSelectedDevice: selectDeviceRemote,
      takeControlOfSelectedDevice,
      bootDevice: bootDeviceRemote,
      bootingSerial,
      authorizeDevice: authorizeDeviceRemote,
      authorizingSerial,
      selectedAction,
      setSelectedAction,
      selectedJobId,
      setSelectedJobId,
      running,
      clock,
      error,
      dismissError,
      logs,
      appendLog,
      clearLogs,
      pressNode,
      interactStep,
      runStep,
      refreshActions,
      refreshAuthoringSessions,
      createAuthoringSession,
      observeAuthoringSession,
      captureAuthoringScreen,
      startAuthoringSession,
      interactAuthoringSession,
      stopAuthoringSession,
      trimAuthoringTake,
      reorderAuthoringTake,
      replaceAuthoringAction,
      replayAuthoringTake,
      commitAuthoringSession,
      discardAuthoringSession,
      cancelAuthoringSession,
      authoringEvidenceUrl,
      refreshDevices,
      refreshTargets,
      refreshTargetProfiles,
      refreshMatrices,
      refreshDiscoverySessions,
      ...discoveryApi,
      saveCompatibilityMatrix: saveCompatibilityMatrixRemote,
      deleteCompatibilityMatrix: deleteCompatibilityMatrixRemote,
      resolveCompatibilityMatrix: resolveCompatibilityMatrixRemote,
      loadCompatibilityMatrixYaml,
      importCompatibilityMatrixYaml,
      saveBrowserTarget,
      deleteTarget: deleteTargetRemote,
      preflightTarget: preflightTargetRemote,
      openBrowserTarget,
      refreshJobs,
      refreshRuns,
      loadRunDetail,
      loadRunSignals,
      loadRunEvidence,
      compareVisualRun,
      reviewVisualRun,
      reviewRun,
      listRunShares,
      createRunShare,
      revokeRunShare,
      pollHealth,
      retryConnection,
      recoverSelectedTarget,
      inferVariableFromDevice,
      runPathAcrossVariables,
      combineCampaign,
      saveVariable,
      removeVariable,
      saveTest,
      editTest,
      saveCombine,
      preflightCombine,
      estimateCampaignDurationCohorts,
      preflightLocalCampaignAdmission,
      removeCombine,
      runAppMapConnectionRemote,
      runAppMapFlowRemote,
      loadCompatibilityReport,
      combineEvidence,
      cancelJob: cancelJobRemote,
      pauseJob: pauseJobRemote,
      resumeJob: resumeJobRemote,
      activeJob,
      queuedJobs,
      isPaused,
      retrySelectedJob,
      replayRecordedRunFromHistory,
      snapshot,
      frames,
      frameIndex,
      setFrameIndex,
      currentFrame,
      playing,
      togglePlayback,
      stopPlayback,
      clearFrames,
      busyCapture,
      captureUiSnapshot,
      loadAndroidAppLocales,
      captureUiScreenshot,
      captureScrollablePage,
      copyUiScreenshot,
      recordingEvidenceUrl,
      jumpToJob,
      accessibilityMode,
      setAccessibilityMode,
      liveFrame,
      liveCaptureIssue,
      clearLiveCaptureIssue,
      resetLivePreview,
      pollLiveFrame,
      pollLiveSnapshot,
      touchDevice,
      keyDevice,
      scrollDevice,
      frameUrlForPersisted,
      visualBaselineFrameUrl,
      videoUrlForRun,
      recordIosVideo,
      iosVideoUrl,
      browserDeviceSession: browserDevice.session,
      openBrowserDevice: browserDevice.open,
      clickBrowserDevice: browserDevice.click,
      navigateBrowserDevice: browserDevice.navigate,
      browserDeviceHistory: browserDevice.history,
      activateBrowserDevicePage: browserDevice.activatePage,
      closeBrowserDevicePage: browserDevice.closePage,
    };
  },
});

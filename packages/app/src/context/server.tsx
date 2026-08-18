import { createSignal, createEffect, createMemo, onCleanup } from "solid-js";
import { createSimpleContext } from "@relay/ui/context/helper";
import { RelayClient } from "@relay/client";
import type {
  DiscoverySession,
  OperationId,
  OperationInput,
  OperationOutput,
  CompatibilityMatrix,
  ServerConnection,
  TargetProfile,
  TargetDefinition,
} from "@relay/protocol";
import { usePlatform } from "./platform";
import { toast } from "./toast";
import { asArray, normalizeLocalBase } from "../lib/api";
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
import { targetIsReady } from "../lib/target-presentation";
import { createServerPrivacyController } from "../lib/server-privacy-controller";
import { createServerRunController } from "../lib/server-run-controller";
import { createServerRunReportController } from "../lib/server-run-report-controller";
import type {
  ActionInfo,
  DeviceInfo,
  Frame,
  HealthState,
  JobInfo,
  PersistedRun,
  RecipeInfo,
  SnapshotState,
} from "../lib/api-types";
import { visualBaselineFrameUrl as buildVisualBaselineFrameUrl } from "../lib/server-urls";
import { createServerAuthoringController } from "../lib/server-authoring-controller";
import { createServerRecipeController } from "../lib/server-recipe-controller";
import { createServerProjectController } from "../lib/server-project-controller";
import { createServerJobController } from "../lib/server-job-controller";
import { createServerTimelineController } from "../lib/server-timeline-controller";
import { createServerEventController } from "../lib/server-event-controller";
import { createServerDeviceSetupController } from "../lib/server-device-setup-controller";
import { createServerDeviceInventoryController } from "../lib/server-device-inventory-controller";
import { createServerAppMapController } from "../lib/server-app-map-controller";
import { findActiveConnectionLease } from "../lib/device-control-session";

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
  init: (
    props: {
      pollMs?: number;
    } = {},
  ) => {
    const platform = usePlatform();
    const pollMs = props.pollMs ?? 5000;

    const [serverUrl, setServerUrlState] = createSignal("");
    const [actorId, setActorId] = createSignal("");
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
    const [recipes, setRecipes] = createSignal<RecipeInfo[]>([]);
    const [recipesLoaded, setRecipesLoaded] = createSignal(false);
    // Reopen the last App Map like a document editor. Hardware selection and
    // the live-device panel remain separate state, so resuming the canvas does
    // not imply that a recording has started.
    // App Maps and recipes are independent selections — never cross-assign ids.
    const [selectedAppMapId, setSelectedAppMapIdState] = createSignal<string | null>(null);
    function setSelectedAppMapId(id: string | null): void {
      setSelectedAppMapIdState(id);
      void Promise.resolve(platform.storage.set("selectedAppMap", id ?? "")).catch(() => undefined);
    }
    const [selectedRecipeId, setSelectedRecipeIdState] = createSignal<string | null>(null);
    function setSelectedRecipeId(id: string | null): void {
      setSelectedRecipeIdState(id);
      void Promise.resolve(platform.storage.set("selectedRecipe", id ?? "")).catch(() => undefined);
    }
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
    // Observation is shareable, control is exclusive. Keep those states
    // separate so a successful screenshot poll cannot turn a view-only target
    // back into a misleading green “Live” state.
    const [controlIssue, setControlIssue] = createSignal<string | null>(null);
    const [conflictingLeaseId, setConflictingLeaseId] = createSignal<string | null>(null);
    const [takingControlOfSelectedDevice, setTakingControlOfSelectedDevice] = createSignal(false);
    const canTakeControlOfSelectedDevice = () => Boolean(conflictingLeaseId());
    const [prodAccountMatch, setProdAccountMatchState] = createSignal("");
    const [clock, setClock] = createSignal(Date.now());
    const [selectedLeaseId, setSelectedLeaseId] = createSignal<string | null>(null);

    let connection: ServerConnection | null = null;
    let client: RelayClient | null = null;
    let clockTimer: NodeJS.Timeout | undefined;

    const fetcher = () => platform.fetch ?? fetch;

    async function fallbackActorId(): Promise<string> {
      const sessionKey = "relay:actorId";
      let stored: string | null = null;
      try {
        stored = sessionStorage.getItem(sessionKey);
      } catch {
        stored = await platform.storage.get("actorId");
      }
      if (stored?.startsWith("human:") && stored.length <= 128) return stored;
      const created = `human:${crypto.randomUUID()}`;
      try {
        sessionStorage.setItem(sessionKey, created);
      } catch {
        await platform.storage.set("actorId", created);
      }
      return created;
    }

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

    async function resolveConnection() {
      connection = platform.getServerConnection
        ? await platform.getServerConnection()
        : {
            url: await platform.getServerUrl(),
            auth: { type: "none" },
            organizationId: "local",
            projectId: "default",
            actorId: await fallbackActorId(),
            actorKind: "human",
          };
      connection = { ...connection, url: normalizeLocalBase(connection.url) };
      client = new RelayClient(connection, { fetch: fetcher() });
      setServerUrlState(connection.url);
      setActorId(connection.actorId);
      return connection;
    }

    async function resolveUrl() {
      return (await resolveConnection()).url;
    }

    async function setServerUrl(url: string) {
      const next = normalizeLocalBase(url);
      setServerUrlState(next);
      if (!connection) await resolveConnection();
      connection = { ...(connection as ServerConnection), url: next };
      client = new RelayClient(connection, { fetch: fetcher() });
      clearPrivacyPolicies();
      if (platform.setServerConnection) await platform.setServerConnection(connection);
      else await platform.setServerUrl?.(next);
      connectSse();
    }
    async function setProdAccountMatch(value: string) {
      const v = value.trim();
      setProdAccountMatchState(v);
      try {
        await platform.storage.set("prodAccountMatch", v);
      } catch {
        /* ignore */
      }
    }

    async function request<T = unknown>(
      path: string,
      init?: RequestInit,
      timeoutMs = 20000,
    ): Promise<T> {
      if (!client) await resolveConnection();
      return client!.resource<T>(path, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      });
    }

    async function connectedClient(): Promise<RelayClient> {
      if (!client) await resolveConnection();
      return client!;
    }

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
      request,
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
    } = createServerPrivacyController(request);

    function clearLiveCaptureIssue(): void {
      setLiveCaptureIssue(null);
    }

    const {
      deviceDiscoveryStatus,
      refreshDevices,
      selectedDeviceAvailable,
      setSelectedDeviceAvailable,
    } = createServerDeviceInventoryController({
      request,
      health,
      devices,
      setDevices,
      selectedDevice,
      selectDevice: selectDeviceRemote,
      validateSelectedControl: validateSelectedTargetControl,
      resetLivePreview: () => resetLivePreview(),
      error,
      setError,
    });

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
      request,
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
        const list = await listActions(request);
        setActions(list);
      } catch (err) {
        if (health() === "offline") return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    async function refreshRecipes() {
      if (health() === "offline") return;
      try {
        const data = await request<{ recipes: RecipeInfo[] }>("/recipes");
        const list = asArray<RecipeInfo>(data, "recipes");
        setRecipes(list);
        setRecipesLoaded(true);
      } catch {
        /* ignore — recipes are non-critical for connectivity UX */
      }
    }

    const {
      saveRecipeRemote,
      loadRecipeYaml,
      previewRecipeYaml,
      importRecipeYaml,
      loadRecipeHistory,
      restoreRecipeVersion,
      loadRecipeStability,
      deleteRecipeRemote,
    } = createServerRecipeController({
      request,
      recipes,
      selectedRecipeId,
      setSelectedRecipeId,
      refreshRecipes,
      appendLog,
    });

    const { refreshDiscoverySessions, ...discoveryApi } = createServerDiscoveryController({
      request,
      health,
      serverUrl,
      discoverySessions,
      setDiscoverySessions,
      activeDiscoverySessionId,
      setActiveDiscoverySessionId,
      refreshRecipes,
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

    async function runAction<Id extends OperationId>(
      operationId: Id,
      input: OperationInput<Id>,
    ): Promise<OperationOutput<Id>> {
      if (!client) await resolveConnection();
      return client!.invoke(operationId, input, {
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      });
    }

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
      request,
      client: connectedClient,
      currentClient: () => client,
      health,
      selectedDevice,
      devices,
      projectId: () => connection?.projectId ?? "default",
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
      request,
      client: connectedClient,
      health,
      jobs,
      setJobs,
      persistedRuns,
      setPersistedRuns,
      setRunsRoot,
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
      request,
      runAction,
      setJobs,
      setPersistedRuns,
      refreshRuns: async () => void (await refreshRuns()),
    });

    async function pollHealth() {
      try {
        const h = await request<{ runsDir?: string }>("/health", undefined, 8000);
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

    /** Retry connectivity + core lists after offline or user action. */
    async function retryConnection() {
      await pollHealth();
      if (health() !== "online") return;
      await Promise.all([
        refreshDevices(),
        refreshActions(),
        refreshRecipes(),
        refreshAppMaps(),
        refreshJobs(),
        refreshRuns(),
        refreshSchedules(),
        refreshProjectVariables(),
        refreshAuthoringSessions(),
        refreshRedactionPolicy(),
        refreshEvidenceCollectionPolicy(),
      ]);
      connectSse();
    }

    let targetRecoveryInFlight: Promise<boolean> | null = null;
    async function recoverSelectedTarget(
      reason: "connect" | "observe" | "control" | "record" | "auto" = "auto",
    ): Promise<boolean> {
      if (targetRecoveryInFlight) return targetRecoveryInFlight;
      const serial = selectedDevice();
      const device = devices().find((candidate) => candidate.serial === serial);
      if (!serial || (device?.platform !== "ios" && device?.platform !== "android")) return false;
      const recovery = (async () => {
        try {
          await selectDeviceRemote(serial);
          const result = await runAction("target.recover", { serial, reason });
          appendLog(result.recovery.summary, result.recovery.ready ? "success" : "error");
          if (result.recovery.ready) {
            setLiveCaptureIssue(null);
            setControlIssue(null);
            await Promise.all([pollLiveFrame(), pollLiveSnapshot()]);
            return true;
          }
          setLiveCaptureIssue(result.recovery.session.detail);
          return false;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setLiveCaptureIssue(message);
          appendLog(message, "error");
          return false;
        }
      })();
      targetRecoveryInFlight = recovery;
      try {
        return await recovery;
      } finally {
        if (targetRecoveryInFlight === recovery) targetRecoveryInFlight = null;
      }
    }

    const [bootingSerial, setBootingSerial] = createSignal<string | null>(null);
    const [authorizingSerial, setAuthorizingSerial] = createSignal<string | null>(null);
    let selectedTargetControlValidation: Promise<void> | null = null;

    async function validateSelectedTargetControl(serial: string): Promise<void> {
      if (selectedTargetControlValidation) return selectedTargetControlValidation;
      const validation = selectDeviceRemote(serial).finally(() => {
        if (selectedTargetControlValidation === validation) {
          selectedTargetControlValidation = null;
        }
      });
      selectedTargetControlValidation = validation;
      return validation;
    }
    async function bootDeviceRemote(serial: string): Promise<boolean> {
      const device = devices().find((item) => item.serial === serial);
      if (!device || bootingSerial()) return false;
      setBootingSerial(serial);
      try {
        if (!client || !connection) await resolveConnection();
        await selectDeviceRemote(serial);
        if (!selectedLeaseId()) {
          throw new Error(`Relay could not reserve ${device.name ?? "this device"} to start it.`);
        }
        await bootDeviceRequest(request, serial, device.platform ?? "ios");
        await refreshDevices();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
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
        await authorizeDeviceRequest(request, serial);
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

    async function selectDeviceRemote(serial: string | null) {
      const previousSerial = selectedDevice();
      const targetChanged = serial !== previousSerial;
      if (targetChanged) {
        // Live pixels and the accessibility tree are target-specific. Clear
        // them before accepting a new target so the stage never renders a
        // convincing but stale screen while the new target is starting.
        resetLivePreview();
      }
      setSelectedDevice(serial);
      const selectedTarget = devices().find((device) => device.serial === serial);
      setSelectedDeviceAvailable(targetIsReady(selectedTarget, health() === "online"));
      void Promise.resolve(platform.storage.set("selectedDevice", serial ?? "")).catch(
        () => undefined,
      );
      if (!client || !connection) return;
      try {
        const currentLeaseId = selectedLeaseId();
        const leases = (await client.leases()).leases;
        const activeCurrentLease = currentLeaseId
          ? findActiveConnectionLease(connection, leases, (lease) => lease.id === currentLeaseId)
          : undefined;

        // Re-selecting a target is the normal way taps, recording, and replay
        // verify control. It must be idempotent: releasing and recreating a
        // lease on every interaction filled the activity store and introduced
        // a race where the next request arrived between both operations.
        if (activeCurrentLease?.deviceSerial === serial) {
          setControlIssue(null);
          return;
        }

        if (activeCurrentLease && (targetChanged || activeCurrentLease.deviceSerial !== serial)) {
          await client.releaseLease(activeCurrentLease.id).catch(() => undefined);
        }
        setSelectedLeaseId(null);
        setControlIssue(null);
        setConflictingLeaseId(null);

        const claimableVirtualTarget = Boolean(
          serial && /simulator|emulator/i.test(selectedTarget?.kind ?? ""),
        );
        if (serial && (selectedDeviceAvailable() || claimableVirtualTarget)) {
          const active = findActiveConnectionLease(
            connection,
            leases,
            (lease) => lease.deviceSerial === serial,
          );
          const occupied = leases.find(
            (lease) =>
              lease.deviceSerial === serial &&
              lease.status === "leased" &&
              lease.expiresAt > Date.now(),
          );
          if (!active && occupied) {
            setControlIssue("This device is reserved by another active controller.");
            setConflictingLeaseId(occupied.id);
            setSelectedLeaseId(null);
            return;
          }
          setSelectedLeaseId(
            active?.id ??
              (
                await client.lease({
                  poolId: "local",
                  deviceSerial: serial,
                  // A crashed or closed renderer should never lock a device
                  // for an entire day. Interactions revalidate and reacquire
                  // this short lease transparently.
                  expiresAt: Date.now() + 2 * 60 * 60 * 1000,
                })
              ).lease.id,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setControlIssue(message);
        setError(message);
      }
    }

    async function takeControlOfSelectedDevice(): Promise<boolean> {
      if (!client || !connection || takingControlOfSelectedDevice()) return false;
      setTakingControlOfSelectedDevice(true);
      const serial = selectedDevice();
      const leaseId = conflictingLeaseId();
      try {
        if (!serial || !leaseId) {
          await selectDeviceRemote(serial);
          return Boolean(selectedLeaseId());
        }
        const { lease } = await client.takeOverLease({
          leaseId,
          expiresAt: Date.now() + 2 * 60 * 60 * 1000,
          reason: "Take control from the live device panel",
          confirm: true,
        });
        setSelectedLeaseId(lease.id);
        setConflictingLeaseId(null);
        setControlIssue(null);
        setError(null);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setControlIssue(message);
        setError(message);
        return false;
      } finally {
        setTakingControlOfSelectedDevice(false);
      }
    }

    const {
      resetLivePreview,
      captureUiSnapshot,
      captureUiScreenshot,
      captureScrollablePage,
      copyUiScreenshot,
      persistRecordingEvidence,
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
      request,
      serverUrl,
      selectedDevice,
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
    });
    const {
      sseConnected,
      eventActivity,
      connect: connectSse,
      dispose: disposeSse,
    } = createServerEventController({
      client: () => client,
      refreshers: {
        devices: refreshDevices,
        recipes: refreshRecipes,
        appMaps: refreshAppMaps,
        jobs: refreshJobs,
        runs: refreshRuns,
        variables: refreshProjectVariables,
        matrices: refreshMatrices,
        discoveries: refreshDiscoverySessions,
        // Corpus crawling remains a CLI/internal capture primitive. Desktop
        // screenshot evidence is projected through canonical App Map runs.
        corpora: async () => undefined,
        authoring: refreshAuthoringSessions,
      },
      appendLog,
      pushFrame,
      setRunning,
      selectedJobId,
      setSelectedJobId,
      refreshJobs,
      refreshRuns,
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

    void (async () => {
      await resolveUrl();
      try {
        const saved = await platform.storage.get("prodAccountMatch");
        if (saved) setProdAccountMatchState(saved);
      } catch {
        /* ignore */
      }
      // Keep the user's phone authoritative across a transient disconnect or
      // app reload. refreshDevices will rebind it when the serial returns.
      try {
        const savedDevice = await platform.storage.get("selectedDevice");
        if (savedDevice) setSelectedDevice(savedDevice);
      } catch {
        /* ignore */
      }
      try {
        const savedAppMap = await platform.storage.get("selectedAppMap");
        if (savedAppMap) setSelectedAppMapIdState(savedAppMap);
      } catch {
        /* ignore */
      }
      try {
        const savedRecipe = await platform.storage.get("selectedRecipe");
        if (savedRecipe) setSelectedRecipeIdState(savedRecipe);
      } catch {
        /* ignore */
      }
      try {
        const savedMode = await platform.storage.get("accessibilityOverlayMode");
        setAccessibilityModeState(parseAccessibilityOverlayMode(savedMode));
      } catch {
        /* keep the default */
      }
      await pollHealth();
      if (health() === "online") {
        await Promise.all([
          refreshDevices(),
          refreshTargets(),
          refreshActions(),
          refreshRecipes(),
          refreshAppMaps(),
          refreshJobs(),
          refreshRuns(),
          refreshSchedules(),
          refreshProjectVariables(),
          refreshAuthoringSessions(),
          refreshRedactionPolicy(),
          refreshEvidenceCollectionPolicy(),
        ]);
        const selectedMapId = selectedAppMapId();
        if (selectedMapId && !appMaps().some((map) => map.id === selectedMapId)) {
          setSelectedAppMapId(null);
        }
        if (!selectedAppMapId()) {
          const latest = appMaps().toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
          if (latest) setSelectedAppMapId(latest.id);
        }
        const selectedTestId = selectedRecipeId();
        if (selectedTestId && !recipes().some((recipe) => recipe.id === selectedTestId)) {
          setSelectedRecipeId(null);
        }
        connectSse();
      }
    })();

    const poll = setInterval(() => {
      void (async () => {
        const prev = health();
        await pollHealth();
        if (health() === "online") {
          void refreshDevices();
          void refreshJobs();
          // Desktop development owns an isolated local server, while the CLI
          // can intentionally write to the standard local Relay server. Both
          // share persisted maps but not their in-memory SSE buses. Reconcile
          // the compact map index here so a fresh capture appears in the app
          // without a manual reload in either topology.
          void refreshAppMaps().catch(() => undefined);
          // re-attach bus when we come back online
          if (prev !== "online") {
            void refreshActions();
            void refreshTargets();
            void refreshRecipes();
            void refreshRuns();
            void refreshAuthoringSessions();
            void refreshRedactionPolicy();
            void refreshEvidenceCollectionPolicy();
            connectSse();
          }
        }
      })();
    }, pollMs);

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
      clearInterval(poll);
      clearInterval(clockTimer);
      stopPlayback();
      disposeSse();
      const leaseId = selectedLeaseId();
      if (client && leaseId) void client.releaseLease(leaseId).catch(() => undefined);
    });

    const {
      runRecipe: runRecipeRemote,
      inferLocaleOptionsFromDevice,
      inferVariableFromDevice,
      runPathAcrossVariables,
      saveVariable,
      removeVariable,
      saveTest,
      editTest,
      saveCombine,
      preflightCombine,
      removeCombine,
      runRecipeAcrossLocales: runRecipeAcrossLocalesRemote,
      runAppMapConnection: runAppMapConnectionRemote,
      runAppMapFlow: runAppMapFlowRemote,
      runCompatibilityMatrix: runCompatibilityMatrixRemote,
      loadCompatibilityReport,
      exportMatrixEvidence,
      retrySelectedJob,
      replayRecordedRunFromHistory,
    } = createServerRunController({
      request,
      health,
      devices,
      recipes,
      matrices,
      selectedDevice,
      selectedJobId,
      prodAccountMatch,
      projectId: () => connection?.projectId ?? "default",
      projectVariables: () => projectVariables().value,
      activeJob,
      queuedJobs,
      captureBeforeRun: (label, actionId) => captureUiScreenshot(label, undefined, actionId, true),
      appendLog,
      setSelectedJobId,
      setSelectedAction,
      setError,
      refreshJobs: async () => void (await refreshJobs()),
      rememberJob: (job) =>
        setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]),
      notify: platform.notify,
    });

    const selectedAppMap = createMemo(
      () => appMaps().find((appMap) => appMap.id === selectedAppMapId()) ?? null,
    );
    const selectedRecipe = createMemo(
      () => recipes().find((recipe) => recipe.id === selectedRecipeId()) ?? null,
    );

    return {
      projectId: () => connection?.projectId ?? "default",
      serverUrl,
      actorId,
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
      devices,
      targets,
      targetProfiles,
      matrices,
      discoverySessions,
      activeDiscoverySessionId,
      setActiveDiscoverySessionId,
      actions,
      recipes,
      recipesLoaded,
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
      selectedRecipeId,
      setSelectedRecipeId,
      selectedRecipe,
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
      refreshRecipes,
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
      runRecipeRemote,
      inferLocaleOptionsFromDevice,
      inferVariableFromDevice,
      runPathAcrossVariables,
      saveVariable,
      removeVariable,
      saveTest,
      editTest,
      saveCombine,
      preflightCombine,
      removeCombine,
      runRecipeAcrossLocalesRemote,
      runAppMapConnectionRemote,
      runAppMapFlowRemote,
      runCompatibilityMatrixRemote,
      loadCompatibilityReport,
      exportMatrixEvidence,
      saveRecipeRemote,
      loadRecipeYaml,
      importRecipeYaml,
      previewRecipeYaml,
      loadRecipeHistory,
      restoreRecipeVersion,
      loadRecipeStability,
      deleteRecipeRemote,
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
      persistRecordingEvidence,
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
    };
  },
});

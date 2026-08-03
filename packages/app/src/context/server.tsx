import { createSignal, createEffect, createMemo, onCleanup } from "solid-js";
import { createSimpleContext } from "@relay/ui/context/helper";
import { ApiError, RelayClient } from "@relay/client";
import type {
  GenerationRequest,
  GenerationResult,
  DiscoveryAgentContext,
  DiscoverySession,
  DiscoveryCoverageReport,
  DiscoveryDecisionProvenance,
  DiscoveryScope,
  DiscoveryControl,
  OperationId,
  OperationInput,
  OperationOutput,
  CompatibilityMatrix,
  Revisioned,
  ServerConnection,
  TestVariable,
  TargetProfile,
  TargetDefinition,
  EventEnvelope,
  AuthoringSession,
  AuthoringInteraction,
  AuthoringCommitDestination,
  AppMap,
} from "@relay/protocol";
import { usePlatform } from "./platform";
import { toast } from "./toast";
import { asArray, levelFromLine, normalizeLocalBase, uid } from "../lib/api";
import { createServerCapture } from "../lib/server-capture";
import { createServerTargetController } from "../lib/server-target-controller";
import {
  approveDiscoverySuggestion as approveDiscoverySuggestionRemote,
  backtrackDiscovery as backtrackDiscoveryRemote,
  captureDiscoveryScreen,
  createDiscoverySession,
  discoveryScreenUrl as buildDiscoveryScreenUrl,
  getDiscoveryCoverage,
  getDiscoverySuggestion,
  listDiscoverySessions,
  renameDiscoverySession,
  promoteDiscoveryPath,
  setDiscoveryStatus,
} from "../lib/server-discovery-remote";
import {
  listActions,
  listDevices,
  bootDevice as bootDeviceRequest,
  authorizeDevice as authorizeDeviceRequest,
} from "../lib/server-target-remote";
import { preferredTargetSerial, targetIsReady } from "../lib/target-presentation";
import { projectRelayEvent, type EventActivity, type EventRefresh } from "../lib/event-projection";
import {
  deleteRecipe,
  importRecipeYaml as importRecipeYamlRemote,
  loadRecipeHistory as loadRecipeHistoryRemote,
  loadRecipeStability as loadRecipeStabilityRemote,
  loadRecipeYaml as loadRecipeYamlRemote,
  previewRecipeYaml as previewRecipeYamlRemote,
  restoreRecipeVersion as restoreRecipeVersionRemote,
  saveRecipe as saveRecipeRemoteRequest,
} from "../lib/server-recipe-remote";
import { createServerPrivacyController } from "../lib/server-privacy-controller";
import {
  loadAndroidDeviceSetup,
  loadAppleDeviceSetup,
  loadAppleSetupPreflight,
  saveAppleDeviceSetup as saveAppleDeviceSetupRequest,
  type AppleDeviceSetup,
  type AppleSetupStatus,
  type AndroidSetupStatus,
} from "../lib/server-device-setup-remote";
import { createServerRunController } from "../lib/server-run-controller";
import type {
  ActionInfo,
  DeviceInfo,
  Frame,
  HealthState,
  JobInfo,
  LogLine,
  PersistedRun,
  RecipeParameter,
  RecipeInfo,
  RecipeStep,
  RecipeStability,
  RunEvidenceQuery,
  SnapshotState,
  TraceFrameRef,
  LocalSchedule,
} from "../lib/api-types";
import { visualBaselineFrameUrl as buildVisualBaselineFrameUrl } from "../lib/server-urls";

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
    const [deviceDiscoveryStatus, setDeviceDiscoveryStatus] = createSignal<
      "idle" | "scanning" | "ready"
    >("idle");
    const [targets, setTargets] = createSignal<TargetDefinition[]>([]);
    const [targetProfiles, setTargetProfiles] = createSignal<TargetProfile[]>([]);
    const [matrices, setMatrices] = createSignal<CompatibilityMatrix[]>([]);
    const [discoverySessions, setDiscoverySessions] = createSignal<DiscoverySession[]>([]);
    const [activeDiscoverySessionId, setActiveDiscoverySessionId] = createSignal<string | null>(
      null,
    );
    const [actions, setActions] = createSignal<ActionInfo[]>([]);
    const [recipes, setRecipes] = createSignal<RecipeInfo[]>([]);
    const [appMaps, setAppMaps] = createSignal<AppMap[]>([]);
    const [appMapsLoaded, setAppMapsLoaded] = createSignal(false);
    const [recipesLoaded, setRecipesLoaded] = createSignal(false);
    const [authoringSessions, setAuthoringSessions] = createSignal<AuthoringSession[]>([]);
    // Reopen the last App Map like a document editor. Hardware selection and
    // the live-device panel remain separate state, so resuming the canvas does
    // not imply that a recording has started.
    const [selectedAppMapId, setSelectedAppMapIdState] = createSignal<string | null>(null);
    function setSelectedAppMapId(id: string | null): void {
      setSelectedAppMapIdState(id);
      void Promise.resolve(platform.storage.set("selectedAppMap", id ?? "")).catch(() => undefined);
    }
    const [jobs, setJobs] = createSignal<JobInfo[]>([]);
    const [persistedRuns, setPersistedRuns] = createSignal<PersistedRun[]>([]);
    const [schedules, setSchedules] = createSignal<LocalSchedule[]>([]);
    const [runsRoot, setRunsRoot] = createSignal("");
    const [selectedDevice, setSelectedDevice] = createSignal<string | null>(null);
    const [selectedAction, setSelectedAction] = createSignal<string | null>(null);
    const [selectedJobId, setSelectedJobId] = createSignal<string | null>(null);
    const [running, setRunning] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [logs, setLogs] = createSignal<LogLine[]>([]);
    const [snapshot, setSnapshot] = createSignal<SnapshotState>(null);
    const [frames, setFrames] = createSignal<Frame[]>([]);
    const [frameIndex, setFrameIndex] = createSignal(0);
    const [playing, setPlaying] = createSignal(false);
    const [busyCapture, setBusyCapture] = createSignal(false);
    const [sseConnected, setSseConnected] = createSignal(false);
    const [showOverlays, setShowOverlays] = createSignal(true);
    const [liveFrame, setLiveFrame] = createSignal<Frame | null>(null);
    const [liveCaptureIssue, setLiveCaptureIssue] = createSignal<string | null>(null);
    const [prodAccountMatch, setProdAccountMatchState] = createSignal("");
    const [appleDeviceSetup, setAppleDeviceSetup] = createSignal<AppleSetupStatus | null>(null);
    const [androidDeviceSetup, setAndroidDeviceSetup] = createSignal<AndroidSetupStatus | null>(
      null,
    );
    const [projectVariables, setProjectVariables] = createSignal<Revisioned<TestVariable[]>>({
      revision: 0,
      value: [],
      updatedAt: 0,
    });
    const [clock, setClock] = createSignal(Date.now());
    const [eventActivity, setEventActivity] = createSignal<EventActivity | null>(null);
    const [selectedLeaseId, setSelectedLeaseId] = createSignal<string | null>(null);

    let logSeq = 0;
    let eventAbort: AbortController | null = null;
    let eventReconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let connection: ServerConnection | null = null;
    let client: RelayClient | null = null;
    let playTimer: NodeJS.Timeout | undefined;
    let clockTimer: NodeJS.Timeout | undefined;
    let appleSetupRefreshSequence = 0;
    let deviceRefreshSequence = 0;
    let eventCursor = 0;

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

    const currentFrame = () => {
      const list = frames();
      if (list.length === 0) return null;
      const i = Math.min(Math.max(frameIndex(), 0), list.length - 1);
      return list[i] ?? null;
    };

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

    function appendLog(text: string, level?: LogLine["level"], jobId?: string) {
      logSeq += 1;
      setLogs((prev) => [
        ...prev.slice(-400),
        {
          id: logSeq,
          text,
          level: level ?? levelFromLine(text),
          at: Date.now(),
          jobId,
        },
      ]);
    }

    function clearLogs() {
      logSeq = 0;
      setLogs([]);
    }

    function pushFrame(frame: Omit<Frame, "id">) {
      const full: Frame = { ...frame, id: uid() };
      setFrames((prev) => {
        const next = [...prev, full].slice(-80);
        setFrameIndex(next.length - 1);
        return next;
      });
      return full;
    }

    function clearFrames() {
      setFrames([]);
      setFrameIndex(0);
      setPlaying(false);
    }

    function stopPlayback() {
      setPlaying(false);
      if (playTimer) {
        clearInterval(playTimer);
        playTimer = undefined;
      }
    }

    function togglePlayback() {
      if (playing()) {
        stopPlayback();
        return;
      }
      if (frames().length === 0) return;
      setPlaying(true);
      playTimer = setInterval(() => {
        setFrameIndex((i) => {
          const max = frames().length - 1;
          if (i >= max) {
            stopPlayback();
            return i;
          }
          return i + 1;
        });
      }, 900);
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

    const {
      redactionPolicy,
      evidenceCollectionPolicy,
      refreshRedactionPolicy,
      refreshEvidenceCollectionPolicy,
      updateRedactionEnabled,
      updateSensitiveEvidenceConsent,
      clearPrivacyPolicies,
    } = createServerPrivacyController(request);

    async function refreshAppleDeviceSetup(): Promise<AppleSetupStatus> {
      const sequence = ++appleSetupRefreshSequence;
      const status = await loadAppleDeviceSetup(request);
      // Settings can issue a background refresh while a save is in flight.
      // Only the newest reply may change the shared setup state.
      if (sequence === appleSetupRefreshSequence) setAppleDeviceSetup(status);
      return status;
    }

    async function preflightAppleDeviceSetup(): Promise<boolean> {
      const status = await loadAppleSetupPreflight(request);
      return status.configured;
    }

    async function refreshAndroidDeviceSetup(): Promise<AndroidSetupStatus> {
      const status = await loadAndroidDeviceSetup(request);
      setAndroidDeviceSetup(status);
      return status;
    }

    async function saveAppleDeviceSetup(input: AppleDeviceSetup): Promise<void> {
      await saveAppleDeviceSetupRequest(request, input);
      await refreshAppleDeviceSetup();
      // A runner setup failure belongs to the previous configuration. Once a
      // new configuration saves successfully, let the stage retry from a
      // clean state instead of continuing to offer its stale setup error.
      setLiveCaptureIssue(null);
    }

    function clearLiveCaptureIssue(): void {
      setLiveCaptureIssue(null);
    }

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

    let selectedDeviceAvailable = false;
    let deviceRefreshInFlight: Promise<void> | null = null;
    async function refreshDevices() {
      if (health() === "offline") return;
      if (deviceRefreshInFlight) return deviceRefreshInFlight;

      const sequence = ++deviceRefreshSequence;
      setDeviceDiscoveryStatus("scanning");
      const refresh = (async () => {
        try {
          const list = (await listDevices(request)).map((d) => ({
            ...d,
            serial: String(d.serial ?? d.id ?? ""),
          }));
          // Device discovery runs from polling, manual refresh, and target
          // changes. Ignore an older reply so a transient stale list cannot
          // make the current device disappear or rebind the wrong target.
          if (sequence !== deviceRefreshSequence) return;
          setDevices(list);
          // Preserve an explicit selection across a transient USB/Wi-Fi drop.
          // When the same serial reappears, the stage recovers without silently
          // switching the user to a simulator or another phone.
          const selected = selectedDevice();
          const selectedTarget = list.find((device) => device.serial === selected);
          const selectedTargetReady = targetIsReady(selectedTarget, true);
          if (!selected) {
            void selectDeviceRemote(preferredTargetSerial(list));
          } else if (selectedTargetReady && !selectedDeviceAvailable) {
            // Reacquire this actor's lease when the intentionally focused
            // target returns. Focus itself remains entirely renderer-local.
            void selectDeviceRemote(selected);
          } else if (!selectedTargetReady && selectedDeviceAvailable) {
            // A cached screen is evidence from a device that is no longer
            // present. Keep the intentional selection for auto-recovery, but
            // never present its pixels as the current live screen.
            setLiveFrame(null);
            setSnapshot(null);
            setLiveCaptureIssue(null);
          }
          selectedDeviceAvailable = selectedTargetReady;
          // clear only network-ish noise; keep explicit action errors
          if (error()?.match(/failed to fetch|network|ECONNREFUSED|offline/i)) setError(null);
        } catch (err) {
          if (sequence !== deviceRefreshSequence) return;
          // calm when known offline — OfflineGate owns that UX
          if (health() === "offline") return;
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
      deviceRefreshInFlight = refresh;
      try {
        await refresh;
      } finally {
        if (deviceRefreshInFlight === refresh) {
          deviceRefreshInFlight = null;
          setDeviceDiscoveryStatus("ready");
        }
      }
    }

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

    async function refreshDiscoverySessions() {
      if (health() === "offline") return;
      const data = await listDiscoverySessions(request);
      setDiscoverySessions(data.sessions ?? []);
      if (
        activeDiscoverySessionId() &&
        !data.sessions.some((session) => session.id === activeDiscoverySessionId())
      ) {
        setActiveDiscoverySessionId(null);
      }
    }

    async function createDiscoverySessionRemote(input: {
      name: string;
      targetId: string;
      scope?: Partial<DiscoveryScope>;
      agent?: Omit<DiscoveryAgentContext, "createdBy">;
    }): Promise<DiscoverySession> {
      const session = await createDiscoverySession(request, input);
      await refreshDiscoverySessions();
      setActiveDiscoverySessionId(session.id);
      return session;
    }

    async function setDiscoveryStatusRemote(
      id: string,
      status: DiscoverySession["status"],
    ): Promise<DiscoverySession> {
      const session = await setDiscoveryStatus(request, id, status);
      await refreshDiscoverySessions();
      if (status === "running") setActiveDiscoverySessionId(session.id);
      else if (activeDiscoverySessionId() === session.id) setActiveDiscoverySessionId(null);
      return session;
    }

    async function renameDiscoverySessionRemote(
      id: string,
      name: string,
    ): Promise<DiscoverySession> {
      const session = await renameDiscoverySession(request, id, name);
      await refreshDiscoverySessions();
      return session;
    }

    async function captureDiscoveryScreenRemote(id: string): Promise<DiscoverySession> {
      const session = await captureDiscoveryScreen(request, id);
      await refreshDiscoverySessions();
      return session;
    }

    function discoveryScreenUrl(sessionId: string, screenId: string): string {
      return buildDiscoveryScreenUrl(serverUrl(), sessionId, screenId);
    }

    async function promoteDiscoveryPathRemote(input: {
      sessionId: string;
      transitionIds: string[];
      recipeId: string;
      title: string;
      transitionLabels?: Record<string, string>;
    }): Promise<{ recipe: RecipeInfo; warnings: string[] }> {
      const data = await promoteDiscoveryPath(request, input);
      await refreshRecipes();
      setSelectedAppMapId(data.recipe.id);
      return data;
    }

    async function discoverySuggestion(id: string): Promise<{
      screenId: string;
      control: DiscoveryControl;
    } | null> {
      return getDiscoverySuggestion(request, id);
    }

    async function loadDiscoveryCoverage(id: string): Promise<DiscoveryCoverageReport> {
      return getDiscoveryCoverage(request, id);
    }

    async function approveDiscoverySuggestion(input: {
      sessionId: string;
      control: DiscoveryControl;
      decision?: DiscoveryDecisionProvenance;
    }): Promise<void> {
      await approveDiscoverySuggestionRemote(request, input);
      await refreshDiscoverySessions();
    }

    async function backtrackDiscovery(id: string): Promise<boolean> {
      const changed = await backtrackDiscoveryRemote(request, id);
      await refreshDiscoverySessions();
      return changed;
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

    async function refreshAppMaps(): Promise<AppMap[]> {
      if (health() === "offline") return appMaps();
      const result = await runAction("app-map.list", {});
      setAppMaps(result.appMaps);
      setAppMapsLoaded(true);
      return result.appMaps;
    }

    async function loadAppMap(appMapId: string): Promise<AppMap> {
      const appMap = (await runAction("app-map.get", { appMapId })).appMap;
      setAppMaps((current) => [
        appMap,
        ...current.filter((candidate) => candidate.id !== appMap.id),
      ]);
      return appMap;
    }

    async function createAppMap(appMapId: string, name: string): Promise<AppMap> {
      const result = await runAction("app-map.create", { appMapId, name });
      setAppMaps((current) => [
        result.appMap,
        ...current.filter((candidate) => candidate.id !== result.appMap.id),
      ]);
      return result.appMap;
    }

    function projectAuthoringSession(session: AuthoringSession): AuthoringSession {
      setAuthoringSessions((current) => [
        session,
        ...current.filter((item) => item.id !== session.id),
      ]);
      return session;
    }

    async function refreshAuthoringSessions(): Promise<AuthoringSession[]> {
      if (!client) await resolveConnection();
      const result = await client!.authoringSessions();
      setAuthoringSessions(result.sessions);
      return result.sessions;
    }

    async function createAuthoringSession(input: {
      appMapId: string;
      target:
        | { kind: "device"; platform: "android" | "ios"; targetId: string }
        | {
            kind: "browser";
            platform: "browser";
            targetId: string;
          };
      leaseId: string;
      expectedAppMapRevision: number;
      sourceScreenId?: string;
      pendingConnectionId?: string;
      group?: string;
    }): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession((await client!.createAuthoringSession(input)).session);
    }

    async function observeAuthoringSession(id: string): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession(
        (await client!.observeAuthoringSession(id, AbortSignal.timeout(120_000))).session,
      );
    }

    async function captureAuthoringScreen(id: string): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession(
        (await client!.captureAuthoringScreen(id, AbortSignal.timeout(120_000))).session,
      );
    }

    async function startAuthoringSession(id: string): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession(
        (await client!.startAuthoringSession(id, AbortSignal.timeout(120_000))).session,
      );
    }

    async function interactAuthoringSession(
      id: string,
      interaction: AuthoringInteraction,
    ): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession(
        (await client!.interactAuthoringSession(id, interaction)).session,
      );
    }

    async function stopAuthoringSession(id: string): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession(
        (await client!.stopAuthoringSession(id, AbortSignal.timeout(120_000))).session,
      );
    }

    async function trimAuthoringTake(
      id: string,
      input: { fromMs?: number; toMs?: number; actionIds?: string[] },
    ): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession(
        (await client!.trimAuthoringTake({ sessionId: id, ...input })).session,
      );
    }

    async function reorderAuthoringTake(
      id: string,
      actionIds: string[],
    ): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession(
        (await client!.reorderAuthoringTake({ sessionId: id, actionIds })).session,
      );
    }

    async function replaceAuthoringAction(
      id: string,
      actionId: string,
      interaction: AuthoringInteraction,
    ): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession(
        (await client!.replaceAuthoringAction({ sessionId: id, actionId, interaction })).session,
      );
    }

    async function replayAuthoringTake(id: string): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession((await client!.replayAuthoringTake(id)).session);
    }

    async function commitAuthoringSession(
      id: string,
      input: {
        destination?: AuthoringCommitDestination;
      },
    ): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      const session = projectAuthoringSession(
        (await client!.commitAuthoringSession({ sessionId: id, ...input })).session,
      );
      await refreshAppMaps();
      return session;
    }

    async function discardAuthoringSession(id: string): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession((await client!.discardAuthoringSession(id)).session);
    }

    async function cancelAuthoringSession(id: string): Promise<AuthoringSession> {
      if (!client) await resolveConnection();
      return projectAuthoringSession((await client!.cancelAuthoringSession(id)).session);
    }

    function authoringEvidenceUrl(uri: string, mime?: string): string {
      const sha256 = uri.match(/^relay-evidence:\/\/([a-f0-9]{64})$/)?.[1];
      if (!sha256) return "";
      const query = mime ? `?mime=${encodeURIComponent(mime)}` : "";
      return `${serverUrl()}/authoring-evidence/${sha256}${query}`;
    }

    async function refreshJobs() {
      if (health() === "offline") return;
      try {
        const data = await request<{ jobs: JobInfo[]; active: JobInfo | null }>("/jobs?full=0");
        const list = asArray<JobInfo>(data, "jobs");
        const active = data.active;
        setJobs((current) => {
          const detailed = new Map(
            current
              .filter((job) => job.recipeSnapshot || job.artifacts?.length || job.steps?.length)
              .map((job) => [job.id, job]),
          );
          return list.map((summary) => {
            if (active?.id === summary.id) return active;
            const richer = detailed.get(summary.id);
            return richer ? { ...richer, ...summary } : summary;
          });
        });
        setRunning(Boolean(active && (active.status === "running" || active.status === "paused")));
      } catch {
        /* ignore */
      }
    }

    async function refreshRuns() {
      if (health() === "offline") return;
      try {
        const data = await request<{ runs: PersistedRun[]; root: string }>("/runs");
        const list = asArray<PersistedRun>(data, "runs");
        // /runs returns lightweight catalog summaries with no steps/frames.
        // A run already enriched via loadRunDetail (full steps + frames) must
        // keep that detail across this refresh, or an open run report would
        // silently revert to "not reached" the next time this poll fires.
        setPersistedRuns((current) => {
          const detailed = new Map(
            current.filter((run) => run.steps?.length).map((run) => [run.id, run]),
          );
          return list.map((incoming) => {
            const richer = detailed.get(incoming.id);
            return richer && !incoming.steps?.length
              ? {
                  ...incoming,
                  steps: richer.steps,
                  frames: richer.frames,
                  artifacts: richer.artifacts,
                }
              : incoming;
          });
        });
        setRunsRoot(data.root ?? "");
      } catch {
        /* ignore */
      }
    }

    async function loadRunDetail(id: string): Promise<void> {
      try {
        const live = await request<{ job: JobInfo }>(`/jobs/${encodeURIComponent(id)}`);
        if (live.job) {
          setJobs((current) => current.map((job) => (job.id === id ? live.job : job)));
          return;
        }
      } catch {
        /* completed jobs may only exist in persisted storage after restart */
      }
      try {
        const data = await request<{ run: PersistedRun }>(`/runs/${encodeURIComponent(id)}`);
        if (!data.run) return;
        setPersistedRuns((current) => {
          const index = current.findIndex((run) => run.id === id);
          if (index < 0) return [data.run, ...current];
          return current.map((run) => (run.id === id ? data.run : run));
        });
      } catch {
        return;
      }
    }

    async function loadRunSignals(
      id: string,
    ): Promise<import("@relay/protocol").RegressionSignal[]> {
      try {
        const data = await request<{ signals?: import("@relay/protocol").RegressionSignal[] }>(
          `/runs/${encodeURIComponent(id)}/signals`,
        );
        return data.signals ?? [];
      } catch {
        return [];
      }
    }

    async function loadRunEvidence(
      id: string,
      options: { limit?: number; includeBodies?: boolean } = {},
    ): Promise<RunEvidenceQuery | null> {
      try {
        const query = new URLSearchParams();
        if (options.limit !== undefined) query.set("limit", String(options.limit));
        if (options.includeBodies) query.set("includeBodies", "true");
        const suffix = query.size ? `?${query.toString()}` : "";
        const data = await request<{ evidence?: RunEvidenceQuery }>(
          `/runs/${encodeURIComponent(id)}/evidence${suffix}`,
        );
        return data.evidence ?? null;
      } catch {
        return null;
      }
    }

    async function compareVisualRun(
      id: string,
    ): Promise<import("@relay/protocol").VisualComparison | null> {
      try {
        return (await runAction("run.visual.compare", { runId: id })).comparison;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast(message, "error");
        return null;
      }
    }

    async function reviewVisualRun(
      id: string,
      comparisonId: string,
      action: import("@relay/protocol").VisualReviewAction,
      note?: string,
    ): Promise<import("@relay/protocol").VisualReviewDecision | null> {
      try {
        return (
          await runAction("run.visual.review", {
            runId: id,
            comparisonId,
            action,
            ...(note?.trim() ? { note: note.trim() } : {}),
          })
        ).decision;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast(message, "error");
        return null;
      }
    }

    async function refreshProjectVariables() {
      if (!client || health() === "offline") return;
      try {
        setProjectVariables(await client.variables());
      } catch {
        /* project data is non-critical to device connectivity */
      }
    }

    async function saveProjectVariables(value: TestVariable[]): Promise<void> {
      if (!client) await resolveConnection();
      const before = projectVariables();
      const optimistic = { ...before, revision: before.revision + 1, value, updatedAt: Date.now() };
      setProjectVariables(optimistic);
      try {
        setProjectVariables(
          await client!.updateVariables({
            expectedRevision: before.revision,
            value,
            idempotencyKey: crypto.randomUUID(),
          }),
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const current = (error.body as { current?: Revisioned<TestVariable[]> })?.current;
          if (current) {
            const localById = new Map(value.map((item) => [item.id, item]));
            const merged = [
              ...current.value.map((item) => localById.get(item.id) ?? item),
              ...value.filter((item) => !current.value.some((remote) => remote.id === item.id)),
            ];
            setProjectVariables(
              await client!.updateVariables({
                expectedRevision: current.revision,
                value: merged,
                idempotencyKey: crypto.randomUUID(),
              }),
            );
            toast("Variables merged with newer project changes", "info");
            return;
          }
        }
        setProjectVariables(before);
        throw error;
      }
    }

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

    async function generate(input: GenerationRequest): Promise<GenerationResult> {
      if (!client) await resolveConnection();
      return client!.generate(input);
    }

    async function scheduleRecipe(input: {
      recipeId: string;
      intervalMinutes: number;
      repetitions?: number;
    }): Promise<LocalSchedule> {
      const targetId = selectedDevice();
      if (!targetId) throw new Error("Select a target before scheduling");
      const targetPlatform =
        devices().find((device) => device.serial === targetId)?.platform ?? "android";
      const data = await request<{ schedule: LocalSchedule }>("/schedules", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          targetKind: targetPlatform === "browser" ? "browser" : "device",
          targetId,
          platform: targetPlatform,
          projectId: connection?.projectId ?? "default",
        }),
      });
      setSchedules((items) => [
        ...items.filter((item) => item.id !== data.schedule.id),
        data.schedule,
      ]);
      return data.schedule;
    }

    async function refreshSchedules(): Promise<void> {
      if (health() === "offline") return;
      const data = await request<{ schedules: LocalSchedule[] }>("/schedules");
      setSchedules(data.schedules ?? []);
    }

    async function deleteLocalSchedule(id: string): Promise<void> {
      await request(`/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
      setSchedules((items) => items.filter((item) => item.id !== id));
    }

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

    function refreshFromEvent(kind: EventRefresh) {
      const refreshers: Record<EventRefresh, () => Promise<unknown>> = {
        devices: refreshDevices,
        recipes: refreshRecipes,
        appMaps: refreshAppMaps,
        jobs: refreshJobs,
        runs: refreshRuns,
        variables: refreshProjectVariables,
        matrices: refreshMatrices,
        discoveries: refreshDiscoverySessions,
        authoring: refreshAuthoringSessions,
      };
      void refreshers[kind]();
    }

    function handleBusEvent(envelope: EventEnvelope) {
      const projection = projectRelayEvent(eventCursor, envelope);
      if (!projection.accepted) return;
      eventCursor = projection.cursor;
      if (projection.activity) setEventActivity(projection.activity);
      for (const refresh of new Set(projection.refresh)) refreshFromEvent(refresh);
      const ev = envelope.payload as Record<string, unknown>;
      const type = String(ev.type ?? "");
      switch (type) {
        case "job.queued":
          appendLog(`queued ${ev.action}`, "info", ev.jobId as string);
          void refreshJobs();
          break;
        case "job.started":
          appendLog(`started ${ev.action}`, "info", ev.jobId as string);
          setRunning(true);
          if (!selectedJobId()) {
            setSelectedJobId((ev.jobId as string) ?? null);
          }
          void refreshJobs();
          break;
        case "job.log":
          if (ev.line) appendLog(String(ev.line), ev.level as LogLine["level"], ev.jobId as string);
          break;
        case "job.healed":
          appendLog(`healed ${ev.action}: ${ev.healMessage}`, "success", ev.jobId as string);
          void refreshJobs();
          void refreshRuns();
          break;
        case "job.paused":
          appendLog(`paused ${ev.action}`, "info", ev.jobId as string);
          setRunning(true);
          void refreshJobs();
          break;
        case "job.resumed":
          appendLog(`resumed ${ev.action}`, "info", ev.jobId as string);
          setRunning(true);
          void refreshJobs();
          break;
        case "job.cancelled":
          appendLog(`cancelled ${ev.action}`, "error", ev.jobId as string);
          setRunning(false);
          void refreshJobs();
          void refreshRuns();
          void loadRunDetail(ev.jobId as string);
          break;
        case "job.finished":
          appendLog(
            ev.healed
              ? `healed ${ev.action} (${ev.durationMs ?? "?"}ms)`
              : ev.ok
                ? `finished ${ev.action} (${ev.durationMs ?? "?"}ms)`
                : `failed ${ev.action}: ${ev.error ?? "?"}`,
            ev.ok || ev.healed ? "success" : "error",
            ev.jobId as string,
          );
          setRunning(false);
          void refreshJobs();
          void refreshRuns();
          void captureUiScreenshot(
            ev.ok || ev.healed ? `${ev.action} · done` : `${ev.action} · failed`,
            ev.jobId as string,
            ev.action as string,
            true,
          ).catch(() => undefined);
          break;
        case "job.step": {
          const step = ev.step as { title?: string; status?: string } | undefined;
          if (step?.title) {
            appendLog(
              `step: ${step.title}${step.status ? ` (${step.status})` : ""}`,
              "info",
              ev.jobId as string,
            );
          }
          void refreshJobs();
          break;
        }
        case "job.frame": {
          const frame = ev.frame as TraceFrameRef | undefined;
          if (frame?.base64) {
            pushFrame({
              capturedAt: frame.capturedAt,
              mime: frame.mime ?? "image/png",
              base64: frame.base64,
              bytes: frame.bytes ?? 0,
              caption: frame.caption,
              jobId: ev.jobId as string,
              path: frame.path,
            });
          }
          void refreshJobs();
          break;
        }
        case "device.selected":
          // Selection is client-local focus. Other actors remain visible via
          // eventActivity, but can never retarget this renderer.
          break;
        case "error":
          appendLog(String(ev.message ?? "error"), "error");
          break;
        default:
          break;
      }
    }

    function connectSse() {
      eventAbort?.abort();
      if (eventReconnectTimer) clearTimeout(eventReconnectTimer);
      if (!client) return;
      const controller = new AbortController();
      eventAbort = controller;
      setSseConnected(false);
      void client
        .events(handleBusEvent, {
          signal: controller.signal,
          afterSequence: eventCursor,
          onOpen: () => setSseConnected(true),
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === "AbortError" || controller.signal.aborted) {
            return;
          }
          setSseConnected(false);
          eventReconnectTimer = setTimeout(() => connectSse(), 1_000);
        });
    }

    const [bootingSerial, setBootingSerial] = createSignal<string | null>(null);
    const [authorizingSerial, setAuthorizingSerial] = createSignal<string | null>(null);
    async function bootDeviceRemote(serial: string): Promise<boolean> {
      const device = devices().find((item) => item.serial === serial);
      if (!device || bootingSerial()) return false;
      setBootingSerial(serial);
      try {
        await bootDeviceRequest(request, serial, device.platform ?? "ios");
        await refreshDevices();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
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
      if (serial !== selectedDevice()) {
        // Live pixels and the accessibility tree are target-specific. Clear
        // them before accepting a new target so the stage never renders a
        // convincing but stale screen while the new target is starting.
        setLiveFrame(null);
        setSnapshot(null);
        setLiveCaptureIssue(null);
      }
      setSelectedDevice(serial);
      const selectedTarget = devices().find((device) => device.serial === serial);
      selectedDeviceAvailable = targetIsReady(selectedTarget, health() === "online");
      void Promise.resolve(platform.storage.set("selectedDevice", serial ?? "")).catch(
        () => undefined,
      );
      if (!client || !connection) return;
      try {
        if (selectedLeaseId()) {
          await client.releaseLease(selectedLeaseId()!).catch(() => undefined);
          setSelectedLeaseId(null);
        }
        if (serial && selectedDeviceAvailable) {
          const leases = (await client.leases()).leases;
          const active = leases.find(
            (lease) =>
              lease.deviceSerial === serial &&
              lease.ownerId === connection!.actorId &&
              lease.status === "leased" &&
              lease.expiresAt > Date.now(),
          );
          const occupied = leases.find(
            (lease) =>
              lease.deviceSerial === serial &&
              lease.status === "leased" &&
              lease.expiresAt > Date.now(),
          );
          if (!active && occupied) {
            setLiveCaptureIssue("This device is open in another Relay window.");
            setSelectedLeaseId(null);
            return;
          }
          if (liveCaptureIssue() === "This device is open in another Relay window.") {
            setLiveCaptureIssue(null);
          }
          setSelectedLeaseId(
            active?.id ??
              (
                await client.lease({
                  poolId: "local",
                  deviceSerial: serial,
                  expiresAt: Date.now() + 24 * 60 * 60_000,
                })
              ).lease.id,
          );
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      }
    }

    async function saveRecipeRemote(input: {
      id?: string;
      title: string;
      description?: string;
      variables?: Record<string, string>;
      parameters?: RecipeParameter[];
      steps: RecipeStep[];
      quarantined?: boolean;
      quarantineReason?: string;
    }): Promise<RecipeInfo | null> {
      try {
        const recipe = await saveRecipeRemoteRequest(request, {
          ...input,
          expectedRevision: recipes().find((item) => item.id === input.id)?.updatedAt ?? 0,
        });
        await refreshRecipes();
        return recipe;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(msg, "error");
        toast(msg, "error");
        return null;
      }
    }

    async function loadRecipeYaml(id: string): Promise<string | null> {
      try {
        return await loadRecipeYamlRemote(request, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendLog(message, "error");
        toast(message, "error");
        return null;
      }
    }

    async function previewRecipeYaml(yaml: string): Promise<{
      recipe: RecipeInfo;
      exists: boolean;
      canonicalYaml: string;
    }> {
      return previewRecipeYamlRemote(request, yaml);
    }

    async function importRecipeYaml(
      yaml: string,
      conflict: "reject" | "replace" | "copy" = "reject",
    ): Promise<RecipeInfo | null> {
      try {
        const recipe = await importRecipeYamlRemote(request, yaml, conflict);
        await refreshRecipes();
        setSelectedAppMapId(recipe.id);
        toast(`Imported “${recipe.title}”`, "success");
        return recipe;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendLog(message, "error");
        toast(message, "error");
        return null;
      }
    }

    async function loadRecipeHistory(id: string): Promise<RecipeInfo[]> {
      return loadRecipeHistoryRemote(request, id);
    }

    async function restoreRecipeVersion(id: string, updatedAt: number): Promise<RecipeInfo> {
      const recipe = await restoreRecipeVersionRemote(request, id, updatedAt);
      await refreshRecipes();
      return recipe;
    }

    async function loadRecipeStability(id: string): Promise<RecipeStability> {
      return loadRecipeStabilityRemote(request, id);
    }

    async function deleteRecipeRemote(id: string): Promise<void> {
      try {
        await deleteRecipe(request, id);
        if (selectedAppMapId() === id) setSelectedAppMapId(null);
        await refreshRecipes();
        toast("Map deleted", "success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(msg, "error");
        toast(msg, "error");
      }
    }

    const {
      captureUiSnapshot,
      captureUiScreenshot,
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
      setBusyCapture,
      setSnapshot,
      setShowOverlays,
      setLiveFrame,
      setLiveCaptureIssue,
      pushFrame,
      copyImage: platform.copyImage,
      appendLog,
      refreshDiscoverySessions,
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
          const latestMap = appMaps().toSorted(
            (left, right) => right.updatedAt - left.updatedAt,
          )[0];
          if (latestMap) setSelectedAppMapId(latestMap.id);
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
      eventAbort?.abort();
      if (eventReconnectTimer) clearTimeout(eventReconnectTimer);
    });

    async function cancelJobRemote(jobId?: string) {
      const id = jobId ?? selectedJobId() ?? undefined;
      try {
        if (id) {
          if (!client) await resolveConnection();
          await client!.invoke("job.cancel", { jobId: id });
        } else {
          if (!client) await resolveConnection();
          await client!.invoke("job.active.cancel", {});
        }
        appendLog("cancel requested", "info", id);
        void refreshJobs();
      } catch (err) {
        appendLog(err instanceof Error ? err.message : String(err), "error");
      }
    }

    async function pauseJobRemote(jobId?: string) {
      const id = jobId ?? selectedJobId();
      if (!id) {
        appendLog("No job to pause", "error");
        return;
      }
      try {
        if (!client) await resolveConnection();
        await client!.invoke("job.pause", { jobId: id });
        appendLog("paused", "info", id);
        void refreshJobs();
      } catch (err) {
        appendLog(err instanceof Error ? err.message : String(err), "error");
      }
    }

    async function resumeJobRemote(jobId?: string) {
      const id = jobId ?? selectedJobId();
      if (!id) {
        appendLog("No job to resume", "error");
        return;
      }
      try {
        if (!client) await resolveConnection();
        await client!.invoke("job.resume", { jobId: id });
        appendLog("resumed", "info", id);
        void refreshJobs();
      } catch (err) {
        appendLog(err instanceof Error ? err.message : String(err), "error");
      }
    }

    const activeJob = () =>
      jobs().find((j) => j.status === "running" || j.status === "paused") ?? null;
    const isPaused = () => activeJob()?.status === "paused";
    // jobs() is newest-first (listJobs reverses); queued display order is
    // execution order — oldest queued first — so reverse the filtered slice.
    const queuedJobs = () =>
      jobs()
        .filter((j) => j.status === "queued")
        .reverse();
    const {
      runRecipe: runRecipeRemote,
      runAppMapFlow: runAppMapFlowRemote,
      runCompatibilityMatrix: runCompatibilityMatrixRemote,
      loadCompatibilityReport,
      retrySelectedJob,
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
      refreshJobs,
      rememberJob: (job) =>
        setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]),
      notify: platform.notify,
    });

    const selectedAppMap = createMemo(
      () => appMaps().find((appMap) => appMap.id === selectedAppMapId()) ?? null,
    );
    const selectedRecipe = createMemo(
      () => recipes().find((recipe) => recipe.id === selectedAppMapId()) ?? null,
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
      refreshAppMaps,
      loadAppMap,
      createAppMap,
      authoringSessions,
      selectedAppMapId,
      setSelectedAppMapId,
      selectedAppMap,
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
      setSelectedDevice: selectDeviceRemote,
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
      createDiscoverySession: createDiscoverySessionRemote,
      renameDiscoverySession: renameDiscoverySessionRemote,
      setDiscoveryStatus: setDiscoveryStatusRemote,
      captureDiscoveryScreen: captureDiscoveryScreenRemote,
      discoveryScreenUrl,
      promoteDiscoveryPath: promoteDiscoveryPathRemote,
      discoverySuggestion,
      loadDiscoveryCoverage,
      approveDiscoverySuggestion,
      backtrackDiscovery,
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
      pollHealth,
      retryConnection,
      runRecipeRemote,
      runAppMapFlowRemote,
      runCompatibilityMatrixRemote,
      loadCompatibilityReport,
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
      captureUiScreenshot,
      copyUiScreenshot,
      persistRecordingEvidence,
      recordingEvidenceUrl,
      jumpToJob,
      showOverlays,
      setShowOverlays,
      liveFrame,
      liveCaptureIssue,
      clearLiveCaptureIssue,
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

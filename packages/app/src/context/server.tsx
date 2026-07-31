import { createSignal, createEffect, createMemo, onCleanup } from "solid-js";
import { createSimpleContext } from "@relay/ui/context/helper";
import { ApiError, RelayClient } from "@relay/client";
import type {
  GenerationRequest,
  GenerationResult,
  DiscoverySession,
  DiscoveryCoverageReport,
  DiscoveryScope,
  DiscoveryControl,
  JourneyMetadata,
  JourneyCanvasNote,
  JourneyConnection,
  JourneyDeviceVariant,
  JourneyGraph,
  JourneyTake,
  CompatibilityMatrix,
  Revisioned,
  ServerConnection,
  TestVariable,
  TargetProfile,
  TargetDefinition,
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
  selectDevice as selectDeviceRequest,
} from "../lib/server-target-remote";
import { preferredTargetSerial } from "../lib/target-presentation";
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
import {
  deleteSuite as deleteSuiteRequest,
  listSuites as listSuitesRequest,
  loadSuiteHistory as loadSuiteHistoryRequest,
  restoreSuite as restoreSuiteRequest,
  runSuite as runSuiteRequest,
  saveSuite as saveSuiteRequest,
} from "../lib/server-suite-remote";
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
  SnapshotState,
  TraceFrameRef,
  TestAtlas,
  LocalSchedule,
  SaveSuiteInput,
  TestSuite,
  VisualComparison,
} from "../lib/api-types";

function mergeJourneyTakes(
  remote: JourneyTake[] | undefined,
  local: JourneyTake[] | undefined,
): JourneyTake[] {
  const byId = new Map((remote ?? []).map((take) => [take.id, take]));
  for (const take of local ?? []) byId.set(take.id, take);
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt).slice(-50);
}

function mergeJourneyConnections(
  remote: JourneyConnection[] | undefined,
  local: JourneyConnection[] | undefined,
): JourneyConnection[] {
  const byId = new Map((remote ?? []).map((connection) => [connection.id, connection]));
  for (const connection of local ?? []) byId.set(connection.id, connection);
  return [...byId.values()];
}

function mergeJourneyVariants(
  remote: JourneyDeviceVariant[] | undefined,
  local: JourneyDeviceVariant[] | undefined,
): JourneyDeviceVariant[] {
  const byId = new Map((remote ?? []).map((variant) => [variant.id, variant]));
  for (const variant of local ?? []) byId.set(variant.id, variant);
  return [...byId.values()];
}

function mergeJourneyNotes(
  remote: JourneyCanvasNote[] | undefined,
  local: JourneyCanvasNote[] | undefined,
): JourneyCanvasNote[] {
  const byId = new Map((remote ?? []).map((note) => [note.id, note]));
  for (const note of local ?? []) byId.set(note.id, note);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-100);
}

/**
 * The graph is an append-friendly canvas document. On a revision conflict we
 * retain objects created by either author and choose the newest edit for a
 * shared id. Deletions are currently local-only actions; when real multiplayer
 * arrives this is the one seam to extend with tombstones, not a reason to
 * spread collaboration conditionals through the canvas.
 */
function mergeJourneyGraphs(
  remote: JourneyGraph | undefined,
  local: JourneyGraph | undefined,
): JourneyGraph | undefined {
  if (!remote) return local;
  if (!local) return remote;
  const merge = <T extends { id: string; updatedAt: number }>(left: T[], right: T[]): T[] => {
    const byId = new Map(left.map((entry) => [entry.id, entry]));
    for (const entry of right) {
      const previous = byId.get(entry.id);
      if (!previous || entry.updatedAt >= previous.updatedAt) byId.set(entry.id, entry);
    }
    return [...byId.values()];
  };
  return {
    schemaVersion: 1,
    screens: merge(remote.screens, local.screens),
    transitions: merge(remote.transitions, local.transitions),
    flows: merge(remote.flows, local.flows),
  };
}

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
  SnapshotNode,
  SnapshotState,
  StepPoint,
  StepTarget,
  TraceFrameRef,
  TraceStep,
  TestAtlas,
  LocalSchedule,
  SaveSuiteInput,
  SuiteEntry,
  SuiteSection,
  TestSuite,
  VisualComparison,
} from "../lib/api-types";

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  gate: false,
  init: (props: { pollMs?: number } = {}) => {
    const platform = usePlatform();
    const pollMs = props.pollMs ?? 5000;

    const [serverUrl, setServerUrlState] = createSignal("");
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
    const [suites, setSuites] = createSignal<TestSuite[]>([]);
    const [selectedSuiteId, setSelectedSuiteId] = createSignal<string | null>(null);
    // Journey selection is session-scoped. A live device can outlast any one
    // journey, so restoring an old editor selection on launch makes the device
    // look attached to work the user did not explicitly resume.
    const [selectedRecipeId, setSelectedRecipeIdState] = createSignal<string | null>(null);
    function setSelectedRecipeId(id: string | null): void {
      setSelectedRecipeIdState(id);
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
    const [androidDeviceSetup, setAndroidDeviceSetup] = createSignal<AndroidSetupStatus | null>(null);
    const [projectVariables, setProjectVariables] = createSignal<Revisioned<TestVariable[]>>({
      revision: 0,
      value: [],
      updatedAt: 0,
    });
    const [clock, setClock] = createSignal(Date.now());

    let logSeq = 0;
    let eventAbort: AbortController | null = null;
    let connection: ServerConnection | null = null;
    let client: RelayClient | null = null;
    let playTimer: NodeJS.Timeout | undefined;
    let clockTimer: NodeJS.Timeout | undefined;
    let appleSetupRefreshSequence = 0;
    let deviceRefreshSequence = 0;

    const fetcher = () => platform.fetch ?? fetch;

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
          };
      connection = { ...connection, url: normalizeLocalBase(connection.url) };
      client = new RelayClient(connection, { fetch: fetcher() });
      setServerUrlState(connection.url);
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
          if (!selected) {
            void selectDeviceRemote(preferredTargetSerial(list));
          } else if (selectedTarget && !selectedDeviceAvailable) {
            // Rebind the returning target on the server as well as in the UI.
            void selectDeviceRequest(request, selected, selectedTarget.platform ?? "android");
          }
          selectedDeviceAvailable = Boolean(selectedTarget);
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
      setSelectedRecipeId(data.recipe.id);
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
        const data = await request<{ journeys: RecipeInfo[] }>("/journeys");
        const list = asArray<RecipeInfo>(data, "journeys");
        setRecipes(list);
        // A restored selection may point at a deleted recipe — fall back to
        // the first-run empty state, never silently to the first builtin.
        const sel = selectedRecipeId();
        if (sel && !list.some((r) => r.id === sel)) setSelectedRecipeId(null);
      } catch {
        /* ignore — recipes are non-critical for connectivity UX */
      }
    }

    async function refreshSuites() {
      if (health() === "offline") return;
      try {
        const list = await listSuitesRequest(request);
        setSuites(list);
        const selected = selectedSuiteId();
        if (selected && !list.some((suite) => suite.id === selected)) setSelectedSuiteId(null);
      } catch {
        /* suites do not block the rest of the workspace */
      }
    }

    async function saveSuiteRemote(input: SaveSuiteInput): Promise<TestSuite | null> {
      try {
        const suite = await saveSuiteRequest(request, input);
        await refreshSuites();
        setSelectedSuiteId(suite.id);
        return suite;
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error");
        return null;
      }
    }

    async function deleteSuiteRemote(id: string): Promise<void> {
      await deleteSuiteRequest(request, id);
      if (selectedSuiteId() === id) setSelectedSuiteId(null);
      await refreshSuites();
      toast("Suite deleted", "success");
    }

    async function restoreSuiteRemote(id: string, updatedAt: number): Promise<TestSuite> {
      const suite = await restoreSuiteRequest(request, id, updatedAt);
      await refreshSuites();
      return suite;
    }

    async function runSuiteRemote(id: string): Promise<void> {
      if (health() !== "online") {
        toast("Relay isn’t connected — can’t run yet", "warning");
        return;
      }
      const serial = selectedDevice() ?? undefined;
      if (!serial) {
        toast("Choose a phone or browser first", "warning");
        return;
      }
      const target = devices().find((device) => device.serial === serial);
      const targetKind = target?.platform === "browser" ? "browser" : "device";
      try {
        const result = await runSuiteRequest(request, id, {
          serial,
          platform: target?.platform === "ios" ? "ios" : "android",
          targetKind,
          ...(targetKind === "browser" ? { browserTargetId: serial } : {}),
        });
        if (result.jobs[0]) setSelectedJobId(result.jobs[0].id);
        toast(
          `${result.jobs.length} ${result.jobs.length === 1 ? "test" : "tests"} queued`,
          "success",
        );
        await refreshJobs();
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error");
      }
    }

    async function refreshJobs() {
      if (health() === "offline") return;
      try {
        const data = await request<{ jobs: JobInfo[]; active: JobInfo | null }>("/jobs?full=0");
        const list = asArray<JobInfo>(data, "jobs");
        setJobs(list);
        const active = data.active;
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

    async function loadVisualComparison(id: string): Promise<VisualComparison | null> {
      try {
        return await request<VisualComparison>(`/runs/${encodeURIComponent(id)}/visual-baseline`);
      } catch {
        return null;
      }
    }

    async function approveVisualBaseline(id: string): Promise<VisualComparison | null> {
      try {
        await request(`/runs/${encodeURIComponent(id)}/visual-baseline`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        return await loadVisualComparison(id);
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

    async function loadJourney(recipeId: string): Promise<Revisioned<JourneyMetadata>> {
      if (!client) await resolveConnection();
      return client!.journey(recipeId);
    }

    async function saveJourney(
      recipeId: string,
      current: Revisioned<JourneyMetadata>,
      value: JourneyMetadata,
    ): Promise<Revisioned<JourneyMetadata>> {
      if (!client) await resolveConnection();
      try {
        return await client!.updateJourney(recipeId, {
          expectedRevision: current.revision,
          value,
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const latest = (error.body as { current?: Revisioned<JourneyMetadata> })?.current;
          if (latest) {
            return client!.updateJourney(recipeId, {
              expectedRevision: latest.revision,
              value: {
                ...latest.value,
                ...value,
                positions: { ...latest.value.positions, ...value.positions },
                screenTitles: { ...latest.value.screenTitles, ...value.screenTitles },
                edgeLabels: { ...latest.value.edgeLabels, ...value.edgeLabels },
                edgeKinds: { ...latest.value.edgeKinds, ...value.edgeKinds },
                notes: mergeJourneyNotes(latest.value.notes, value.notes),
                // A take has one stable id; keep local updates for matching
                // ids while retaining remote takes created by collaborators.
                takes: mergeJourneyTakes(latest.value.takes, value.takes),
                prototype: {
                  ...latest.value.prototype,
                  ...value.prototype,
                  connections: mergeJourneyConnections(
                    latest.value.prototype?.connections,
                    value.prototype?.connections,
                  ),
                  deviceVariants: mergeJourneyVariants(
                    latest.value.prototype?.deviceVariants,
                    value.prototype?.deviceVariants,
                  ),
                },
                graph: mergeJourneyGraphs(latest.value.graph, value.graph),
              },
              idempotencyKey: crypto.randomUUID(),
            });
          }
        }
        throw error;
      }
    }

    async function generate(input: GenerationRequest): Promise<GenerationResult> {
      if (!client) await resolveConnection();
      return client!.generate(input);
    }

    async function loadAtlas(): Promise<TestAtlas> {
      const data = await request<{ atlas: TestAtlas }>("/atlas");
      return data.atlas;
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
        refreshSuites(),
        refreshJobs(),
        refreshRuns(),
        refreshSchedules(),
        refreshProjectVariables(),
        refreshRedactionPolicy(),
        refreshEvidenceCollectionPolicy(),
      ]);
      connectSse();
    }

    function handleBusEvent(raw: unknown) {
      if (!raw || typeof raw !== "object") return;
      const ev = raw as Record<string, unknown>;
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
          if (ev.serial) setSelectedDevice(String(ev.serial));
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
      if (!client) return;
      eventAbort = new AbortController();
      setSseConnected(false);
      void client
        .events(handleBusEvent, {
          signal: eventAbort.signal,
          onOpen: () => setSseConnected(true),
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name !== "AbortError") setSseConnected(false);
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
      selectedDeviceAvailable = devices().some((device) => device.serial === serial);
      void Promise.resolve(platform.storage.set("selectedDevice", serial ?? "")).catch(
        () => undefined,
      );
      const targetPlatform =
        devices().find((device) => device.serial === serial)?.platform ?? "android";
      try {
        await selectDeviceRequest(request, serial, targetPlatform);
      } catch {
        /* offline ok */
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
        const recipe = await saveRecipeRemoteRequest(request, input);
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
        setSelectedRecipeId(recipe.id);
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
        if (selectedRecipeId() === id) setSelectedRecipeId(null);
        await refreshRecipes();
        toast("Journey deleted", "success");
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
      await pollHealth();
      if (health() === "online") {
        await Promise.all([
          refreshDevices(),
          refreshTargets(),
          refreshActions(),
          refreshRecipes(),
          refreshSuites(),
          refreshJobs(),
          refreshRuns(),
          refreshSchedules(),
          refreshProjectVariables(),
          refreshRedactionPolicy(),
          refreshEvidenceCollectionPolicy(),
        ]);
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
            void refreshSuites();
            void refreshRuns();
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
      activeJob,
      queuedJobs,
      captureBeforeRun: (label, actionId) => captureUiScreenshot(label, undefined, actionId, true),
      appendLog,
      setSelectedJobId,
      setSelectedAction,
      setError,
      refreshJobs,
      notify: platform.notify,
    });

    const selectedRecipe = createMemo(
      () => recipes().find((recipe) => recipe.id === selectedRecipeId()) ?? null,
    );

    return {
      serverUrl,
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
      loadJourney,
      saveJourney,
      generate,
      loadAtlas,
      scheduleRecipe,
      refreshSchedules,
      deleteLocalSchedule,
      health,
      isOffline,
      isEmptyDevices,
      deviceDiscoveryStatus,
      sseConnected,
      devices,
      targets,
      targetProfiles,
      matrices,
      discoverySessions,
      activeDiscoverySessionId,
      setActiveDiscoverySessionId,
      actions,
      recipes,
      suites,
      selectedSuiteId,
      setSelectedSuiteId,
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
      refreshSuites,
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
      loadVisualComparison,
      approveVisualBaseline,
      pollHealth,
      retryConnection,
      runRecipeRemote,
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
      saveSuiteRemote,
      deleteSuite: deleteSuiteRemote,
      loadSuiteHistory: (id: string) => loadSuiteHistoryRequest(request, id),
      restoreSuite: restoreSuiteRemote,
      runSuiteRemote,
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
      videoUrlForRun,
      recordIosVideo,
      iosVideoUrl,
    };
  },
});

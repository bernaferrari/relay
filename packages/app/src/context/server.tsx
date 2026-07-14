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
  CompatibilityMatrix,
  MatrixExpansion,
  Revisioned,
  ServerConnection,
  TestVariable,
  TargetProfile,
  TargetDefinition,
  TargetPreflight,
} from "@relay/protocol";
import { usePlatform } from "./platform";
import { toast } from "./toast";
import { asArray, levelFromLine, normalizeLocalBase, uid } from "../lib/api";
import { createServerCapture } from "../lib/server-capture";
import {
  deleteMatrix,
  importMatrixYaml,
  loadMatrixYaml,
  resolveMatrix,
  saveMatrix,
} from "../lib/server-matrix-remote";
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
  deleteTarget,
  listActions,
  listDevices,
  listTargetProfiles,
  listTargets,
  preflightTarget,
  saveBrowserTarget as saveBrowserTargetRemote,
  selectDevice as selectDeviceRequest,
} from "../lib/server-target-remote";
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
import { enqueueMatrix, enqueueRecipe, loadMatrixReport, retryJob } from "../lib/server-run-remote";
import type {
  ActionInfo,
  CompatibilityReport,
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
} from "../lib/api-types";

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
  StepTarget,
  TraceFrameRef,
  TraceStep,
  TestAtlas,
  LocalSchedule,
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
    const [targets, setTargets] = createSignal<TargetDefinition[]>([]);
    const [targetProfiles, setTargetProfiles] = createSignal<TargetProfile[]>([]);
    const [matrices, setMatrices] = createSignal<CompatibilityMatrix[]>([]);
    const [discoverySessions, setDiscoverySessions] = createSignal<DiscoverySession[]>([]);
    const [activeDiscoverySessionId, setActiveDiscoverySessionId] = createSignal<string | null>(
      null,
    );
    const [actions, setActions] = createSignal<ActionInfo[]>([]);
    const [recipes, setRecipes] = createSignal<RecipeInfo[]>([]);
    // Selection is persisted (platform.storage "selectedRecipeId") so returning
    // users land on their last test; brand-new users (no stored id) land on the
    // first-run empty state — we never auto-select the first builtin.
    const [selectedRecipeId, setSelectedRecipeIdState] = createSignal<string | null>(null);
    function setSelectedRecipeId(id: string | null): void {
      setSelectedRecipeIdState(id);
      void (async () => {
        try {
          await platform.storage.set("selectedRecipeId", id ?? "");
        } catch {
          /* ignore */
        }
      })();
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
    const [prodAccountMatch, setProdAccountMatchState] = createSignal("");
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
      return client!.request<T>(path, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      });
    }

    function dismissError() {
      setError(null);
    }

    const isOffline = () => health() === "offline";
    const isEmptyDevices = () => devices().length === 0;

    async function refreshDevices() {
      if (health() === "offline") return;
      try {
        const list = (await listDevices(request)).map((d) => ({
          ...d,
          serial: String(d.serial ?? d.id ?? ""),
        }));
        setDevices(list);
        if (!selectedDevice() && list[0]) void selectDeviceRemote(list[0].serial);
        // clear only network-ish noise; keep explicit action errors
        if (error()?.match(/failed to fetch|network|ECONNREFUSED|offline/i)) setError(null);
      } catch (err) {
        // calm when known offline — OfflineGate owns that UX
        if (health() === "offline") return;
        setError(err instanceof Error ? err.message : String(err));
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

    async function refreshTargets() {
      if (health() === "offline") return;
      setTargets(await listTargets(request));
    }

    async function refreshTargetProfiles() {
      if (health() === "offline") return;
      setTargetProfiles(await listTargetProfiles(request));
    }

    async function refreshMatrices() {
      if (health() === "offline") return;
      const data = await request<{ matrices: CompatibilityMatrix[] }>("/matrices");
      setMatrices(data.matrices ?? []);
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

    async function saveCompatibilityMatrixRemote(input: {
      id: string;
      name: string;
      selectors: CompatibilityMatrix["selectors"];
    }): Promise<CompatibilityMatrix> {
      const existing = matrices().some((matrix) => matrix.id === input.id);
      const data = await saveMatrix(request, input, existing);
      await refreshMatrices();
      return data.matrix;
    }

    async function deleteCompatibilityMatrixRemote(id: string): Promise<void> {
      await deleteMatrix(request, id);
      await refreshMatrices();
    }

    async function resolveCompatibilityMatrixRemote(id: string): Promise<MatrixExpansion> {
      return resolveMatrix(request, id);
    }

    async function loadCompatibilityMatrixYaml(id: string): Promise<string | null> {
      try {
        return await loadMatrixYaml(request, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendLog(message, "error");
        toast(message, "error");
        return null;
      }
    }

    async function importCompatibilityMatrixYaml(
      yaml: string,
      conflict: "reject" | "replace" = "reject",
    ): Promise<CompatibilityMatrix | null> {
      try {
        const matrix = await importMatrixYaml(request, yaml, conflict);
        await refreshMatrices();
        toast(`Imported “${matrix.name}”`, "success");
        return matrix;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendLog(message, "error");
        toast(message, "error");
        return null;
      }
    }

    async function saveBrowserTarget(input: {
      id?: string;
      name: string;
      startUrl: string;
      executablePath?: string;
      headless?: boolean;
    }): Promise<TargetDefinition> {
      const target = await saveBrowserTargetRemote(request, input);
      await Promise.all([refreshTargets(), refreshTargetProfiles(), refreshDevices()]);
      return target;
    }

    async function deleteTargetRemote(id: string): Promise<void> {
      await deleteTarget(request, id);
      if (selectedDevice() === id) await selectDeviceRemote(null);
      await Promise.all([refreshTargets(), refreshTargetProfiles(), refreshDevices()]);
    }

    async function preflightTargetRemote(id: string): Promise<TargetPreflight> {
      return preflightTarget(request, id);
    }

    async function refreshRecipes() {
      if (health() === "offline") return;
      try {
        const data = await request<{ recipes: RecipeInfo[] }>("/recipes");
        const list = asArray<RecipeInfo>(data, "recipes");
        setRecipes(list);
        // A restored selection may point at a deleted recipe — fall back to
        // the first-run empty state, never silently to the first builtin.
        const sel = selectedRecipeId();
        if (sel && !list.some((r) => r.id === sel)) setSelectedRecipeId(null);
      } catch {
        /* ignore — recipes are non-critical for connectivity UX */
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
        setPersistedRuns(list);
        setRunsRoot(data.root ?? "");
      } catch {
        /* ignore */
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
                positions: { ...latest.value.positions, ...value.positions },
                edgeLabels: { ...latest.value.edgeLabels, ...value.edgeLabels },
                edgeKinds: { ...latest.value.edgeKinds, ...value.edgeKinds },
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
        refreshJobs(),
        refreshRuns(),
        refreshSchedules(),
        refreshProjectVariables(),
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

    async function selectDeviceRemote(serial: string | null) {
      setSelectedDevice(serial);
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
        toast("Test deleted", "success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(msg, "error");
        toast(msg, "error");
      }
    }

    async function runRecipeRemote(id: string, repetitions = 1): Promise<void> {
      if (health() !== "online") {
        toast("Relay isn’t connected — can’t run yet", "warning");
        return;
      }
      const serial = selectedDevice() ?? undefined;
      const targetPlatform =
        devices().find((device) => device.serial === serial)?.platform ?? "android";
      // Snapshot before enqueue so the toast reports the right queue position.
      // The new job lands behind the active job + any already-queued jobs.
      const queuedBefore = queuedJobs().length;
      const willQueue = Boolean(activeJob()) || queuedBefore > 0;
      appendLog(`enqueue recipe ${id}${serial ? ` on ${serial}` : ""}…`, "info");

      try {
        await captureUiScreenshot(`before · ${id}`, undefined, id).catch(() => undefined);
        const data = await enqueueRecipe(request, {
          recipe: id,
          ...(serial ? { serial } : {}),
          ...(targetPlatform === "browser"
            ? { targetKind: "browser" as const, browserTargetId: serial }
            : { targetKind: "device" as const, platform: targetPlatform }),
          repetitions,
          projectId: connection?.projectId ?? "default",
          ...(prodAccountMatch() ? { prodAccountMatch: prodAccountMatch() } : {}),
        });
        const first = data.jobs[0];
        if (first) setSelectedJobId(first.id);
        const title = recipes().find((r) => r.id === id)?.title ?? id;
        if (repetitions > 1) {
          toast(`Queued ${repetitions} frozen trials for ${title}`, "success");
          void platform.notify?.("Stage", `Queued ${repetitions} trials for ${title}`);
        } else if (willQueue) {
          toast(`Queued ${title} — position ${queuedBefore + 1}`, "info");
          void platform.notify?.("Stage", `Queued ${title} — position ${queuedBefore + 1}`);
        } else {
          toast(`Running ${title}`, "success");
          void platform.notify?.("Stage", `Running ${title}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(msg, "error");
        toast(msg, "error");
        setError(msg);
      }
    }

    async function runCompatibilityMatrixRemote(
      recipeId: string,
      matrixId: string,
      repetitions = 1,
    ): Promise<void> {
      if (health() !== "online") {
        toast("Relay isn’t connected — can’t run yet", "warning");
        return;
      }
      const matrix = matrices().find((item) => item.id === matrixId);
      try {
        const data = await enqueueMatrix(request, {
          recipe: recipeId,
          matrixId,
          repetitions,
          ...(prodAccountMatch() ? { prodAccountMatch: prodAccountMatch() } : {}),
        });
        if (data.jobs[0]) setSelectedJobId(data.jobs[0].id);
        toast(
          `Queued ${data.jobs.length} ${data.jobs.length === 1 ? "run" : "runs"} across ${data.matrix.profiles.length} target${data.matrix.profiles.length === 1 ? "" : "s"}${matrix ? ` · ${matrix.name}` : ""}`,
          "success",
        );
        await refreshJobs();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendLog(message, "error");
        toast(message, "error");
      }
    }

    async function loadCompatibilityReport(batchId: string): Promise<CompatibilityReport | null> {
      try {
        return await loadMatrixReport(request, batchId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A batch can be visible while its first job is still being written. That
        // is an expected empty state, not a user-facing error.
        if (!/not found/i.test(message)) appendLog(message, "error");
        return null;
      }
    }

    async function retrySelectedJob(jobId?: string) {
      const id = jobId ?? selectedJobId();
      if (!id) {
        appendLog("No job to retry", "error");
        return;
      }
      appendLog(`retry / heal ${id.slice(0, 8)}…`, "info");

      try {
        const job = await retryJob(request, id);
        setSelectedJobId(job.id);
        setSelectedAction(job.action);
        void refreshJobs();
      } catch (err) {
        appendLog(err instanceof Error ? err.message : String(err), "error");
      }
    }

    const {
      captureUiSnapshot,
      captureUiScreenshot,
      persistRecordingEvidence,
      recordingEvidenceUrl,
      pollLiveFrame,
      pollLiveSnapshot,
      pressNode,
      interactStep,
      runStep,
      frameUrlForPersisted,
      videoUrlForRun,
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
      pushFrame,
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
      // Restore the last-selected test BEFORE recipes load, so the recipes
      // refresh can validate it (and a missing id falls back to null).
      try {
        const savedSel = await platform.storage.get("selectedRecipeId");
        if (savedSel) setSelectedRecipeIdState(savedSel);
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
          refreshJobs(),
          refreshRuns(),
          refreshSchedules(),
          refreshProjectVariables(),
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
            void refreshRuns();
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
          await request(`/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
        } else {
          await request(`/jobs/active/cancel`, { method: "POST", body: "{}" });
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
        await request(`/jobs/${encodeURIComponent(id)}/pause`, { method: "POST", body: "{}" });
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
        await request(`/jobs/${encodeURIComponent(id)}/resume`, { method: "POST", body: "{}" });
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
    const selectedRecipe = createMemo(
      () => recipes().find((recipe) => recipe.id === selectedRecipeId()) ?? null,
    );

    return {
      serverUrl,
      setServerUrl,
      prodAccountMatch,
      setProdAccountMatch,
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
      selectedRecipeId,
      setSelectedRecipeId,
      selectedRecipe,
      jobs,
      persistedRuns,
      schedules,
      runsRoot,
      selectedDevice,
      setSelectedDevice: selectDeviceRemote,
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
      refreshJobs,
      refreshRuns,
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
      persistRecordingEvidence,
      recordingEvidenceUrl,
      jumpToJob,
      showOverlays,
      setShowOverlays,
      liveFrame,
      pollLiveFrame,
      pollLiveSnapshot,
      frameUrlForPersisted,
      videoUrlForRun,
    };
  },
});

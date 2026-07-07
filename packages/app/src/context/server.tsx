import { createSignal, createEffect, onCleanup } from "solid-js";
import { createSimpleContext } from "@grok-device/ui/context/helper";
import { usePlatform } from "./platform";
import { toast } from "./toast";

export type DeviceInfo = {
  id?: string;
  serial: string;
  name?: string;
  kind?: string | null;
  booted?: boolean | null;
  [key: string]: unknown;
};

export type ActionInfo = {
  id: string;
  title: string;
  description?: string;
  category: string;
  requiresProdMatch?: boolean;
  isAlpha?: boolean;
  glyphs?: string[];
  [key: string]: unknown;
};

export type TraceFrameRef = {
  path: string;
  caption: string;
  capturedAt: number;
  bytes?: number;
  base64?: string;
  mime?: string;
};

export type TraceStep = {
  id: string;
  index: number;
  kind: string;
  tone: string;
  title: string;
  glyphs: string[];
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  frames: TraceFrameRef[];
  log: string;
  heal?: string;
  status?: string;
};

export type JobInfo = {
  id: string;
  action: string;
  serial?: string;
  status: "queued" | "running" | "paused" | "ok" | "error" | "healed" | "cancelled";
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  logs: string[];
  result?: unknown;
  error?: string;
  previousError?: string;
  healed?: boolean;
  healMessage?: string;
  attempts?: number;
  retryOf?: string;
  retriedBy?: string;
  steps?: TraceStep[];
  frames?: TraceFrameRef[];
  glyphs?: string[];
  kind?: string;
  tone?: string;
  title?: string;
  runDir?: string;
  persisted?: boolean;
};

export type PersistedRun = {
  id: string;
  action: string;
  serial?: string;
  status: string;
  healed?: boolean;
  healMessage?: string;
  attempts: number;
  dir: string;
  frames: TraceFrameRef[];
  steps: TraceStep[];
  logs: string[];
  durationMs?: number;
  error?: string;
  writtenAt: number;
};

export type HealthState = "unknown" | "online" | "offline";

export type LogLine = {
  id: number;
  text: string;
  level: "info" | "success" | "error" | "default";
  at: number;
  jobId?: string;
};

export type SnapshotNode = {
  label?: string;
  value?: string;
  identifier?: string;
  enabled?: boolean;
  hittable?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  ref?: string;
};

export type SnapshotState = {
  serial?: string;
  capturedAt: number;
  nodes: SnapshotNode[];
  interactive: SnapshotNode[];
  tree?: string;
  bounds?: { width: number; height: number };
} | null;

export type Frame = {
  id: string;
  capturedAt: number;
  mime: string;
  base64: string;
  bytes: number;
  serial?: string;
  caption: string;
  jobId?: string;
  actionId?: string;
  path?: string;
};

export type PanelTab = "summary" | "steps" | "inspector" | "artifacts";

function normalizeBase(url: string) {
  return url.replace(/\/+$/, "");
}

function asArray<T>(value: unknown, key?: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (
    value &&
    typeof value === "object" &&
    key &&
    Array.isArray((value as Record<string, unknown>)[key])
  ) {
    return (value as Record<string, unknown>)[key] as T[];
  }
  return [];
}

function levelFromLine(text: string): LogLine["level"] {
  if (/FAIL|error|Error|ERR/i.test(text)) return "error";
  if (/DONE|ok|success|healed/i.test(text)) return "success";
  if (/^==>|^\[|health|poll|job\./i.test(text)) return "info";
  return "default";
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Polling equality gates — skip setX when a poll returns an unchanged list,
// so unchanged polls don't re-create arrays and thrash dependents every cycle.
let prevDevicesKey = "";
let prevJobsKey = "";
let prevRunsKey = "";
export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  gate: false,
  init: (props: { pollMs?: number } = {}) => {
    const platform = usePlatform();
    const pollMs = props.pollMs ?? 5000;

    const [serverUrl, setServerUrlState] = createSignal("");
    const [health, setHealth] = createSignal<HealthState>("unknown");
    const [devices, setDevices] = createSignal<DeviceInfo[]>([]);
    const [actions, setActions] = createSignal<ActionInfo[]>([]);
    const [jobs, setJobs] = createSignal<JobInfo[]>([]);
    const [persistedRuns, setPersistedRuns] = createSignal<PersistedRun[]>([]);
    const [runsRoot, setRunsRoot] = createSignal("");
    const [selectedDevice, setSelectedDevice] = createSignal<string | null>(null);
    const [selectedAction, setSelectedAction] = createSignal<string | null>(null);
    const [selectedJobId, setSelectedJobId] = createSignal<string | null>(null);
    const [running, setRunning] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [logs, setLogs] = createSignal<LogLine[]>([]);
    const [panelTab, setPanelTab] = createSignal<PanelTab>("steps");
    const [snapshot, setSnapshot] = createSignal<SnapshotState>(null);
    const [frames, setFrames] = createSignal<Frame[]>([]);
    const [frameIndex, setFrameIndex] = createSignal(0);
    const [playing, setPlaying] = createSignal(false);
    const [busyCapture, setBusyCapture] = createSignal(false);
    const [sseConnected, setSseConnected] = createSignal(false);
    const [showOverlays, setShowOverlays] = createSignal(true);
    const [prodAccountMatch, setProdAccountMatchState] = createSignal("");
    const [clock, setClock] = createSignal(Date.now());

    let logSeq = 0;
    let es: EventSource | null = null;
    let playTimer: NodeJS.Timeout | undefined;
    let clockTimer: NodeJS.Timeout | undefined;

    const fetcher = () => platform.fetch ?? fetch;

    const currentFrame = () => {
      const list = frames();
      if (list.length === 0) return null;
      const i = Math.min(Math.max(frameIndex(), 0), list.length - 1);
      return list[i] ?? null;
    };

    async function resolveUrl() {
      const url = await platform.getServerUrl();
      setServerUrlState(normalizeBase(url));
      return normalizeBase(url);
    }

    async function setServerUrl(url: string) {
      const next = normalizeBase(url);
      setServerUrlState(next);
      await platform.setServerUrl?.(next);
      connectSse(next);
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
      const base = serverUrl() || (await resolveUrl());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetcher()(`${base}${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            ...(init?.body ? { "Content-Type": "application/json" } : {}),
            ...init?.headers,
          },
        });
        if (!res.ok) {
          let msg = `${res.status} ${res.statusText}`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        return (await res.json()) as T;
      } catch (err) {
        if ((err instanceof DOMException || err instanceof Error) && err.name === "AbortError") {
          throw new Error("Request timed out");
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    function dismissError() {
      setError(null);
    }

    const isOffline = () => health() === "offline";
    const isEmptyDevices = () => devices().length === 0;

    async function refreshDevices() {
      if (health() === "offline") return;
      try {
        const data = await request<{ devices: DeviceInfo[] }>("/devices");
        const list = asArray<DeviceInfo>(data, "devices").map((d) => ({
          ...d,
          serial: String(d.serial ?? d.id ?? ""),
        }));
        const key = list.map((d) => `${d.serial}|${d.name ?? ""}`).join("~");
        if (key !== prevDevicesKey) {
          prevDevicesKey = key;
          setDevices(list);
        }
        if (!selectedDevice() && list[0]) setSelectedDevice(list[0].serial);
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
        const data = await request<{ actions: ActionInfo[] }>("/actions");
        const list = asArray<ActionInfo>(data, "actions");
        setActions(list);
        if (!selectedAction() && list[0]) setSelectedAction(list[0].id);
      } catch (err) {
        if (health() === "offline") return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    async function refreshJobs() {
      if (health() === "offline") return;
      try {
        const data = await request<{ jobs: JobInfo[]; active: JobInfo | null }>("/jobs?full=0");
        const list = asArray<JobInfo>(data, "jobs");
        const key = list.map((j) => `${j.id}|${j.status}|${j.finishedAt ?? 0}`).join("~");
        if (key !== prevJobsKey) {
          prevJobsKey = key;
          setJobs(list);
        }
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
        const key = list.map((r) => `${r.id}|${r.status}`).join("~");
        if (key !== prevRunsKey) {
          prevRunsKey = key;
          setPersistedRuns(list);
        }
        setRunsRoot(data.root ?? "");
      } catch {
        /* ignore */
      }
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
      await Promise.all([refreshDevices(), refreshActions(), refreshJobs(), refreshRuns()]);
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
            setPanelTab("steps");
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

    function connectSse(base?: string) {
      const url = base ?? serverUrl();
      if (!url || typeof EventSource === "undefined") return;
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      es = new EventSource(`${url}/events`);
      es.onopen = () => setSseConnected(true);
      es.onerror = () => setSseConnected(false);
      for (const t of [
        "job.queued",
        "job.started",
        "job.log",
        "job.finished",
        "job.cancelled",
        "job.resumed",
        "job.paused",
        "job.healed",
        "job.step",
        "job.frame",
        "device.selected",
        "snapshot.captured",
        "screenshot.captured",
        "error",
        "server.ready",
        "hello",
      ]) {
        es.addEventListener(t, (e) => {
          try {
            handleBusEvent(JSON.parse((e as MessageEvent).data));
          } catch {
            /* ignore */
          }
        });
      }
    }

    async function selectDeviceRemote(serial: string | null) {
      setSelectedDevice(serial);
      try {
        await request("/device/select", {
          method: "POST",
          body: JSON.stringify({ serial }),
        });
      } catch {
        /* offline ok */
      }
    }

    async function runSelected() {
      const action = selectedAction();
      if (!action) {
        appendLog("No action selected", "error");
        return;
      }
      const serial = selectedDevice() ?? undefined;
      appendLog(`enqueue ${action}${serial ? ` on ${serial}` : ""}…`, "info");
      setRunning(true);
      setPanelTab("steps");
      try {
        await captureUiScreenshot(`before · ${action}`, undefined, action).catch(() => undefined);
        const data = await request<{ job: JobInfo }>("/jobs", {
          method: "POST",
          body: JSON.stringify({
            action,
            serial,
            ...(prodAccountMatch() ? { prodAccountMatch: prodAccountMatch() } : {}),
          }),
        });
        setSelectedJobId(data.job.id);
        toast(`Queued ${action}`, "success");
        void platform.notify?.("Specimen", `Queued ${action}`);
      } catch (err) {
        setRunning(false);
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(msg, "error");
        toast(msg, "error");
        setError(msg);
      }
    }

    async function retrySelectedJob(jobId?: string) {
      const id = jobId ?? selectedJobId();
      if (!id) {
        appendLog("No job to retry", "error");
        return;
      }
      appendLog(`retry / heal ${id.slice(0, 8)}…`, "info");
      setRunning(true);
      try {
        const data = await request<{ job: JobInfo }>(`/jobs/${encodeURIComponent(id)}/retry`, {
          method: "POST",
          body: "{}",
        });
        setSelectedJobId(data.job.id);
        setSelectedAction(data.job.action);
        void refreshJobs();
      } catch (err) {
        setRunning(false);
        appendLog(err instanceof Error ? err.message : String(err), "error");
      }
    }

    async function captureUiSnapshot() {
      setBusyCapture(true);
      try {
        const serial = selectedDevice() ?? undefined;
        const q = serial ? `?serial=${encodeURIComponent(serial)}` : "";
        const data = await request<NonNullable<SnapshotState> & { tree?: string }>(`/snapshot${q}`);
        setSnapshot(data);
        setShowOverlays(true);
        setPanelTab("inspector");
        appendLog(
          `snapshot ${data.nodes.length} nodes · bounds ${data.bounds?.width ?? "?"}×${data.bounds?.height ?? "?"}`,
          "info",
        );
      } catch (err) {
        appendLog(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setBusyCapture(false);
      }
    }

    async function captureUiScreenshot(caption?: string, jobId?: string, actionId?: string) {
      setBusyCapture(true);
      try {
        const serial = selectedDevice() ?? undefined;
        const params = new URLSearchParams();
        if (serial) params.set("serial", serial);
        if (caption) params.set("caption", caption);
        if (jobId) params.set("jobId", jobId);
        const q = params.toString() ? `?${params}` : "";
        const data = await request<{
          serial?: string;
          capturedAt: number;
          mime: string;
          base64: string;
          bytes: number;
          jobId?: string;
          framePath?: string;
        }>(`/screenshot${q}`);
        pushFrame({
          capturedAt: data.capturedAt,
          mime: data.mime,
          base64: data.base64,
          bytes: data.bytes,
          serial: data.serial ?? serial,
          caption:
            caption ??
            `screenshot · ${new Date().toLocaleTimeString(undefined, { hour12: false })}`,
          jobId: data.jobId ?? jobId,
          actionId: actionId ?? selectedAction() ?? undefined,
          path: data.framePath,
        });
        appendLog(`screenshot ${data.bytes} bytes`, "info", data.jobId ?? jobId);
        toast("Screenshot captured", "success");
        return data;
      } catch (err) {
        appendLog(err instanceof Error ? err.message : String(err), "error");
        throw err;
      } finally {
        setBusyCapture(false);
      }
    }

    async function pressNode(node: SnapshotNode) {
      try {
        if (node.ref) {
          await request("/interact", {
            method: "POST",
            body: JSON.stringify({ kind: "ref", ref: node.ref, serial: selectedDevice() }),
          });
          appendLog(`pressed ref ${node.ref}`, "success");
        } else if (node.label) {
          await request("/interact", {
            method: "POST",
            body: JSON.stringify({ kind: "label", label: node.label, serial: selectedDevice() }),
          });
          appendLog(`pressed label ${node.label}`, "success");
        } else if (node.rect) {
          const x = Math.round(node.rect.x + node.rect.width / 2);
          const y = Math.round(node.rect.y + node.rect.height / 2);
          await request("/interact", {
            method: "POST",
            body: JSON.stringify({ kind: "point", x, y, serial: selectedDevice() }),
          });
          appendLog(`pressed point ${x},${y}`, "success");
        } else {
          appendLog("node has no actionable target", "error");
        }
        await captureUiScreenshot(node.label ? `after tap · ${node.label}` : "after tap").catch(
          () => undefined,
        );
        // refresh snapshot after tap for updated overlays
        void captureUiSnapshot().catch(() => undefined);
      } catch (err) {
        appendLog(err instanceof Error ? err.message : String(err), "error");
      }
    }

    /** Execute a recorded/interactive step (ref | label | point). Returns success. */
    async function interactStep(
      step:
        | { kind: "ref"; ref: string }
        | { kind: "label"; label: string }
        | { kind: "point"; x: number; y: number },
      caption?: string,
    ): Promise<boolean> {
      try {
        const body =
          step.kind === "ref"
            ? { kind: "ref", ref: step.ref }
            : step.kind === "label"
              ? { kind: "label", label: step.label }
              : { kind: "point", x: step.x, y: step.y };
        await request("/interact", {
          method: "POST",
          body: JSON.stringify({ ...body, serial: selectedDevice() }),
        });
        appendLog(`interact ${step.kind}`, "success");
        await captureUiScreenshot(caption ?? `interact · ${step.kind}`).catch(() => undefined);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(msg, "error");
        toast(msg, "error");
        return false;
      }
    }

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
      setPanelTab("steps");
      stopPlayback();
    }

    function frameUrlForPersisted(run: PersistedRun, frame: TraceFrameRef) {
      const base = serverUrl();
      const file = frame.path.split(/[\\/]/).pop() ?? frame.path;
      return `${base}/runs/${encodeURIComponent(run.id)}/frames/${encodeURIComponent(file)}`;
    }

    void (async () => {
      await resolveUrl();
      try {
        const saved = await platform.storage.get("prodAccountMatch");
        if (saved) setProdAccountMatchState(saved);
      } catch {
        /* ignore */
      }
      await pollHealth();
      if (health() === "online") {
        await Promise.all([refreshDevices(), refreshActions(), refreshJobs(), refreshRuns()]);
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
      es?.close();
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

    return {
      serverUrl,
      setServerUrl,
      prodAccountMatch,
      setProdAccountMatch,
      health,
      isOffline,
      isEmptyDevices,
      sseConnected,
      devices,
      actions,
      jobs,
      persistedRuns,
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
      refreshActions,
      refreshDevices,
      refreshJobs,
      refreshRuns,
      pollHealth,
      retryConnection,
      runSelected,
      cancelJob: cancelJobRemote,
      pauseJob: pauseJobRemote,
      resumeJob: resumeJobRemote,
      activeJob,
      isPaused,
      retrySelectedJob,
      panelTab,
      setPanelTab,
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
      jumpToJob,
      showOverlays,
      setShowOverlays,
      frameUrlForPersisted,
    };
  },
});

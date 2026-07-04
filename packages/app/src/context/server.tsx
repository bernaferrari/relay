import { createSignal, onCleanup } from "solid-js";
import { createSimpleContext } from "@grok-device/ui/context/helper";
import { usePlatform } from "./platform";

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
  [key: string]: unknown;
};

export type JobInfo = {
  id: string;
  action: string;
  serial?: string;
  status: "queued" | "running" | "ok" | "error";
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  logs: string[];
  result?: unknown;
  error?: string;
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
} | null;

export type Frame = {
  id: string;
  capturedAt: number;
  mime: string;
  base64: string;
  bytes: number;
  serial?: string;
  /** caption under the phone */
  caption: string;
  /** which job this frame belongs to, if any */
  jobId?: string;
  actionId?: string;
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
  if (/DONE|ok|success/i.test(text)) return "success";
  if (/^==>|^\[|health|poll|job\./i.test(text)) return "info";
  return "default";
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
    const [skipAccountSwitch, setSkipAccountSwitch] = createSignal(false);
    const [skipRestoreHome, setSkipRestoreHome] = createSignal(false);

    let logSeq = 0;
    let es: EventSource | null = null;
    let playTimer: ReturnType<typeof setInterval> | null = null;

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

    function appendLog(text: string, level?: LogLine["level"], jobId?: string) {
      logSeq += 1;
      const line: LogLine = {
        id: logSeq,
        text,
        level: level ?? levelFromLine(text),
        at: Date.now(),
        jobId,
      };
      setLogs((prev) => [...prev.slice(-400), line]);
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
        playTimer = null;
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

    async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
      const base = serverUrl() || (await resolveUrl());
      const res = await fetcher()(`${base}${path}`, {
        ...init,
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
    }

    async function refreshDevices() {
      try {
        const data = await request<{ devices: DeviceInfo[] }>("/devices");
        const list = asArray<DeviceInfo>(data, "devices").map((d) => ({
          ...d,
          serial: String(d.serial ?? d.id ?? ""),
        }));
        setDevices(list);
        if (!selectedDevice() && list[0]) setSelectedDevice(list[0].serial);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    async function refreshActions() {
      try {
        const data = await request<{ actions: ActionInfo[] }>("/actions");
        const list = asArray<ActionInfo>(data, "actions");
        setActions(list);
        if (!selectedAction() && list[0]) setSelectedAction(list[0].id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    async function refreshJobs() {
      try {
        const data = await request<{ jobs: JobInfo[]; active: JobInfo | null }>("/jobs");
        setJobs(asArray<JobInfo>(data, "jobs"));
        const active = data.active;
        setRunning(Boolean(active && active.status === "running"));
      } catch {
        /* ignore */
      }
    }

    async function pollHealth() {
      try {
        await request("/health");
        setHealth("online");
        setError(null);
      } catch {
        setHealth("offline");
      }
    }

    function handleBusEvent(raw: unknown) {
      if (!raw || typeof raw !== "object") return;
      const ev = raw as {
        type?: string;
        line?: string;
        level?: LogLine["level"];
        jobId?: string;
        action?: string;
        ok?: boolean;
        error?: string;
        serial?: string | null;
        durationMs?: number;
        nodeCount?: number;
        bytes?: number;
        message?: string;
      };
      switch (ev.type) {
        case "job.queued":
          appendLog(`queued ${ev.action}`, "info", ev.jobId);
          void refreshJobs();
          break;
        case "job.started":
          appendLog(`started ${ev.action}`, "info", ev.jobId);
          setRunning(true);
          setSelectedJobId(ev.jobId ?? null);
          setPanelTab("steps");
          void refreshJobs();
          break;
        case "job.log":
          if (ev.line) appendLog(ev.line, ev.level, ev.jobId);
          break;
        case "job.finished":
          appendLog(
            ev.ok
              ? `finished ${ev.action} (${ev.durationMs ?? "?"}ms)`
              : `failed ${ev.action}: ${ev.error ?? "?"}`,
            ev.ok ? "success" : "error",
            ev.jobId,
          );
          setRunning(false);
          void refreshJobs();
          // auto-shot after job so stage has evidence
          void captureUiScreenshot(
            ev.ok ? `${ev.action} · done` : `${ev.action} · failed`,
            ev.jobId,
            ev.action,
          ).catch(() => undefined);
          break;
        case "device.selected":
          if (ev.serial) setSelectedDevice(ev.serial);
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
      const types = [
        "job.queued",
        "job.started",
        "job.log",
        "job.finished",
        "device.selected",
        "snapshot.captured",
        "screenshot.captured",
        "error",
        "server.ready",
        "hello",
      ];
      for (const t of types) {
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
        // pre-shot for stage evidence
        await captureUiScreenshot(`before · ${action}`, undefined, action).catch(() => undefined);
        const data = await request<{ job: JobInfo }>("/jobs", {
          method: "POST",
          body: JSON.stringify({
            action,
            serial,
            skipAccountSwitch: skipAccountSwitch(),
            skipRestoreHome: skipRestoreHome(),
          }),
        });
        setSelectedJobId(data.job.id);
        void refreshJobs();
        void platform.notify?.("Grok Device", `Queued ${action}`);
      } catch (err) {
        setRunning(false);
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(msg, "error");
        setError(msg);
      }
    }

    async function captureUiSnapshot() {
      setBusyCapture(true);
      try {
        const serial = selectedDevice() ?? undefined;
        const q = serial ? `?serial=${encodeURIComponent(serial)}` : "";
        const data = await request<NonNullable<SnapshotState> & { tree?: string }>(`/snapshot${q}`);
        setSnapshot(data);
        setPanelTab("inspector");
        appendLog(`snapshot ${data.nodes.length} nodes`, "info");
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
        const q = serial ? `?serial=${encodeURIComponent(serial)}` : "";
        const data = await request<{
          serial?: string;
          capturedAt: number;
          mime: string;
          base64: string;
          bytes: number;
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
          jobId,
          actionId: actionId ?? selectedAction() ?? undefined,
        });
        appendLog(`screenshot ${data.bytes} bytes`, "info", jobId);
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
        }
        await captureUiScreenshot(node.label ? `after tap · ${node.label}` : "after tap").catch(
          () => undefined,
        );
      } catch (err) {
        appendLog(err instanceof Error ? err.message : String(err), "error");
      }
    }

    function jumpToJob(jobId: string) {
      setSelectedJobId(jobId);
      const job = jobs().find((j) => j.id === jobId);
      if (job) setSelectedAction(job.action);
      // jump scrubber to last frame for this job if any
      const list = frames();
      const idx = list
        .map((f, i) => ({ f, i }))
        .reverse()
        .find((x) => x.f.jobId === jobId)?.i;
      if (idx !== undefined) setFrameIndex(idx);
      setPanelTab("steps");
      stopPlayback();
    }

    void (async () => {
      await resolveUrl();
      await pollHealth();
      await Promise.all([refreshDevices(), refreshActions(), refreshJobs()]);
      connectSse();
    })();

    const poll = setInterval(() => {
      void (async () => {
        await pollHealth();
        if (health() === "online") {
          void refreshDevices();
          void refreshJobs();
        }
      })();
    }, pollMs);

    onCleanup(() => {
      clearInterval(poll);
      stopPlayback();
      es?.close();
    });

    return {
      serverUrl,
      setServerUrl,
      health,
      sseConnected,
      devices,
      actions,
      jobs,
      selectedDevice,
      setSelectedDevice: selectDeviceRemote,
      selectedAction,
      setSelectedAction,
      selectedJobId,
      setSelectedJobId,
      running,
      error,
      logs,
      appendLog,
      clearLogs,
      refreshDevices,
      refreshActions,
      refreshJobs,
      pollHealth,
      runSelected,
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
      pressNode,
      jumpToJob,
      skipAccountSwitch,
      setSkipAccountSwitch,
      skipRestoreHome,
      setSkipRestoreHome,
    };
  },
});

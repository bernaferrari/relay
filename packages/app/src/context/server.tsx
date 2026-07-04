import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { createSimpleContext } from "@grok-device/ui/context/helper";
import { usePlatform } from "./platform";

export type DeviceInfo = {
  serial: string;
  name?: string;
  model?: string;
  state?: string;
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

export type HealthState = "unknown" | "online" | "offline";

export type RunActionResult = {
  ok: boolean;
  action?: string;
  error?: string;
  result?: unknown;
  logs?: string[];
};

export type LogLine = {
  id: number;
  text: string;
  level: "info" | "success" | "error" | "default";
  at: number;
};

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
  if (/^==>|^\[|health|poll/i.test(text)) return "info";
  return "default";
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  gate: false,
  init: (props: { pollMs?: number } = {}) => {
    const platform = usePlatform();
    const pollMs = props.pollMs ?? 4000;

    const [serverUrl, setServerUrlState] = createSignal("");
    const [health, setHealth] = createSignal<HealthState>("unknown");
    const [devices, setDevices] = createSignal<DeviceInfo[]>([]);
    const [actions, setActions] = createSignal<ActionInfo[]>([]);
    const [selectedDevice, setSelectedDevice] = createSignal<string | null>(null);
    const [selectedAction, setSelectedAction] = createSignal<string | null>(null);
    const [running, setRunning] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [logs, setLogs] = createSignal<LogLine[]>([]);
    let logSeq = 0;

    const fetcher = () => platform.fetch ?? fetch;

    async function resolveUrl() {
      const url = await platform.getServerUrl();
      setServerUrlState(normalizeBase(url));
      return normalizeBase(url);
    }

    async function setServerUrl(url: string) {
      const next = normalizeBase(url);
      setServerUrlState(next);
      await platform.setServerUrl?.(next);
    }

    function appendLog(text: string, level?: LogLine["level"]) {
      logSeq += 1;
      const line: LogLine = {
        id: logSeq,
        text,
        level: level ?? levelFromLine(text),
        at: Date.now(),
      };
      setLogs((prev) => [...prev, line]);
    }

    function clearLogs() {
      logSeq = 0;
      setLogs([]);
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
        const body = await res.text().catch(() => "");
        throw new Error(body || `${res.status} ${res.statusText}`);
      }
      if (res.status === 204) return undefined as T;
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) return (await res.json()) as T;
      return (await res.text()) as T;
    }

    async function checkHealth() {
      try {
        await request("/health");
        setHealth("online");
        setError(null);
        return true;
      } catch (err) {
        setHealth("offline");
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    }

    async function refreshDevices() {
      try {
        const data = await request<unknown>("/devices");
        const list = asArray<DeviceInfo>(data, "devices").map((d) => ({
          ...d,
          serial: String(d.serial ?? d.id ?? ""),
          name: d.name ?? d.model ?? String(d.serial ?? d.id ?? "device"),
        }));
        setDevices(list.filter((d) => d.serial));
        const current = selectedDevice();
        if (current && !list.some((d) => d.serial === current)) {
          setSelectedDevice(list[0]?.serial ?? null);
        } else if (!current && list[0]) {
          setSelectedDevice(list[0].serial);
        }
        setHealth("online");
      } catch (err) {
        setHealth("offline");
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    async function refreshActions() {
      try {
        const data = await request<unknown>("/actions");
        const list = asArray<ActionInfo>(data, "actions").map((a) => ({
          ...a,
          id: String(a.id),
          title: a.title ?? String(a.id),
          category: a.category ?? "other",
        }));
        setActions(list);
        const current = selectedAction();
        if (current && !list.some((a) => a.id === current)) {
          setSelectedAction(list[0]?.id ?? null);
        } else if (!current && list[0]) {
          setSelectedAction(list[0].id);
        }
      } catch (err) {
        // actions may fail independently; surface but keep devices
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    async function refreshAll() {
      const ok = await checkHealth();
      if (!ok) {
        setDevices([]);
        return;
      }
      await Promise.all([refreshDevices(), refreshActions()]);
    }

    async function runAction(opts?: { actionId?: string; deviceSerial?: string }) {
      const actionId = opts?.actionId ?? selectedAction();
      const deviceSerial = opts?.deviceSerial ?? selectedDevice();
      if (!actionId) {
        appendLog("No action selected", "error");
        return { ok: false, error: "No action selected" } satisfies RunActionResult;
      }
      if (!deviceSerial) {
        appendLog("No device selected", "error");
        return { ok: false, error: "No device selected" } satisfies RunActionResult;
      }

      setRunning(true);
      appendLog(`Running ${actionId} on ${deviceSerial}…`, "info");

      try {
        const data = await request<RunActionResult>(
          `/actions/${encodeURIComponent(actionId)}/run`,
          {
            method: "POST",
            body: JSON.stringify({ device: deviceSerial, serial: deviceSerial }),
          },
        );

        const lines = data?.logs;
        if (Array.isArray(lines)) {
          for (const line of lines) appendLog(String(line));
        }

        if (data && data.ok === false) {
          const msg = data.error ?? "Action failed";
          appendLog(`FAIL: ${msg}`, "error");
          await platform.notify?.("Action failed", msg);
          return data;
        }

        appendLog(`DONE: ${actionId}`, "success");
        await platform.notify?.("Action complete", actionId);
        return data ?? { ok: true, action: actionId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`FAIL: ${msg}`, "error");
        await platform.notify?.("Action failed", msg);
        return { ok: false, action: actionId, error: msg } satisfies RunActionResult;
      } finally {
        setRunning(false);
      }
    }

    // Bootstrap URL + polling
    void resolveUrl().then(() => refreshAll());

    createEffect(() => {
      // re-poll when URL changes
      const url = serverUrl();
      if (!url) return;
      const timer = setInterval(() => {
        void refreshAll();
      }, pollMs);
      onCleanup(() => clearInterval(timer));
    });

    return {
      serverUrl: serverUrl as Accessor<string>,
      setServerUrl,
      health,
      devices,
      actions,
      selectedDevice,
      setSelectedDevice,
      selectedAction,
      setSelectedAction,
      running,
      error,
      logs,
      appendLog,
      clearLogs,
      refreshAll,
      refreshDevices,
      refreshActions,
      checkHealth,
      runAction,
    };
  },
});

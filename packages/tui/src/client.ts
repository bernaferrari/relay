import {
  ACTIONS,
  captureScreenshot,
  captureSnapshot,
  createDevice,
  enqueueJob,
  formatSnapshotTree,
  getJob,
  listDevices,
  listJobs,
  runAction,
  selectDevice,
  type ActionMeta,
  type ListedDevice,
  type TestJob,
} from "@grok-device/core";

export type DeviceClient = {
  mode: "http" | "in-process";
  baseUrl?: string;
  listDevices: () => Promise<ListedDevice[]>;
  listActions: () => Promise<ActionMeta[]>;
  listJobs: () => Promise<TestJob[]>;
  selectDevice: (serial: string | null) => Promise<void>;
  snapshot: (serial?: string) => Promise<{
    nodes: unknown[];
    interactive: unknown[];
    tree: string;
  }>;
  screenshot: (serial?: string) => Promise<{ path: string; bytes: number }>;
  runAction: (opts: {
    action: string;
    serial?: string;
    skipAccountSwitch?: boolean;
    skipRestoreHome?: boolean;
    onLog?: (line: string) => void;
  }) => Promise<{ ok: boolean; error?: string; result?: unknown }>;
};

async function httpJson<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
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

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function inProcessClient(): DeviceClient {
  return {
    mode: "in-process",
    async listDevices() {
      return listDevices();
    },
    async listActions() {
      return [...ACTIONS];
    },
    async listJobs() {
      return listJobs(30);
    },
    async selectDevice(serial) {
      selectDevice(serial);
    },
    async snapshot(serial) {
      const snap = await captureSnapshot({ serial });
      return { ...snap, tree: formatSnapshotTree(snap.nodes) };
    },
    async screenshot(serial) {
      const shot = await captureScreenshot({ serial });
      return { path: shot.path, bytes: shot.bytes };
    },
    async runAction(opts) {
      // prefer job queue so history is shared
      const job = enqueueJob({
        action: opts.action,
        serial: opts.serial,
        skipAccountSwitch: opts.skipAccountSwitch,
        skipRestoreHome: opts.skipRestoreHome,
      });
      for (;;) {
        const current = getJob(job.id)!;
        for (const line of current.logs.slice(opts.onLog ? 0 : 0)) {
          /* logs published live via execute; poll tail */
        }
        if (current.status === "ok" || current.status === "error") {
          if (opts.onLog) for (const line of current.logs) opts.onLog(line);
          return { ok: current.status === "ok", error: current.error, result: current.result };
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    },
  };
}

function httpClient(baseUrl: string): DeviceClient {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    mode: "http",
    baseUrl: base,
    async listDevices() {
      const data = await httpJson<{ devices: ListedDevice[] }>(base, "/devices");
      return data.devices;
    },
    async listActions() {
      const data = await httpJson<{ actions: ActionMeta[] }>(base, "/actions");
      return data.actions;
    },
    async listJobs() {
      const data = await httpJson<{ jobs: TestJob[] }>(base, "/jobs");
      return data.jobs;
    },
    async selectDevice(serial) {
      await httpJson(base, "/device/select", {
        method: "POST",
        body: JSON.stringify({ serial }),
      });
    },
    async snapshot(serial) {
      const q = serial ? `?serial=${encodeURIComponent(serial)}` : "";
      return httpJson(base, `/snapshot${q}`);
    },
    async screenshot(serial) {
      const q = serial ? `?serial=${encodeURIComponent(serial)}` : "";
      const data = await httpJson<{ path: string; bytes: number }>(base, `/screenshot${q}`);
      return data;
    },
    async runAction(opts) {
      const data = await httpJson<{
        ok: boolean;
        error?: string;
        result?: unknown;
        logs?: string[];
      }>(base, `/actions/${encodeURIComponent(opts.action)}/run`, {
        method: "POST",
        body: JSON.stringify({
          serial: opts.serial,
          skipAccountSwitch: opts.skipAccountSwitch,
          skipRestoreHome: opts.skipRestoreHome,
        }),
      });
      if (opts.onLog && data.logs) for (const line of data.logs) opts.onLog(line);
      return data;
    },
  };
}

export async function createClient(serverUrl?: string): Promise<DeviceClient> {
  const envUrl = process.env.GROK_DEVICE_URL?.trim();
  const candidate = (serverUrl ?? envUrl ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  if (serverUrl || envUrl || (await probe(candidate))) {
    if (await probe(candidate)) return httpClient(candidate);
  }
  // ensure device client constructable
  createDevice();
  return inProcessClient();
}

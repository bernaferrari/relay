import {
  ACTIONS,
  cancelJob,
  captureScreenshot,
  captureSnapshot,
  createDevice,
  enqueueJob,
  formatSnapshotTree,
  getActiveJob,
  getJob,
  listDevices,
  listJobs,
  loadRedactionPolicy,
  loadEvidenceCollectionPolicy,
  pauseJob,
  resumeJob,
  selectDevice,
  type ActionMeta,
  type ListedDevice,
  type TestJob,
} from "@relay/core";
import { RelayClient } from "@relay/client";

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
    onLog?: (line: string) => void;
  }) => Promise<{ ok: boolean; error?: string; result?: unknown; status?: string }>;
  cancel: (jobId?: string) => Promise<void>;
  pause: (jobId?: string) => Promise<void>;
  resume: (jobId?: string) => Promise<void>;
  getActiveJobId: () => Promise<string | null>;
};

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
      const job = enqueueJob({
        action: opts.action,
        serial: opts.serial,
      });
      let seen = 0;
      for (;;) {
        const current = getJob(job.id)!;
        if (opts.onLog) {
          const fresh = current.logs.slice(seen);
          for (const line of fresh) opts.onLog(line);
          seen = current.logs.length;
        }
        if (
          current.status === "ok" ||
          current.status === "error" ||
          current.status === "healed" ||
          current.status === "cancelled"
        ) {
          return {
            ok: current.status === "ok" || current.status === "healed",
            error: current.error,
            result: current.result,
            status: current.status,
          };
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    },
    async cancel(jobId) {
      const id = jobId ?? getActiveJob()?.id;
      if (!id) throw new Error("No active job");
      cancelJob(id);
    },
    async pause(jobId) {
      const id = jobId ?? getActiveJob()?.id;
      if (!id) throw new Error("No active job");
      pauseJob(id);
    },
    async resume(jobId) {
      const id = jobId ?? getActiveJob()?.id;
      if (!id) throw new Error("No active job");
      resumeJob(id);
    },
    async getActiveJobId() {
      return getActiveJob()?.id ?? null;
    },
  };
}

function httpClient(baseUrl: string): DeviceClient {
  const base = baseUrl.replace(/\/+$/, "");
  const token = process.env.RELAY_AUTH_TOKEN ?? process.env.GROK_DEVICE_AUTH_TOKEN;
  const relay = new RelayClient({
    url: base,
    auth: token ? { type: "bearer", token } : { type: "none" },
    organizationId:
      process.env.RELAY_ORGANIZATION_ID ?? process.env.GROK_DEVICE_ORGANIZATION_ID ?? "local",
    projectId: process.env.RELAY_PROJECT_ID ?? process.env.GROK_DEVICE_PROJECT_ID ?? "default",
  });
  const json = <T>(path: string, init?: RequestInit) => relay.request<T>(path, init);
  return {
    mode: "http",
    baseUrl: base,
    async listDevices() {
      const data = await json<{ devices: ListedDevice[] }>("/devices");
      return data.devices;
    },
    async listActions() {
      const data = await json<{ actions: ActionMeta[] }>("/actions");
      return data.actions;
    },
    async listJobs() {
      const data = await json<{ jobs: TestJob[] }>("/jobs");
      return data.jobs;
    },
    async selectDevice(serial) {
      await json("/device/select", {
        method: "POST",
        body: JSON.stringify({ serial }),
      });
    },
    async snapshot(serial) {
      const q = serial ? `?serial=${encodeURIComponent(serial)}` : "";
      return json(`/snapshot${q}`);
    },
    async screenshot(serial) {
      const q = serial ? `?serial=${encodeURIComponent(serial)}` : "";
      const data = await json<{ path: string; bytes: number }>(`/screenshot${q}`);
      return data;
    },
    async runAction(opts) {
      // Async job so cancel/pause work against the same server process
      const { job } = await json<{ job: TestJob }>("/jobs", {
        method: "POST",
        body: JSON.stringify({
          action: opts.action,
          serial: opts.serial,
        }),
      });
      let seen = 0;
      for (;;) {
        const data = await json<{ job: TestJob }>(`/jobs/${job.id}`);
        const current = data.job;
        if (opts.onLog && current.logs) {
          const fresh = current.logs.slice(seen);
          for (const line of fresh) opts.onLog(line);
          seen = current.logs.length;
        }
        if (
          current.status === "ok" ||
          current.status === "error" ||
          current.status === "healed" ||
          current.status === "cancelled"
        ) {
          return {
            ok: current.status === "ok" || current.status === "healed",
            error: current.error,
            result: current.result,
            status: current.status,
          };
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    },
    async cancel(jobId) {
      if (jobId) {
        await json(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
          method: "POST",
          body: "{}",
        });
      } else {
        await json(`/jobs/active/cancel`, { method: "POST", body: "{}" });
      }
    },
    async pause(jobId) {
      const id = jobId ?? (await this.getActiveJobId());
      if (!id) throw new Error("No active job");
      await json(`/jobs/${encodeURIComponent(id)}/pause`, {
        method: "POST",
        body: "{}",
      });
    },
    async resume(jobId) {
      const id = jobId ?? (await this.getActiveJobId());
      if (!id) throw new Error("No active job");
      await json(`/jobs/${encodeURIComponent(id)}/resume`, {
        method: "POST",
        body: "{}",
      });
    },
    async getActiveJobId() {
      const data = await json<{ active: TestJob | null }>("/jobs?limit=1");
      const a = data.active;
      if (a && (a.status === "running" || a.status === "paused")) return a.id;
      return null;
    },
  };
}

export async function createClient(serverUrl?: string): Promise<DeviceClient> {
  const envUrl = (process.env.RELAY_URL ?? process.env.GROK_DEVICE_URL)?.trim();
  const candidate = (serverUrl ?? envUrl ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  if (serverUrl || envUrl || (await probe(candidate))) {
    if (await probe(candidate)) return httpClient(candidate);
  }
  await Promise.all([loadRedactionPolicy(), loadEvidenceCollectionPolicy()]);
  // ensure device client constructable
  createDevice();
  return inProcessClient();
}

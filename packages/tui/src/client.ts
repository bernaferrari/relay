import { RelayClient } from "@relay/client";

export type ActionMeta = {
  id: string;
  title: string;
  description?: string;
  category?: string;
  requiresProdMatch?: boolean;
};

export type ListedDevice = {
  serial: string;
  name: string;
  platform?: string;
};

export type TestJob = {
  id: string;
  action: string;
  status: string;
  error?: string;
  result?: unknown;
  logs?: string[];
};

export type DeviceClient = {
  mode: "http";
  baseUrl?: string;
  listDevices: () => Promise<ListedDevice[]>;
  listActions: () => Promise<ActionMeta[]>;
  listJobs: () => Promise<TestJob[]>;
  selectDevice: (serial: string | null) => Promise<void>;
  snapshot: (serial: string) => Promise<{
    nodes: unknown[];
    interactive: unknown[];
    tree: string;
  }>;
  screenshot: (serial: string) => Promise<{ path: string; bytes: number }>;
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
      headers: {
        "X-Relay-Actor-Id": "human:local-tui",
        "X-Relay-Actor-Kind": "human",
        "X-Relay-Operation-Id": "system.health.get",
        "X-Relay-Request-Id": crypto.randomUUID(),
        "X-Relay-Command-At": String(Date.now()),
        "Idempotency-Key": crypto.randomUUID(),
      },
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function httpClient(baseUrl: string): DeviceClient {
  const base = baseUrl.replace(/\/+$/, "");
  const token = process.env.RELAY_AUTH_TOKEN;
  const relay = new RelayClient({
    url: base,
    auth: token ? { type: "bearer", token } : { type: "none" },
    organizationId: process.env.RELAY_ORGANIZATION_ID ?? "local",
    projectId: process.env.RELAY_PROJECT_ID ?? "default",
    actorId: process.env.RELAY_ACTOR_ID ?? "human:local-tui",
    actorKind: "human",
  });
  return {
    mode: "http",
    baseUrl: base,
    async listDevices() {
      const data = await relay.invoke("target.devices.list", {});
      return data.devices as ListedDevice[];
    },
    async listActions() {
      const data = await relay.invoke("target.actions.list", {});
      return data.actions as ActionMeta[];
    },
    async listJobs() {
      const data = await relay.invoke("job.list", { limit: 50 });
      return data.jobs as unknown as TestJob[];
    },
    async selectDevice(serial) {
      void serial;
    },
    async snapshot(serial) {
      return relay.invoke("target.snapshot.capture", { serial });
    },
    async screenshot(serial) {
      return relay.invoke("target.screenshot.capture", { serial });
    },
    async runAction(opts) {
      // Async job so cancel/pause work against the same server process
      const { job: rawJob } = await relay.invoke("job.start", {
        recipe: opts.action,
        ...(opts.serial ? { serial: opts.serial } : {}),
      });
      const job = rawJob as TestJob;
      let seen = 0;
      for (;;) {
        const data = await relay.invoke("job.get", { jobId: job.id });
        const current = data.job as TestJob;
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
        await relay.invoke("job.cancel", { jobId });
      } else {
        await relay.invoke("job.active.cancel", {});
      }
    },
    async pause(jobId) {
      const id = jobId ?? (await this.getActiveJobId());
      if (!id) throw new Error("No active job");
      await relay.invoke("job.pause", { jobId: id });
    },
    async resume(jobId) {
      const id = jobId ?? (await this.getActiveJobId());
      if (!id) throw new Error("No active job");
      await relay.invoke("job.resume", { jobId: id });
    },
    async getActiveJobId() {
      const data = await relay.invoke("job.list", { limit: 1 });
      const a = data.active as TestJob | null | undefined;
      if (a && (a.status === "running" || a.status === "paused")) return a.id;
      return null;
    },
  };
}

export async function createClient(serverUrl?: string): Promise<DeviceClient> {
  const envUrl = process.env.RELAY_URL?.trim();
  const candidate = (serverUrl ?? envUrl ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  if (await probe(candidate)) return httpClient(candidate);
  throw new Error(
    `Relay server is not reachable at ${candidate}. Start it with \`pnpm dev:serve\`, then retry.`,
  );
}

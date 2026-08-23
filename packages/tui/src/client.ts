import { RelayClient } from "@relay/client";

export type AppMapSummary = {
  id: string;
  name: string;
  revision: number;
};

export type GraphTestSummary = {
  id: string;
  name: string;
  intent?: string;
};

export type VariableSummary = { id: string; name: string; options: Array<{ id: string }> };
export type CombineSummary = {
  id: string;
  name: string;
  variableIds: string[];
  testIds: string[];
  selected?: Record<string, string[]>;
  captures?: Record<string, { mode: string }>;
};

export type AppMapDetails = AppMapSummary & {
  tests: Record<string, GraphTestSummary>;
  variables: Record<string, VariableSummary>;
  combines: Record<string, CombineSummary>;
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
  listAppMaps: () => Promise<AppMapSummary[]>;
  getAppMap: (appMapId: string) => Promise<AppMapDetails>;
  listJobs: () => Promise<TestJob[]>;
  selectDevice: (serial: string | null) => Promise<void>;
  snapshot: (serial: string) => Promise<{
    nodes: unknown[];
    interactive: unknown[];
    tree: string;
  }>;
  screenshot: (serial: string) => Promise<{ path: string; bytes: number }>;
  runTest: (opts: {
    appMapId: string;
    testId: string;
    expectedRevision: number;
    target: { kind: "device"; platform: "android" | "ios"; targetId: string };
    in?: Record<string, string[]>;
    lens?: "every-screen" | "failures-only" | "final-screen" | "none";
    executionMode?: "pilot" | "all";
    onLog?: (line: string) => void;
    timeoutMs?: number;
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
    async listAppMaps() {
      const data = await relay.invoke("app-map.list", {});
      return data.appMaps as AppMapSummary[];
    },
    async getAppMap(appMapId) {
      const data = await relay.invoke("app-map.get", { appMapId });
      return data.appMap as unknown as AppMapDetails;
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
    async runTest(opts) {
      const { job: rawJob } = await relay.invoke("app-map.test.run", {
        appMapId: opts.appMapId,
        testId: opts.testId,
        expectedRevision: opts.expectedRevision,
        target: opts.target,
        ...(opts.in ? { in: opts.in } : {}),
        ...(opts.lens ? { lens: opts.lens } : {}),
        ...(opts.executionMode ? { executionMode: opts.executionMode } : {}),
      });
      return pollJobUntilTerminal({
        jobId: (rawJob as TestJob).id,
        load: async (jobId) => {
          const data = await relay.invoke("job.get", { jobId });
          return data.job as TestJob;
        },
        onLog: opts.onLog,
        timeoutMs: opts.timeoutMs,
      });
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

const terminalStatuses = new Set(["ok", "error", "healed", "cancelled"]);

export async function pollJobUntilTerminal(input: {
  jobId: string;
  load: (jobId: string) => Promise<TestJob>;
  onLog?: (line: string) => void;
  timeoutMs?: number;
  pollMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<{ ok: boolean; error?: string; result?: unknown; status?: string }> {
  const timeoutMs = input.timeoutMs ?? 180_000;
  const pollMs = input.pollMs ?? 250;
  const wait =
    input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = Date.now() + timeoutMs;
  let seen = 0;
  for (;;) {
    const current = await input.load(input.jobId);
    if (input.onLog && current.logs) {
      for (const line of current.logs.slice(seen)) input.onLog(line);
      seen = current.logs.length;
    }
    if (terminalStatuses.has(current.status)) {
      return {
        ok: current.status === "ok" || current.status === "healed",
        error: current.error,
        result: current.result,
        status: current.status,
      };
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Test job ${input.jobId} after ${timeoutMs}ms`);
    }
    await wait(pollMs);
  }
}

export async function createClient(serverUrl?: string): Promise<DeviceClient> {
  const envUrl = process.env.RELAY_URL?.trim();
  const candidate = (serverUrl ?? envUrl ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  if (await probe(candidate)) return httpClient(candidate);
  throw new Error(
    `Relay server is not reachable at ${candidate}. Start it with \`pnpm dev:serve\`, then retry.`,
  );
}

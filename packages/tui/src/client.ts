/**
 * Backend for the TUI: HTTP against @grok-device/server, or in-process core.
 */
import {
  ACTIONS,
  PLATFORM,
  createDevice,
  isActionId,
  runAction,
  type ActionId,
  type ActionMeta,
  type RunActionResult,
} from "@grok-device/core";

export type ListedDevice = {
  id?: string;
  name: string;
  serial: string;
  kind?: string | null;
  booted?: boolean | null;
  platform?: string;
};

export type RunOpts = {
  serial?: string;
  skipAccountSwitch?: boolean;
  skipRestoreHome?: boolean;
  prodAccountMatch?: string;
  onLog?: (line: string) => void;
};

export type Client = {
  mode: "http" | "in-process";
  baseUrl?: string;
  listDevices: () => Promise<ListedDevice[]>;
  listActions: () => Promise<readonly ActionMeta[]>;
  run: (action: ActionId, opts?: RunOpts) => Promise<RunActionResult>;
};

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

async function httpJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const text = await res.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    const err =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    throw new Error(err);
  }
  return body as T;
}

export function createHttpClient(serverUrl: string): Client {
  const base = normalizeBase(serverUrl);

  return {
    mode: "http",
    baseUrl: base,
    async listDevices() {
      const data = await httpJson<{ devices: ListedDevice[] }>(`${base}/devices`);
      return data.devices ?? [];
    },
    async listActions() {
      const data = await httpJson<{ actions: ActionMeta[] }>(`${base}/actions`);
      return data.actions ?? [...ACTIONS];
    },
    async run(action, opts = {}) {
      // Server logs to its own process; stream user-facing lines via onLog wrapper
      opts.onLog?.(`==> ${action} (via ${base})`);
      const result = await httpJson<RunActionResult>(
        `${base}/actions/${encodeURIComponent(action)}/run`,
        {
          method: "POST",
          body: JSON.stringify({
            serial: opts.serial,
            skipAccountSwitch: opts.skipAccountSwitch,
            skipRestoreHome: opts.skipRestoreHome,
            prodAccountMatch: opts.prodAccountMatch,
          }),
        },
      );
      if (result.ok) {
        opts.onLog?.(
          `==> DONE: ${action}${result.result !== undefined ? ` — ${result.result}` : ""}`,
        );
      } else {
        opts.onLog?.(`==> FAIL: ${action} — ${result.error}`);
      }
      return result;
    },
  };
}

export function createInProcessClient(): Client {
  return {
    mode: "in-process",
    async listDevices() {
      const client = createDevice();
      const devices = await client.devices.list({ platform: PLATFORM });
      return devices.map((d) => {
        const serial = d.android?.serial ?? d.identifiers?.serial ?? d.id;
        return {
          id: d.id,
          name: d.name,
          serial,
          kind: d.kind ?? null,
          booted: d.booted ?? null,
          platform: PLATFORM,
        };
      });
    },
    async listActions() {
      return ACTIONS;
    },
    async run(action, opts = {}) {
      const serial = opts.serial?.trim();
      if (serial) {
        process.env.AGENT_DEVICE_SERIAL = serial;
        process.env.ANDROID_SERIAL = serial;
      }
      if (opts.prodAccountMatch?.trim()) {
        process.env.PROD_ACCOUNT_MATCH = opts.prodAccountMatch.trim();
      }
      if (!isActionId(action)) {
        return { ok: false, action, error: `Unknown action: ${action}` };
      }
      const device = createDevice();
      return runAction(device, action, {
        skipAccountSwitch: opts.skipAccountSwitch,
        skipRestoreHome: opts.skipRestoreHome,
        onLog: opts.onLog,
      });
    },
  };
}

export async function createClient(serverUrl?: string): Promise<Client> {
  const url = serverUrl?.trim() || process.env.GROK_DEVICE_URL?.trim();
  if (url) {
    // Probe health; fall back to in-process if unreachable
    try {
      const base = normalizeBase(url);
      const res = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) return createHttpClient(base);
      console.warn(`Server at ${base} returned ${res.status}; using in-process core.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Could not reach ${url} (${message}); using in-process core.`);
    }
  }
  return createInProcessClient();
}

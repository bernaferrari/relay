/**
 * Minimal HTTP API over @grok-device/core for desktop/app clients.
 * Node built-in `node:http` only — no framework required.
 */
import http from "node:http";
import { URL } from "node:url";
import {
  ACTIONS,
  PLATFORM,
  createDevice,
  isActionId,
  runAction,
  type ActionId,
  type RunActionResult,
} from "@grok-device/core";

export type StartServerOptions = {
  port?: number;
  host?: string;
};

export type StartedServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

type RunBody = {
  serial?: string;
  skipAccountSwitch?: boolean;
  skipRestoreHome?: boolean;
  prodAccountMatch?: string;
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function listDevicesJson() {
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
}

async function handleRunAction(actionId: string, body: RunBody): Promise<RunActionResult> {
  if (!isActionId(actionId)) {
    throw new HttpError(404, `Unknown action: ${actionId}`);
  }

  const serial = body.serial?.trim();
  if (serial) {
    process.env.AGENT_DEVICE_SERIAL = serial;
    process.env.ANDROID_SERIAL = serial;
  }

  if (body.prodAccountMatch?.trim()) {
    process.env.PROD_ACCOUNT_MATCH = body.prodAccountMatch.trim();
  }

  const device = createDevice();
  return runAction(device, actionId as ActionId, {
    skipAccountSwitch: body.skipAccountSwitch,
    skipRestoreHome: body.skipRestoreHome,
  });
}

function matchPath(pathname: string, pattern: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const ap = pathname.split("/").filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const p = pp[i]!;
    const a = ap[i]!;
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(a);
    } else if (p !== a) {
      return null;
    }
  }
  return params;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  try {
    if (method === "GET" && pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/actions") {
      json(res, 200, { actions: ACTIONS });
      return;
    }

    if (method === "GET" && pathname === "/devices") {
      const devices = await listDevicesJson();
      json(res, 200, { devices });
      return;
    }

    const runMatch = matchPath(pathname, "/actions/:id/run");
    if (method === "POST" && runMatch) {
      const body = (await parseJsonBody(req)) as RunBody;
      if (body && typeof body !== "object") {
        throw new HttpError(400, "Body must be a JSON object");
      }
      const result = await handleRunAction(runMatch.id!, body ?? {});
      // runAction always resolves to RunActionResult (ok true|false)
      json(res, 200, result);
      return;
    }

    json(res, 404, { error: `Not found: ${method} ${pathname}` });
  } catch (err) {
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: message });
  }
}

export async function startServer(opts: StartServerOptions = {}): Promise<StartedServer> {
  const host = opts.host ?? "127.0.0.1";
  const preferredPort = opts.port ?? 8787;

  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(preferredPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : preferredPort;

  return {
    port,
    host,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** CLI entry when run as `tsx packages/server/src/index.ts` */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const portIdx = argv.indexOf("--port");
  const hostIdx = argv.indexOf("--host");
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8787;
  const host = hostIdx >= 0 ? (argv[hostIdx + 1] ?? "127.0.0.1") : "127.0.0.1";

  const started = await startServer({ port, host });
  console.log(`@grok-device/server listening on http://${started.host}:${started.port}`);
}

const invokedDirectly =
  process.argv[1]?.endsWith("/server/src/index.ts") ||
  process.argv[1]?.endsWith("\\server\\src\\index.ts") ||
  process.argv[1]?.includes("@grok-device/server");

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

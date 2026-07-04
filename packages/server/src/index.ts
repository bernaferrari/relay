/**
 * HTTP + SSE API over @grok-device/core.
 * OpenCode-style: long-lived server, UI clients subscribe to events.
 */
import http from "node:http";
import { URL } from "node:url";
import {
  ACTIONS,
  captureScreenshot,
  captureSnapshot,
  enqueueJob,
  formatSnapshotTree,
  getActiveJob,
  getJob,
  interact,
  listDevices,
  listJobs,
  now,
  publish,
  recentEvents,
  selectDevice,
  subscribe,
  type DeviceEvent,
  type InteractInput,
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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...CORS_HEADERS,
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

function matchPath(pathname: string, pattern: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const ap = pathname.split("/").filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const p = pp[i]!;
    const a = ap[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(a);
    else if (p !== a) return null;
  }
  return params;
}

type SseClient = { res: http.ServerResponse; id: number };
const sseClients = new Set<SseClient>();
let sseSeq = 0;

function writeSse(res: http.ServerResponse, event: DeviceEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcast(event: DeviceEvent): void {
  for (const client of sseClients) {
    try {
      writeSse(client.res, event);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Bridge core bus → SSE
subscribe((event) => broadcast(event));

function attachSse(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    ...CORS_HEADERS,
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, at: now() })}\n\n`);
  // replay recent
  for (const ev of recentEvents(30)) writeSse(res, ev);

  const client: SseClient = { res, id: ++sseSeq };
  sseClients.add(client);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 15_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
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
      json(res, 200, {
        ok: true,
        product: "grok-device",
        mode: "app-testing",
        at: now(),
        activeJob: getActiveJob()?.id ?? null,
        jobs: listJobs(5).length,
        sseClients: sseClients.size,
      });
      return;
    }

    if (method === "GET" && pathname === "/events") {
      attachSse(req, res);
      return;
    }

    if (method === "GET" && pathname === "/actions") {
      json(res, 200, { actions: ACTIONS });
      return;
    }

    if (method === "GET" && pathname === "/devices") {
      const devices = await listDevices();
      json(res, 200, { devices });
      return;
    }

    if (method === "POST" && pathname === "/device/select") {
      const body = (await parseJsonBody(req)) as { serial?: string | null };
      selectDevice(body.serial ?? null);
      json(res, 200, { ok: true, serial: body.serial ?? null });
      return;
    }

    if (method === "GET" && pathname === "/jobs") {
      const limit = Number(url.searchParams.get("limit") ?? 50);
      json(res, 200, { jobs: listJobs(limit), active: getActiveJob() });
      return;
    }

    const jobMatch = matchPath(pathname, "/jobs/:id");
    if (method === "GET" && jobMatch) {
      const job = getJob(jobMatch.id!);
      if (!job) throw new HttpError(404, "Job not found");
      json(res, 200, { job });
      return;
    }

    if (method === "POST" && pathname === "/jobs") {
      const body = (await parseJsonBody(req)) as {
        action?: string;
        serial?: string;
        skipAccountSwitch?: boolean;
        skipRestoreHome?: boolean;
        prodAccountMatch?: string;
      };
      if (!body.action) throw new HttpError(400, "action is required");
      const job = enqueueJob({
        action: body.action,
        serial: body.serial,
        skipAccountSwitch: body.skipAccountSwitch,
        skipRestoreHome: body.skipRestoreHome,
        prodAccountMatch: body.prodAccountMatch,
      });
      json(res, 202, { job });
      return;
    }

    // Back-compat: sync-style run (still async job under the hood, wait optional)
    const runMatch = matchPath(pathname, "/actions/:id/run");
    if (method === "POST" && runMatch) {
      const body = (await parseJsonBody(req)) as {
        serial?: string;
        skipAccountSwitch?: boolean;
        skipRestoreHome?: boolean;
        prodAccountMatch?: string;
        wait?: boolean;
      };
      const job = enqueueJob({
        action: runMatch.id!,
        serial: body.serial,
        skipAccountSwitch: body.skipAccountSwitch,
        skipRestoreHome: body.skipRestoreHome,
        prodAccountMatch: body.prodAccountMatch,
      });
      if (body.wait === false) {
        json(res, 202, { job });
        return;
      }
      // wait for completion
      for (;;) {
        const current = getJob(job.id)!;
        if (current.status === "ok" || current.status === "error") {
          json(res, 200, {
            ok: current.status === "ok",
            action: current.action,
            result: current.result,
            error: current.error,
            job: current,
            logs: current.logs,
          });
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    if (method === "GET" && pathname === "/snapshot") {
      const serial = url.searchParams.get("serial") ?? undefined;
      const interactiveOnly = url.searchParams.get("interactiveOnly") === "1";
      const snap = await captureSnapshot({ serial, interactiveOnly });
      const tree = formatSnapshotTree(snap.nodes);
      json(res, 200, { ...snap, tree });
      return;
    }

    if (method === "GET" && pathname === "/screenshot") {
      const serial = url.searchParams.get("serial") ?? undefined;
      const shot = await captureScreenshot({ serial });
      json(res, 200, shot);
      return;
    }

    if (method === "POST" && pathname === "/interact") {
      const body = (await parseJsonBody(req)) as InteractInput & { serial?: string };
      if (!body || typeof body !== "object" || !("kind" in body)) {
        throw new HttpError(400, "body.kind required (label|point|ref|find|text-match)");
      }
      const { serial, ...input } = body;
      await interact(input as InteractInput, { serial });
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/meta") {
      json(res, 200, {
        name: "grok-device",
        description: "App testing shell for Grok Android (agent-device)",
        endpoints: [
          "GET /health",
          "GET /events (SSE)",
          "GET /actions",
          "GET /devices",
          "POST /device/select",
          "GET /jobs",
          "GET /jobs/:id",
          "POST /jobs",
          "POST /actions/:id/run",
          "GET /snapshot",
          "GET /screenshot",
          "POST /interact",
        ],
      });
      return;
    }

    json(res, 404, { error: `Not found: ${method} ${pathname}` });
  } catch (err) {
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    publish({ type: "error", at: now(), message, where: "server" });
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
  publish({ type: "server.ready", at: now(), host, port });

  return {
    port,
    host,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const c of sseClients) {
          try {
            c.res.end();
          } catch {
            /* ignore */
          }
        }
        sseClients.clear();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const portIdx = argv.indexOf("--port");
  const hostIdx = argv.indexOf("--host");
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8787;
  const host = hostIdx >= 0 ? (argv[hostIdx + 1] ?? "127.0.0.1") : "127.0.0.1";
  const started = await startServer({ port, host });
  console.log(`@grok-device/server listening on http://${started.host}:${started.port}`);
  console.log("  SSE  GET /events");
  console.log("  jobs POST /jobs  GET /jobs");
  console.log("  live GET /snapshot  GET /screenshot  POST /interact");
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

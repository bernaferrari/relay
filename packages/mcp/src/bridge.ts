#!/usr/bin/env node
import { randomUUID, timingSafeEqual } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRpcMessage = Record<string, unknown> & { id?: string | number | null };

export type RelayMcpBridgeConfig = {
  host: string;
  port: number;
  path: string;
  authEnv: string | "none";
  allowUnauthenticated: boolean;
  requestTimeoutMs: number;
  maxBodyBytes: number;
  maxSessions: number;
  idleTimeoutMs: number;
  serverPath: string;
};

type Environment = Record<string, string | undefined>;

const DEFAULTS = {
  host: "127.0.0.1",
  port: "8788",
  path: "/mcp",
  authEnv: "RELAY_MCP_BRIDGE_AUTH_TOKEN",
  requestTimeoutMs: "180000",
  maxBodyBytes: "10485760",
  maxSessions: "32",
  idleTimeoutMs: "900000",
} as const;

const VALUE_FLAGS = new Set([
  "--host",
  "--port",
  "--path",
  "--auth-env",
  "--request-timeout",
  "--max-body-bytes",
  "--max-sessions",
  "--idle-timeout",
]);

function parseArguments(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    const equals = token.indexOf("=");
    const name = equals >= 0 ? token.slice(0, equals) : token;
    if (token === "--allow-unauthenticated") {
      values.set(token, "true");
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new TypeError(`Unknown option: ${name}`);
    const value = equals >= 0 ? token.slice(equals + 1) : argv[++index];
    if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value`);
    values.set(name, value);
  }
  return values;
}

function choose(cli: string | undefined, env: string | undefined, fallback: string): string {
  return cli ?? (env?.trim() || fallback);
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return parsed;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function resolveServerPath(environment: Environment = process.env): string {
  const explicit = environment.RELAY_MCP_BRIDGE_SERVER?.trim();
  if (explicit) return explicit;
  return join(dirname(fileURLToPath(import.meta.url)), "relay-mcp.js");
}

export function parseRelayMcpBridgeConfig(
  argv: readonly string[] = [],
  env: Environment = process.env,
): RelayMcpBridgeConfig {
  const values = parseArguments(argv);
  const host = choose(values.get("--host"), env.RELAY_MCP_BRIDGE_HOST, DEFAULTS.host);
  const authEnv = choose(values.get("--auth-env"), env.RELAY_MCP_BRIDGE_AUTH_ENV, DEFAULTS.authEnv);
  if (authEnv !== "none" && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(authEnv)) {
    throw new TypeError("--auth-env must be an environment variable name or 'none'");
  }
  const allowUnauthenticated =
    values.has("--allow-unauthenticated") || env.RELAY_MCP_BRIDGE_ALLOW_UNAUTHENTICATED === "1";
  if (authEnv === "none" && !isLoopbackHost(host) && !allowUnauthenticated) {
    throw new TypeError(
      "Unauthenticated bridge access is only allowed on loopback; set an auth environment variable",
    );
  }
  const path = choose(values.get("--path"), env.RELAY_MCP_BRIDGE_PATH, DEFAULTS.path);
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new TypeError("--path must be an absolute URL path without a query or fragment");
  }
  return Object.freeze({
    host,
    port: positiveInteger(
      choose(values.get("--port"), env.RELAY_MCP_BRIDGE_PORT, DEFAULTS.port),
      "--port",
    ),
    path,
    authEnv,
    allowUnauthenticated,
    requestTimeoutMs: positiveInteger(
      choose(
        values.get("--request-timeout"),
        env.RELAY_MCP_BRIDGE_REQUEST_TIMEOUT_MS,
        DEFAULTS.requestTimeoutMs,
      ),
      "--request-timeout",
    ),
    maxBodyBytes: positiveInteger(
      choose(
        values.get("--max-body-bytes"),
        env.RELAY_MCP_BRIDGE_MAX_BODY_BYTES,
        DEFAULTS.maxBodyBytes,
      ),
      "--max-body-bytes",
    ),
    maxSessions: positiveInteger(
      choose(values.get("--max-sessions"), env.RELAY_MCP_BRIDGE_MAX_SESSIONS, DEFAULTS.maxSessions),
      "--max-sessions",
    ),
    idleTimeoutMs: positiveInteger(
      choose(
        values.get("--idle-timeout"),
        env.RELAY_MCP_BRIDGE_IDLE_TIMEOUT_MS,
        DEFAULTS.idleTimeoutMs,
      ),
      "--idle-timeout",
    ),
    serverPath: resolveServerPath(env),
  });
}

function idKey(id: string | number | null | undefined): string | undefined {
  return id === undefined || id === null ? undefined : `${typeof id}:${String(id)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestId(message: JsonRpcMessage): string | number | null | undefined {
  return message.id;
}

type PendingResponse = {
  resolve: (message: JsonRpcMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type SessionListener = (message: JsonRpcMessage) => void;

/**
 * A deliberately small stdio client. Relay MCP keeps the canonical MCP
 * server and schemas in the child process; this class only carries newline
 * framed JSON-RPC messages across the HTTP/stdio boundary.
 */
class RelayMcpStdioSession {
  readonly id = randomUUID();
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingResponse>();
  private readonly listeners = new Set<SessionListener>();
  private stdoutBuffer = "";
  private closed = false;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(
    readonly config: RelayMcpBridgeConfig,
    environment: Environment,
    onClose: () => void,
  ) {
    const childEnvironment = {
      ...process.env,
      ...environment,
      RELAY_MCP_PROFILE: environment.RELAY_MCP_PROFILE?.trim() || "qa",
    };
    this.child = spawn(process.execPath, [config.serverPath], {
      env: childEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk: Buffer | string) => this.onStdout(String(chunk)));
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      // Relay diagnostics are useful to an operator, but never copy an HTTP
      // request or credential into this out-of-band log.
      const diagnostic = String(chunk).trim();
      if (diagnostic)
        process.stderr.write(`relay-mcp-bridge child: ${diagnostic.slice(0, 2_048)}\n`);
    });
    this.child.once("error", (error) =>
      this.close(error instanceof Error ? error : new Error(String(error))),
    );
    this.child.once("exit", (code, signal) => {
      if (!this.closed) {
        this.close(
          new Error(
            `relay-mcp exited before responding (${signal ?? `code ${code ?? "unknown"}`})`,
          ),
        );
      }
      onClose();
    });
    this.touch();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  onMessage(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(message: JsonRpcMessage): Promise<JsonRpcMessage | undefined> {
    this.touch();
    const key = idKey(requestId(message));
    if (!key) {
      this.write(message);
      return Promise.resolve(undefined);
    }
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error("Relay MCP request timed out"));
      }, this.config.requestTimeoutMs);
      this.pending.set(key, { resolve, reject, timer });
      try {
        this.write(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(reason?: Error): void {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason ?? new Error("Relay MCP session closed"));
    }
    this.pending.clear();
    this.listeners.clear();
    if (!this.child.killed) this.child.kill();
  }

  private write(message: JsonRpcMessage): void {
    if (this.closed) throw new Error("Relay MCP session is closed");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/u, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(message)) continue;
      const jsonRpc = message as JsonRpcMessage;
      const pending = this.pending.get(idKey(requestId(jsonRpc)) ?? "");
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(idKey(requestId(jsonRpc))!);
        pending.resolve(jsonRpc);
      } else {
        for (const listener of this.listeners) listener(jsonRpc);
      }
    }
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.close(new Error("Relay MCP session expired")),
      this.config.idleTimeoutMs,
    );
  }
}

type SessionStore = Map<string, RelayMcpStdioSession>;

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...extra,
  });
  response.end(payload);
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message });
}

function acceptsEventStream(request: IncomingMessage): boolean {
  return (
    header(request, "accept")
      ?.split(",")
      .some((value) => value.trim().startsWith("text/event-stream")) === true
  );
}

function writeSse(response: ServerResponse, message: JsonRpcMessage): void {
  response.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

async function requestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const declaredLength = Number(header(request, "content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`request body exceeds ${maxBytes} bytes`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function authorized(
  request: IncomingMessage,
  config: RelayMcpBridgeConfig,
  environment: Environment,
): boolean {
  if (config.authEnv === "none") return config.allowUnauthenticated || isLoopbackHost(config.host);
  const expected = environment[config.authEnv];
  const supplied = header(request, "authorization");
  if (!expected || !supplied?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(supplied.slice("Bearer ".length));
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export type RelayMcpBridge = {
  server: Server;
  close: () => Promise<void>;
};

export async function createRelayMcpBridge(
  config: RelayMcpBridgeConfig,
  environment: Environment = process.env,
): Promise<RelayMcpBridge> {
  if (config.authEnv !== "none" && !environment[config.authEnv]?.trim()) {
    throw new Error(`Bridge authentication environment variable ${config.authEnv} is not set`);
  }
  try {
    await access(config.serverPath, constants.R_OK);
  } catch {
    throw new Error(
      `Relay MCP executable is missing at ${config.serverPath}; run the package build first`,
    );
  }

  const sessions: SessionStore = new Map();
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (requestUrl.pathname !== config.path) {
      sendError(response, 404, "MCP endpoint not found");
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        Allow: "OPTIONS, GET, POST, DELETE",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      });
      response.end();
      return;
    }
    if (!authorized(request, config, environment)) {
      sendJson(response, 401, { error: "Unauthorized" }, { "WWW-Authenticate": "Bearer" });
      return;
    }
    void handleHttpRequest(request, response, config, environment, sessions).catch(
      (error: unknown) => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        sendError(response, 400, error instanceof Error ? error.message : String(error));
      },
    );
  });

  const close = async (): Promise<void> => {
    for (const session of sessions.values()) session.close();
    sessions.clear();
    await new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };
  return { server, close };
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: RelayMcpBridgeConfig,
  environment: Environment,
  sessions: SessionStore,
): Promise<void> {
  const sessionId = header(request, "mcp-session-id");
  if (request.method === "DELETE") {
    if (!sessionId) {
      sendError(response, 400, "MCP-Session-Id is required");
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      sendError(response, 404, "MCP session not found");
      return;
    }
    session.close();
    sessions.delete(sessionId);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET") {
    if (!sessionId) {
      sendError(response, 400, "MCP-Session-Id is required");
      return;
    }
    const session = sessions.get(sessionId);
    if (!session || session.isClosed) {
      sendError(response, 404, "MCP session not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "MCP-Session-Id": session.id,
    });
    const removeListener = session.onMessage((message) => writeSse(response, message));
    request.once("close", () => removeListener());
    response.once("close", () => removeListener());
    return;
  }

  if (request.method !== "POST") {
    sendJson(
      response,
      405,
      { error: "Method not allowed" },
      { Allow: "OPTIONS, GET, POST, DELETE" },
    );
    return;
  }
  const contentType = header(request, "content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    sendError(response, 415, "MCP POST requests must use application/json");
    return;
  }
  const parsed: unknown = JSON.parse(await requestBody(request, config.maxBodyBytes));
  if (!isRecord(parsed)) {
    sendError(response, 400, "MCP request body must be one JSON-RPC object");
    return;
  }
  const message = parsed as JsonRpcMessage;
  if (typeof message.method !== "string") {
    sendError(response, 400, "MCP request method is required");
    return;
  }

  let session: RelayMcpStdioSession | undefined;
  if (sessionId) {
    session = sessions.get(sessionId);
    if (!session || session.isClosed) {
      sendError(response, 404, "MCP session not found");
      return;
    }
    if (message.method === "initialize") {
      sendError(response, 400, "MCP session is already initialized");
      return;
    }
  } else {
    if (message.method !== "initialize") {
      sendError(response, 400, "The first MCP request must be initialize");
      return;
    }
    if (sessions.size >= config.maxSessions) {
      sendError(response, 429, "MCP bridge session limit reached");
      return;
    }
    session = new RelayMcpStdioSession(config, environment, () => {
      if (session) sessions.delete(session.id);
    });
  }

  try {
    const result = await session.request(message);
    if (!result) {
      response.writeHead(202, { "MCP-Session-Id": session.id });
      response.end();
      return;
    }
    if (message.method === "initialize") sessions.set(session.id, session);
    const headers = { "MCP-Session-Id": session.id };
    if (acceptsEventStream(request)) {
      response.writeHead(200, {
        ...headers,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      writeSse(response, result);
      response.end();
    } else {
      sendJson(response, 200, result, headers);
    }
  } catch (error) {
    if (!sessionId) session.close(error instanceof Error ? error : new Error(String(error)));
    sendError(response, 504, error instanceof Error ? error.message : String(error));
  }
}

export async function runRelayMcpBridge(
  argv: readonly string[] = process.argv.slice(2),
  env: Environment = process.env,
): Promise<void> {
  const config = parseRelayMcpBridgeConfig(argv, env);
  const bridge = await createRelayMcpBridge(config, env);
  await new Promise<void>((resolve, reject) => {
    bridge.server.once("error", reject);
    bridge.server.listen(config.port, config.host, () => {
      process.stderr.write(
        `relay-mcp-bridge listening on http://${config.host}:${config.port}${config.path}\n`,
      );
      resolve();
    });
  });
  const stop = (): void => {
    void bridge.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const isEntryPoint =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  runRelayMcpBridge().catch((error: unknown) => {
    process.stderr.write(
      `relay-mcp-bridge: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

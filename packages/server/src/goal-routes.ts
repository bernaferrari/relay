import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type http from "node:http";
import { RelayClient } from "@relay/client";
import { findWorkspaceRoot } from "@relay/core";
import type {
  GoalExplorationRecord,
  GoalExplorationResult,
  GoalExplorationStartInput,
  GoalSessionRecord,
  GoalSessionResult,
  GoalSessionStartInput,
} from "@relay/protocol";
import {
  createGoalExplorationRunner,
  createGoalPromotionRunner,
  createGoalSessionRunner,
  createRelayOperationPort,
  type GoalPromotionRunner,
  type GoalSessionRunner,
} from "@relay/workflows";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { resolveCommandActor, type RequestContext } from "./security.js";

type GoalRouteContext = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime?: Partial<GoalRouteRuntime>;
};

export type GoalRouteRuntime = {
  start(input: GoalSessionStartInput): Promise<GoalSessionResult>;
  resume(sessionId: string): Promise<GoalSessionResult>;
  inspect(sessionId: string): Promise<GoalSessionRecord>;
  reproduce(sessionId: string): Promise<GoalSessionResult>;
  promote: GoalPromotionRunner["promote"];
  explore(input: GoalExplorationStartInput): Promise<GoalExplorationResult>;
  resumeExploration(explorationId: string): Promise<GoalExplorationResult>;
  inspectExploration(explorationId: string): Promise<GoalExplorationRecord>;
};

export type GoalRouteRuntimeFactory = (input: {
  request: http.IncomingMessage;
  scope: RequestContext;
}) => Partial<GoalRouteRuntime>;

export function dispatchGoalRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  method: string,
  pathname: string,
  scope: RequestContext,
  runtimeFactory?: GoalRouteRuntimeFactory,
): Promise<boolean> {
  const isGoalPath =
    pathname === "/goal" ||
    pathname === "/explore" ||
    pathname.startsWith("/goal/") ||
    pathname.startsWith("/explore/");
  if (!isGoalPath) return Promise.resolve(false);
  return handleGoalRoute({
    method,
    pathname,
    request,
    response,
    scope,
    ...(runtimeFactory ? { runtime: runtimeFactory({ request, scope }) } : {}),
  });
}

type StoredRecord = { id: string };

function scopedStateRoot(scope: RequestContext): string {
  const state = process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
  const scopeKey = createHash("sha256")
    .update(`${scope.organizationId}\0${scope.projectId}\0${scope.subject}`)
    .digest("hex");
  return join(state, "goal-sessions", scopeKey);
}

function assertStoredRecord(value: unknown, expectedId: string): asserts value is StoredRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored goal evidence is not an object.");
  }
  const record = value as Partial<StoredRecord>;
  if (record.id !== expectedId) throw new TypeError("Stored goal evidence has the wrong id.");
}

function fileStore<T extends StoredRecord>(directory: string) {
  return {
    async load(id: string): Promise<T | null> {
      try {
        const value: unknown = JSON.parse(await readFile(join(directory, `${id}.json`), "utf8"));
        assertStoredRecord(value, id);
        return value as T;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(record: T): Promise<void> {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = join(directory, `.${record.id}.${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, join(directory, `${record.id}.json`));
    },
  };
}

function bearerToken(request: http.IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return value?.startsWith("Bearer ")
    ? value.slice("Bearer ".length).trim() || undefined
    : undefined;
}

function inputFromBody(body: Record<string, unknown>): GoalSessionStartInput {
  const input: GoalSessionStartInput = {
    goal: typeof body.goal === "string" ? body.goal : "",
  };
  for (const key of [
    "startUrl",
    "targetId",
    "laneId",
    "authenticationFixtureReference",
    "model",
  ] as const) {
    if (typeof body[key] === "string") input[key] = body[key];
  }
  if (body.signedOut === true) input.signedOut = true;
  if (Number.isInteger(body.maxSteps)) input.maxSteps = body.maxSteps as number;
  if (Number.isInteger(body.maxDurationMs)) input.maxDurationMs = body.maxDurationMs as number;
  return input;
}

function requireControlConfirmation(body: Record<string, unknown>): void {
  if (body.confirmControl !== true) {
    throw new HttpError(403, "Goal control requires explicit confirmation.", {
      code: "GOAL_CONTROL_CONFIRMATION_REQUIRED",
      recovery: "Review the goal, target, and bounded budget, then confirm control explicitly.",
    });
  }
}

function runtimeFor(context: GoalRouteContext): GoalRouteRuntime {
  const runtime = context.runtime;
  if (!runtime) throw new HttpError(503, "Goal runtime is not configured on this Relay host.");
  return runtime as GoalRouteRuntime;
}

function goalNotFound(error: unknown): unknown {
  if (error instanceof TypeError && / was not found\.$/u.test(error.message)) {
    return new HttpError(404, error.message);
  }
  return error;
}

async function inspectSession(runtime: GoalRouteRuntime, id: string): Promise<GoalSessionRecord> {
  try {
    return await runtime.inspect(id);
  } catch (error) {
    throw goalNotFound(error);
  }
}

async function inspectExploration(
  runtime: GoalRouteRuntime,
  id: string,
): Promise<GoalExplorationRecord> {
  try {
    return await runtime.inspectExploration(id);
  } catch (error) {
    throw goalNotFound(error);
  }
}

export async function handleGoalRoute(context: GoalRouteContext): Promise<boolean> {
  const { method, pathname, request, response, scope } = context;
  const isGoalPath =
    pathname === "/goal" ||
    pathname === "/explore" ||
    pathname.startsWith("/goal/") ||
    pathname.startsWith("/explore/");
  if (!isGoalPath) return false;
  const runtime = runtimeFor(context);

  if (method === "POST" && pathname === "/goal") {
    const body = (await parseJsonBody(request)) as Record<string, unknown>;
    requireControlConfirmation(body);
    const result = await runtime.start(inputFromBody(body));
    json(response, 200, result);
    return true;
  }

  if (method === "POST" && pathname === "/explore") {
    const body = (await parseJsonBody(request)) as Record<string, unknown>;
    requireControlConfirmation(body);
    const input = inputFromBody(body) as GoalExplorationStartInput;
    if (Number.isInteger(body.agents)) input.agents = body.agents as number;
    const result = await runtime.explore(input);
    json(response, 200, result);
    return true;
  }

  if (method === "GET") {
    const sessionMatch = matchPath(pathname, "/goal/:id");
    if (sessionMatch) {
      json(response, 200, await inspectSession(runtime, sessionMatch.id!));
      return true;
    }
    const explorationMatch = matchPath(pathname, "/explore/:id");
    if (explorationMatch) {
      json(response, 200, await inspectExploration(runtime, explorationMatch.id!));
      return true;
    }
  }

  const sessionResume = matchPath(pathname, "/goal/:id/resume");
  if (method === "POST" && sessionResume) {
    const body = (await parseJsonBody(request)) as Record<string, unknown>;
    requireControlConfirmation(body);
    json(response, 200, await runtime.resume(sessionResume.id!));
    return true;
  }

  const sessionReproduce = matchPath(pathname, "/goal/:id/reproduce");
  if (method === "POST" && sessionReproduce) {
    const body = (await parseJsonBody(request)) as Record<string, unknown>;
    requireControlConfirmation(body);
    json(response, 200, await runtime.reproduce(sessionReproduce.id!));
    return true;
  }

  const sessionPromote = matchPath(pathname, "/goal/:id/promote");
  if (method === "POST" && sessionPromote) {
    const body = (await parseJsonBody(request)) as Record<string, unknown>;
    requireControlConfirmation(body);
    json(
      response,
      200,
      await runtime.promote({
        sessionId: sessionPromote.id!,
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.appMapId === "string" ? { appMapId: body.appMapId } : {}),
        confirmControl: true,
      }),
    );
    return true;
  }

  const explorationResume = matchPath(pathname, "/explore/:id/resume");
  if (method === "POST" && explorationResume) {
    const body = (await parseJsonBody(request)) as Record<string, unknown>;
    requireControlConfirmation(body);
    json(response, 200, await runtime.resumeExploration(explorationResume.id!));
    return true;
  }

  return false;
}

export function createGoalRouteRuntimeFactory(options: {
  baseUrl: () => string;
  staticToken?: string;
}): GoalRouteRuntimeFactory {
  const cache = new Map<string, GoalRouteRuntime>();
  return ({ request, scope }) => {
    const actor = resolveCommandActor(request.headers, scope);
    const token = options.staticToken ?? bearerToken(request);
    const cacheKey = `${scope.organizationId}\0${scope.projectId}\0${actor.actorId}\0${token ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const client = new RelayClient(
      {
        url: options.baseUrl(),
        auth: token ? { type: "bearer", token } : { type: "none" },
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        actorId: actor.actorId,
        actorKind: actor.actorKind,
      },
      { timeoutMs: 180_000 },
    );
    const operations = createRelayOperationPort(client);
    const sessions = createGoalSessionRunner({
      operations,
      store: fileStore<GoalSessionRecord>(join(scopedStateRoot(scope), "sessions")),
    });
    const explorations = createGoalExplorationRunner({
      sessions,
      store: fileStore<GoalExplorationRecord>(join(scopedStateRoot(scope), "explorations")),
    });
    const promotions = createGoalPromotionRunner({
      operations,
      sessions,
      actorId: actor.actorId,
    });
    const runtime: GoalRouteRuntime = {
      start: (input) => sessions.start(input),
      resume: (id) => sessions.resume(id),
      inspect: (id) => sessions.inspect(id),
      reproduce: (id) => sessions.reproduce(id),
      promote: (input) => promotions.promote(input),
      explore: (input) => explorations.start(input),
      resumeExploration: (id) => explorations.resume(id),
      inspectExploration: (id) => explorations.inspect(id),
    };
    cache.set(cacheKey, runtime);
    return runtime;
  };
}

export function createGoalRouteRuntimeBinding(options: {
  port: number;
  staticToken?: string;
  runtime?: Partial<GoalRouteRuntime>;
}): { factory: GoalRouteRuntimeFactory; setPort: (port: number) => void } {
  let boundPort = options.port;
  const defaults = createGoalRouteRuntimeFactory({
    baseUrl: () => `http://127.0.0.1:${boundPort}`,
    ...(options.staticToken ? { staticToken: options.staticToken } : {}),
  });
  return {
    factory: (input) => ({ ...defaults(input), ...(options.runtime ?? {}) }),
    setPort: (port) => {
      boundPort = port;
    },
  };
}

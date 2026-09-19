import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type http from "node:http";
import { RelayClient } from "@relay/client";
import {
  createDurableWorkflow,
  findWorkspaceRoot,
  readDurableWorkflow,
  transitionDurableWorkflow,
} from "@relay/core";
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
  start(input: GoalSessionStartInput, call?: { signal?: AbortSignal }): Promise<GoalSessionResult>;
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

type InFlightGoalSession = {
  controller: AbortController;
  done: Promise<GoalSessionResult>;
  workflowId: string;
  organizationId: string;
  projectId: string;
};

/** Server-owned goal executions. Keyed by session id; process-global so any
 * authenticated client can cancel the exact job another client started. */
const inFlightGoalSessions = new Map<string, InFlightGoalSession>();

const GOAL_WORKFLOW_LIFETIME_MS = 24 * 60 * 60 * 1_000;

function goalWorkflowId(sessionId: string): string {
  return `goal-session:${sessionId}`;
}

async function registerGoalWorkflow(input: {
  scope: RequestContext;
  actorId: string;
  sessionId: string;
  goal: string;
}): Promise<string> {
  const workflowId = goalWorkflowId(input.sessionId);
  const now = Date.now();
  const outcome = await createDurableWorkflow({
    organizationId: input.scope.organizationId,
    projectId: input.scope.projectId,
    workflowId,
    kind: "goal-session",
    resource: { kind: "goal-session", id: input.sessionId },
    frozenIdentity: { sessionId: input.sessionId, goal: input.goal },
    actorId: input.actorId,
    at: now,
    expiresAt: now + GOAL_WORKFLOW_LIFETIME_MS,
    transition: "goal-started",
  });
  if (outcome.status === "conflict") {
    throw new HttpError(409, "A different goal session already exists with this id.");
  }
  // "exists" is the idempotent repeated-start case: the same request identity
  // never overwrites the existing task.
  return workflowId;
}

async function finishGoalWorkflow(input: {
  scope: RequestContext;
  actorId: string;
  workflowId: string;
  sessionId: string;
  status: GoalSessionResult["status"];
}): Promise<void> {
  const read = await readDurableWorkflow({
    organizationId: input.scope.organizationId,
    projectId: input.scope.projectId,
    workflowId: input.workflowId,
  });
  if (!read) return;
  if (read.record.status === "terminal" || read.record.status === "expired") return;
  await transitionDurableWorkflow({
    organizationId: input.scope.organizationId,
    projectId: input.scope.projectId,
    workflowId: input.workflowId,
    expectedVersion: read.record.version,
    actorId: input.actorId,
    transition: `goal-finished:${input.status}`,
    // Uncertain executions require human review; everything else is terminal.
    status: input.status === "uncertain" ? "needs-attention" : "terminal",
    at: Date.now(),
  }).catch(() => undefined);
}

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
  if (
    typeof body.sessionId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(body.sessionId)
  ) {
    input.sessionId = body.sessionId;
  }
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
    const input = inputFromBody(body);
    const sessionId = input.sessionId ?? `goal-${randomUUID()}`;
    const actor = resolveCommandActor(request.headers, scope);
    const workflowId = await registerGoalWorkflow({
      scope,
      actorId: actor.actorId,
      sessionId,
      goal: input.goal,
    });
    const controller = new AbortController();
    const done = runtime
      .start({ ...input, sessionId }, { signal: controller.signal })
      .catch(async (error: unknown) => {
        // The runner resolves with terminal records; a thrown error here means
        // orchestration itself failed. Fence the workflow and rethrow.
        await finishGoalWorkflow({
          scope,
          actorId: actor.actorId,
          workflowId,
          sessionId,
          status: "blocked",
        });
        throw error;
      });
    const entry: InFlightGoalSession = {
      controller,
      done,
      workflowId,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
    };
    inFlightGoalSessions.set(sessionId, entry);
    void done.then(
      async (result) => {
        inFlightGoalSessions.delete(sessionId);
        await finishGoalWorkflow({
          scope,
          actorId: actor.actorId,
          workflowId,
          sessionId,
          status: result.status,
        });
      },
      () => {
        inFlightGoalSessions.delete(sessionId);
      },
    );
    // The execution is owned by this server process. Awaiting it here only
    // serves this response; the client disconnecting never cancels the job.
    json(response, 200, await done);
    return true;
  }

  const sessionCancel = matchPath(pathname, "/goal/:id/cancel");
  if (method === "POST" && sessionCancel) {
    const body = (await parseJsonBody(request)) as Record<string, unknown>;
    requireControlConfirmation(body);
    const entry = inFlightGoalSessions.get(sessionCancel.id!);
    if (!entry) {
      const stored = await inspectSession(runtime, sessionCancel.id!).catch(() => null);
      if (stored?.status === "running") {
        throw new HttpError(
          409,
          "This goal session is recorded as running but is not executing in this server process (for example after a restart). Inspect it and resume or fence it explicitly; cancel cannot be applied blindly.",
        );
      }
      throw new HttpError(404, `Goal session ${sessionCancel.id!} is not running.`);
    }
    entry.controller.abort();
    const result = await entry.done;
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
      const record = await inspectSession(runtime, sessionMatch.id!);
      const workflow = await readDurableWorkflow({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        workflowId: goalWorkflowId(sessionMatch.id!),
      }).catch(() => null);
      json(response, 200, {
        ...record,
        ...(workflow
          ? {
              workflow: {
                workflowId: workflow.record.workflowId,
                version: workflow.record.version,
                status: workflow.record.status,
                kind: workflow.record.kind,
              },
            }
          : {}),
      });
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
      start: (input, call) => sessions.start(input, call),
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

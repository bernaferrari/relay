import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { IosMutationOutcomeUnknownError } from "@relay/core";
import type { DiscoverySession } from "@relay/protocol";
import { discoveryInteractionHttpError, handleDiscoveryRoute } from "./discovery-routes.js";
import { HttpError } from "./http.js";
import { startServer } from "./index.js";
import type { RequestContext } from "./security.js";

class CapturedResponse {
  status = 0;
  headers: Record<string, unknown> = {};
  body = "";

  writeHead(status: number, headers: Record<string, unknown>): this {
    this.status = status;
    this.headers = headers;
    return this;
  }

  end(chunk?: string | Buffer): this {
    this.body += chunk?.toString() ?? "";
    return this;
  }
}

function scopeFor(projectId: string, localTrusted: boolean): RequestContext {
  return {
    subject: localTrusted ? "local-user" : `service:${projectId}`,
    organizationId: "acme",
    projectId,
    allowedProjects: [projectId],
    tokenKind: localTrusted ? "local" : "service",
    localTrusted,
    role: "admin",
  };
}

async function discoveryRequest(
  method: string,
  pathname: string,
  scope: RequestContext,
  body?: Record<string, unknown>,
): Promise<{ status: number; value: Record<string, unknown> }> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const request = (payload === undefined
    ? Readable.from([])
    : Readable.from([payload])) as unknown as http.IncomingMessage;
  request.headers =
    payload === undefined
      ? {}
      : {
          "content-type": "application/json",
          "content-length": String(payload.byteLength),
        };
  const response = new CapturedResponse();
  const handled = await handleDiscoveryRoute({
    method,
    pathname,
    url: new URL(`http://localhost${pathname}`),
    request,
    response: response as unknown as http.ServerResponse,
    scope,
  });
  assert.equal(handled, true);
  return {
    status: response.status,
    value: response.body ? (JSON.parse(response.body) as Record<string, unknown>) : {},
  };
}

function operationHeaders(operationId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-organization-id": "acme",
    "x-project-id": "mobile",
    "x-relay-actor-id": "human:discovery-test",
    "x-relay-actor-kind": "human",
    "x-relay-operation-id": operationId,
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

test("Discovery interaction errors retain the one-command iOS diagnostic and durable review pointer", () => {
  const error = new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation: "back",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 1,
    },
    new Error("connection reset"),
  );
  const response = discoveryInteractionHttpError(error, {
    id: "map / one",
    currentScreenId: "screen / before",
    screens: [
      {
        id: "screen / before",
        fingerprint: "settings",
        capturedAt: 123,
        screenshotPath: "/durable/screen-before.png",
      },
    ],
  });

  assert.ok(response instanceof HttpError);
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    discoveryReview: {
      sessionId: "map / one",
      sessionHref: "/discovery/map%20%2F%20one",
      lastProvenScreen: {
        id: "screen / before",
        capturedAt: 123,
        screenshotHref: "/discovery/map%20%2F%20one/screens/screen%20%2F%20before",
      },
      captureCurrent: {
        method: "POST",
        href: "/discovery/map%20%2F%20one/capture",
      },
    },
    code: "IOS_MUTATION_OUTCOME_UNKNOWN",
    iosMutation: error.iosMutation,
  });
});

test("discovery routes list create and read sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-discovery-routes-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const empty = await fetch(`${base}/discovery`, {
      headers: operationHeaders("discovery.list"),
    });
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { sessions: [] });

    const created = await fetch(`${base}/discovery`, {
      method: "POST",
      headers: operationHeaders("discovery.create"),
      body: JSON.stringify({ name: "Sign-in map", targetId: "pixel" }),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { session: DiscoverySession };
    assert.equal(createdBody.session.name, "Sign-in map");
    assert.equal(createdBody.session.targetId, "pixel");
    assert.ok(createdBody.session.id);

    const listed = await fetch(`${base}/discovery`, {
      headers: operationHeaders("discovery.list"),
    });
    assert.equal(listed.status, 200);
    const listedBody = (await listed.json()) as { sessions: DiscoverySession[] };
    assert.equal(listedBody.sessions.length, 1);
    assert.equal(listedBody.sessions[0]?.id, createdBody.session.id);

    const read = await fetch(`${base}/discovery/${encodeURIComponent(createdBody.session.id)}`, {
      headers: operationHeaders("discovery.get"),
    });
    assert.equal(read.status, 200);
    const readBody = (await read.json()) as { session: DiscoverySession };
    assert.equal(readBody.session.id, createdBody.session.id);
    assert.equal(readBody.session.name, "Sign-in map");

    const timeline = await fetch(
      `${base}/discovery/${encodeURIComponent(createdBody.session.id)}/exploration-timeline`,
      { headers: operationHeaders("discovery.exploration-timeline") },
    );
    assert.equal(timeline.status, 200);
    const timelineBody = (await timeline.json()) as {
      explorationTimeline: { sessionId: string; stepCount: number };
    };
    assert.equal(timelineBody.explorationTimeline.sessionId, createdBody.session.id);
    assert.equal(timelineBody.explorationTimeline.stepCount, 0);

    const missing = await fetch(`${base}/discovery/does-not-exist`, {
      headers: operationHeaders("discovery.get"),
    });
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery routes isolate sessions by project when not local-trusted", async () => {
  // startServer on loopback always sets localTrusted=true, which disables the
  // project filter. Non-loopback hosts also keep /discovery on the local
  // workspace gate (403). Exercise handleDiscoveryRoute with localTrusted=false
  // so the route-level project filter is observable without changing that gate.
  const root = await mkdtemp(join(tmpdir(), "relay-discovery-scope-routes-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const projectA = scopeFor("project-a", false);
    const projectB = scopeFor("project-b", false);

    const created = await discoveryRequest("POST", "/discovery", projectA, {
      name: "Project A map",
      targetId: "pixel-a",
    });
    assert.equal(created.status, 201);
    const createdSession = created.value.session as DiscoverySession;
    assert.equal(createdSession.projectId, "project-a");

    const listedA = await discoveryRequest("GET", "/discovery", projectA);
    assert.equal(listedA.status, 200);
    const sessionsA = listedA.value.sessions as DiscoverySession[];
    assert.equal(sessionsA.length, 1);
    assert.equal(sessionsA[0]?.id, createdSession.id);

    const listedB = await discoveryRequest("GET", "/discovery", projectB);
    assert.equal(listedB.status, 200);
    assert.deepEqual(listedB.value.sessions, []);

    await assert.rejects(
      () =>
        discoveryRequest("GET", `/discovery/${encodeURIComponent(createdSession.id)}`, projectB),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 404);
        return true;
      },
    );

    const readA = await discoveryRequest(
      "GET",
      `/discovery/${encodeURIComponent(createdSession.id)}`,
      projectA,
    );
    assert.equal(readA.status, 200);
    assert.equal((readA.value.session as DiscoverySession).id, createdSession.id);

    // Local-trusted operators still see every session on the host.
    const listedLocal = await discoveryRequest("GET", "/discovery", scopeFor("project-b", true));
    assert.equal(listedLocal.status, 200);
    const localSessions = listedLocal.value.sessions as DiscoverySession[];
    assert.equal(localSessions.length, 1);
    assert.equal(localSessions[0]?.id, createdSession.id);
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

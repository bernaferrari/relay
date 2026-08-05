import assert from "node:assert/strict";
import type http from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import type { CollaborationAwareness } from "@relay/protocol";
import { resetPresenceForTests } from "@relay/core";
import { handlePresenceRoute } from "./presence-routes.js";
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
  };
}

async function presenceRequest(
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
  const handled = await handlePresenceRoute({
    method,
    pathname,
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

test("presence routes list upsert and clear actors for a project", async () => {
  resetPresenceForTests();
  const scope = scopeFor("project-a", false);

  const empty = await presenceRequest("GET", "/presence", scope);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.value.actors, []);

  const upserted = await presenceRequest("POST", "/presence", scope, {
    actorId: "agent:a",
    actorKind: "agent",
    activity: "editing",
    displayName: "Scout",
    cursor: { x: 12, y: 34 },
  });
  assert.equal(upserted.status, 200);
  const actor = upserted.value.actor as CollaborationAwareness;
  assert.equal(actor.actorId, "agent:a");
  assert.equal(actor.activity, "editing");
  assert.equal(actor.displayName, "Scout");
  assert.deepEqual(actor.cursor, { x: 12, y: 34 });

  const listed = await presenceRequest("GET", "/presence", scope);
  assert.equal(listed.status, 200);
  const actors = listed.value.actors as CollaborationAwareness[];
  assert.equal(actors.length, 1);
  assert.equal(actors[0]?.actorId, "agent:a");

  const cleared = await presenceRequest("DELETE", "/presence/agent%3Aa", scope);
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.value, { ok: true });

  const afterClear = await presenceRequest("GET", "/presence", scope);
  assert.equal(afterClear.status, 200);
  assert.deepEqual(afterClear.value.actors, []);
});

test("presence list isolates actors by project when not local-trusted", async () => {
  // Presence is always project-bucketed in core. Exercise handlePresenceRoute
  // with localTrusted=false so a project-a token cannot observe project-b actors.
  resetPresenceForTests();
  const projectA = scopeFor("project-a", false);
  const projectB = scopeFor("project-b", false);

  const createdA = await presenceRequest("POST", "/presence", projectA, {
    actorId: "agent:project-a",
    actorKind: "agent",
    activity: "running",
    displayName: "A",
  });
  assert.equal(createdA.status, 200);
  assert.equal((createdA.value.actor as CollaborationAwareness).actorId, "agent:project-a");

  const createdB = await presenceRequest("POST", "/presence", projectB, {
    actorId: "agent:project-b",
    actorKind: "agent",
    activity: "editing",
    displayName: "B",
  });
  assert.equal(createdB.status, 200);
  assert.equal((createdB.value.actor as CollaborationAwareness).actorId, "agent:project-b");

  const listedA = await presenceRequest("GET", "/presence", projectA);
  assert.equal(listedA.status, 200);
  const actorsA = listedA.value.actors as CollaborationAwareness[];
  assert.equal(actorsA.length, 1);
  assert.equal(actorsA[0]?.actorId, "agent:project-a");
  assert.equal(
    actorsA.some((actor) => actor.actorId === "agent:project-b"),
    false,
  );

  const listedB = await presenceRequest("GET", "/presence", projectB);
  assert.equal(listedB.status, 200);
  const actorsB = listedB.value.actors as CollaborationAwareness[];
  assert.equal(actorsB.length, 1);
  assert.equal(actorsB[0]?.actorId, "agent:project-b");
  assert.equal(
    actorsB.some((actor) => actor.actorId === "agent:project-a"),
    false,
  );

  // Clearing in project-b must not remove project-a actors.
  const clearedB = await presenceRequest("DELETE", "/presence/agent%3Aproject-b", projectB);
  assert.equal(clearedB.status, 200);

  const listedAAfter = await presenceRequest("GET", "/presence", projectA);
  assert.equal(listedAAfter.status, 200);
  const actorsAAfter = listedAAfter.value.actors as CollaborationAwareness[];
  assert.equal(actorsAAfter.length, 1);
  assert.equal(actorsAAfter[0]?.actorId, "agent:project-a");

  const listedBAfter = await presenceRequest("GET", "/presence", projectB);
  assert.equal(listedBAfter.status, 200);
  assert.deepEqual(listedBAfter.value.actors, []);
});

test("presence defaults actor identity from the request scope", async () => {
  resetPresenceForTests();
  const scope = scopeFor("project-a", false);

  const upserted = await presenceRequest("POST", "/presence", scope, {
    activity: "idle",
  });
  assert.equal(upserted.status, 200);
  const actor = upserted.value.actor as CollaborationAwareness;
  assert.equal(actor.actorId, scope.subject);
  assert.equal(actor.actorKind, "agent");
  assert.equal(actor.activity, "idle");
});

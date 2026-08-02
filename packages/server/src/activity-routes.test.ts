import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ActivityPage } from "@relay/core";
import { startServer } from "./index.js";

function operationHeaders(input: {
  operationId: string;
  requestId: string;
  projectId: string;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-organization-id": "acme",
    "x-project-id": input.projectId,
    "x-relay-actor-id": "agent:activity-test",
    "x-relay-actor-kind": "agent",
    "x-relay-operation-id": input.operationId,
    "x-relay-request-id": input.requestId,
    "x-relay-command-at": String(Date.now()),
    "x-relay-correlation-id": "correlation-activity",
    "x-relay-causation-id": "causation-activity",
    "x-relay-authoring-session-id": "session-activity",
    "idempotency-key": input.requestId,
  };
}

function scopeHeaders(projectId: string): Record<string, string> {
  return { "x-organization-id": "acme", "x-project-id": projectId };
}

test("GET /activity lists durable scoped semantic operations without persisting payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-activity-route-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = join(root, "state");
  let server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    let baseUrl = `http://127.0.0.1:${server.port}`;
    for (let revision = 0; revision < 3; revision++) {
      const response = await fetch(`${baseUrl}/project/variables`, {
        method: "PUT",
        headers: operationHeaders({
          operationId: "workspace.variables.update",
          requestId: `request-${revision}`,
          projectId: "project-a",
        }),
        body: JSON.stringify({
          expectedRevision: revision,
          value: [
            {
              id: "token",
              name: "token",
              scope: "shared",
              source: "static",
              fallback: `TOP-SECRET-${revision}`,
              sensitive: true,
            },
          ],
        }),
      });
      assert.equal(response.status, 200);
    }

    const firstResponse = await fetch(`${baseUrl}/activity?limit=2`, {
      headers: scopeHeaders("project-a"),
    });
    assert.equal(firstResponse.status, 200);
    const first = (await firstResponse.json()) as ActivityPage;
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor);
    assert.deepEqual(
      first.items.map((item) => item.requestId),
      ["request-2", "request-1"],
    );
    assert.deepEqual(
      {
        actorId: first.items[0]?.actorId,
        actorKind: first.items[0]?.actorKind,
        operationId: first.items[0]?.operationId,
        eventType: first.items[0]?.eventType,
        resourceKind: first.items[0]?.resourceKind,
        resourceId: first.items[0]?.resourceId,
        summary: first.items[0]?.summary,
        correlationId: first.items[0]?.correlationId,
        causationId: first.items[0]?.causationId,
        sessionId: first.items[0]?.sessionId,
      },
      {
        actorId: "agent:activity-test",
        actorKind: "agent",
        operationId: "workspace.variables.update",
        eventType: "operation.requested",
        resourceKind: "project",
        resourceId: "project-a",
        summary: "Update project variables",
        correlationId: "correlation-activity",
        causationId: "causation-activity",
        sessionId: "session-activity",
      },
    );

    const second = (await (
      await fetch(`${baseUrl}/activity?limit=2&cursor=${first.nextCursor}`, {
        headers: scopeHeaders("project-a"),
      })
    ).json()) as ActivityPage;
    assert.deepEqual(
      second.items.map((item) => item.requestId),
      ["request-0"],
    );
    assert.equal(second.nextCursor, undefined);

    const otherProject = (await (
      await fetch(`${baseUrl}/activity`, { headers: scopeHeaders("project-b") })
    ).json()) as ActivityPage;
    assert.deepEqual(otherProject.items, []);

    const activityDirectory = join(process.env.RELAY_STATE_DIR, "activity");
    const files = await readdir(activityDirectory);
    assert.equal(files.length, 1);
    const persisted = await readFile(join(activityDirectory, files[0]!), "utf8");
    assert.doesNotMatch(persisted, /TOP-SECRET/);
    assert.doesNotMatch(persisted, /fallback|sensitive/);

    const invalidLimit = await fetch(`${baseUrl}/activity?limit=0`, {
      headers: scopeHeaders("project-a"),
    });
    assert.equal(invalidLimit.status, 400);
    const invalidCursor = await fetch(`${baseUrl}/activity?cursor=invalid`, {
      headers: scopeHeaders("project-a"),
    });
    assert.equal(invalidCursor.status, 400);

    await server.close();
    server = await startServer({ host: "127.0.0.1", port: 0 });
    baseUrl = `http://127.0.0.1:${server.port}`;
    const afterRestart = (await (
      await fetch(`${baseUrl}/activity`, { headers: scopeHeaders("project-a") })
    ).json()) as ActivityPage;
    assert.equal(afterRestart.items.length, 3);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

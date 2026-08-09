import assert from "node:assert/strict";
import test from "node:test";
import { clearPresence, listPresence, resetPresenceForTests, upsertPresence } from "./presence.js";
import { recentEvents, subscribe } from "./events.js";
import { runWithOperationContext } from "./operation-context.js";

function withProject<T>(projectId: string, actorId: string, fn: () => T): T {
  return runWithOperationContext(
    {
      schemaVersion: 1,
      actorId,
      actorKind: "human",
      organizationId: "local",
      projectId,
      operationId: "presence.test",
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      issuedAt: Date.now(),
    },
    fn,
  );
}

test("presence is project-scoped and expires", () => {
  resetPresenceForTests();
  withProject("alpha", "human:a", () => {
    upsertPresence({
      projectId: "alpha",
      actorId: "human:a",
      actorKind: "human",
      activity: "editing",
      cursor: { x: 10, y: 20 },
    });
    upsertPresence({
      projectId: "beta",
      actorId: "agent:b",
      actorKind: "agent",
      activity: "running",
    });
    assert.equal(listPresence("alpha").length, 1);
    assert.equal(listPresence("alpha")[0]?.actorId, "human:a");
    assert.equal(listPresence("beta").length, 1);
    clearPresence("alpha", "human:a");
    assert.equal(listPresence("alpha").length, 0);
  });
});

test("upsertPresence publishes resource.updated for the actor", () => {
  resetPresenceForTests();
  const seen: string[] = [];
  const unsubscribe = subscribe((event) => {
    if (event.payload.type === "resource.updated" && event.payload.resource === "presence") {
      seen.push(`${event.payload.projectId}:${event.payload.resourceId}`);
    }
  });
  try {
    withProject("alpha", "human:a", () => {
      const actor = upsertPresence({
        projectId: "alpha",
        actorId: "human:a",
        actorKind: "human",
        activity: "editing",
        displayName: "Ada",
        selection: { screenId: "screen-1" },
      });
      assert.equal(actor.displayName, "Ada");
      assert.equal(actor.selection?.screenId, "screen-1");
      assert.deepEqual(seen, ["alpha:human:a"]);
      const latest = recentEvents(5).at(-1);
      assert.equal(latest?.payload.type, "resource.updated");
      if (latest?.payload.type === "resource.updated") {
        assert.equal(latest.payload.resource, "presence");
        assert.equal(latest.payload.resourceId, "human:a");
        assert.equal(latest.payload.projectId, "alpha");
        assert.equal(latest.payload.revision, actor.updatedAt);
      }
    });
  } finally {
    unsubscribe();
  }
});

test("clearPresence publishes resource.deleted only when the actor existed", () => {
  resetPresenceForTests();
  const deleted: string[] = [];
  const unsubscribe = subscribe((event) => {
    if (event.payload.type === "resource.deleted" && event.payload.resource === "presence") {
      deleted.push(`${event.payload.projectId}:${event.payload.resourceId}`);
    }
  });
  try {
    withProject("alpha", "human:a", () => {
      upsertPresence({
        projectId: "alpha",
        actorId: "human:a",
        actorKind: "human",
        activity: "idle",
      });
      clearPresence("alpha", "missing");
      assert.deepEqual(deleted, []);
      clearPresence("alpha", "human:a");
      assert.deepEqual(deleted, ["alpha:human:a"]);
      assert.equal(listPresence("alpha").length, 0);
    });
  } finally {
    unsubscribe();
  }
});

test("expired actors are pruned from listPresence", () => {
  resetPresenceForTests();
  withProject("alpha", "human:a", () => {
    const actor = upsertPresence({
      projectId: "alpha",
      actorId: "human:a",
      actorKind: "human",
      activity: "idle",
      ttlMs: 5_000,
    });
    assert.equal(listPresence("alpha", actor.expiresAt - 1).length, 1);
    assert.equal(listPresence("alpha", actor.expiresAt).length, 0);
    assert.equal(listPresence("alpha", actor.expiresAt + 1).length, 0);
  });
});

test("upsertPresence rejects empty actor ids and enforces capacity", () => {
  resetPresenceForTests();
  withProject("alpha", "human:a", () => {
    assert.throws(
      () =>
        upsertPresence({
          projectId: "alpha",
          actorId: "   ",
          actorKind: "human",
          activity: "idle",
        }),
      /actorId is required/,
    );

    for (let index = 0; index < 64; index += 1) {
      upsertPresence({
        projectId: "alpha",
        actorId: `human:${index}`,
        actorKind: "human",
        activity: "idle",
      });
    }
    assert.throws(
      () =>
        upsertPresence({
          projectId: "alpha",
          actorId: "human:overflow",
          actorKind: "human",
          activity: "idle",
        }),
      /presence capacity exceeded/,
    );
    // Updating an existing actor still tests at capacity.
    const refreshed = upsertPresence({
      projectId: "alpha",
      actorId: "human:0",
      actorKind: "human",
      activity: "editing",
    });
    assert.equal(refreshed.activity, "editing");
    assert.equal(listPresence("alpha").length, 64);
  });
});

test("listPresence sorts actors by actorId", () => {
  resetPresenceForTests();
  withProject("alpha", "human:z", () => {
    upsertPresence({
      projectId: "alpha",
      actorId: "human:z",
      actorKind: "human",
      activity: "idle",
    });
    upsertPresence({
      projectId: "alpha",
      actorId: "agent:a",
      actorKind: "agent",
      activity: "running",
    });
    assert.deepEqual(
      listPresence("alpha").map((actor) => actor.actorId),
      ["agent:a", "human:z"],
    );
  });
});

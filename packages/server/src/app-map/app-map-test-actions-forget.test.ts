import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { resetControlDatabaseCache } from "@relay/core";
import { startServer } from "../index.js";

function clientFor(port: number): RelayClient {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "acme",
    projectId: "mobile",
    actorId: "human:tester",
    actorKind: "human",
  });
}

const savedPath = {
  schemaVersion: 2,
  steps: [{ kind: "tap", target: { label: "Settings" } }],
  runId: "run-old",
  savedAt: 1,
  targetKind: "browser",
  resolution: [{ strategy: "label", key: "Settings" }],
  verification: { runOutcome: "passed" },
} as const;

function cachedStep(id: string, intent: string) {
  return {
    id,
    kind: "instruction",
    intent,
    binding: {
      status: "unresolved",
      reason: "runs from its words",
      fromText: true,
      cache: structuredClone(savedPath),
    },
  };
}

test("forgetting saved actions clears one step or a whole Test, idempotently and undoably", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-test-forget-route-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = clientFor(server.port);
    await client.invoke("app-map.create", { appMapId: "store", name: "Store" });
    const saved = await client.invoke("app-map.test.save", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: 0,
      test: {
        name: "Checkout",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          cachedStep("open", "Open Settings"),
          cachedStep("pay", "Pay"),
          {
            id: "confirm",
            kind: "instruction",
            intent: "Confirm",
            binding: { status: "unresolved", reason: "runs from its words", fromText: true },
          },
        ],
      },
    } as never);
    const cacheOf = (map: (typeof saved)["appMap"], stepId: string) => {
      const step = map.tests.checkout?.steps.find((item) => item.id === stepId) as
        | { binding: { cache?: unknown } }
        | undefined;
      return step?.binding.cache;
    };
    assert.ok(cacheOf(saved.appMap, "open"), "the saved path round-trips into the document");

    // One step: only its saved path is forgotten, and the event is user-visible.
    const one = await client.invoke("app-map.test.actions.forget", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: saved.appMap.revision,
      eventId: "forget-open",
      stepId: "open",
    });
    assert.equal(cacheOf(one.appMap, "open"), undefined);
    assert.ok(cacheOf(one.appMap, "pay"));
    assert.equal(one.appMap.revision, saved.appMap.revision + 1);
    const event = one.appMap.activity["forget-open"];
    assert.equal(event?.eventType, "test.actions-dropped");
    assert.equal(event?.summary, "Forgot saved actions for 1 plain-English step in Checkout");

    // The retry of the same event is a no-op rather than a second mutation.
    const retried = await client.invoke("app-map.test.actions.forget", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: one.appMap.revision,
      eventId: "forget-open",
      stepId: "open",
    });
    assert.equal(retried.appMap.revision, one.appMap.revision);

    // The forget is a durable user edit: undo restores the saved path.
    const undone = await client.invoke("app-map.test.undo", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: retried.appMap.revision,
    });
    assert.ok(cacheOf(undone.appMap, "open"), "undo restores the forgotten saved path");
    const redone = await client.invoke("app-map.test.redo", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: undone.appMap.revision,
    });
    assert.equal(cacheOf(redone.appMap, "open"), undefined);

    // A stale revision fence is a conflict while there is still something to forget.
    await assert.rejects(
      client.invoke("app-map.test.actions.forget", {
        appMapId: "store",
        testId: "checkout",
        expectedRevision: 0,
      }),
      /revision/,
    );

    // The whole Test: every remaining saved path is forgotten at once.
    const all = await client.invoke("app-map.test.actions.forget", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: redone.appMap.revision,
      eventId: "forget-all",
    });
    assert.equal(cacheOf(all.appMap, "open"), undefined);
    assert.equal(cacheOf(all.appMap, "pay"), undefined);
    assert.equal(
      all.appMap.activity["forget-all"]?.summary,
      "Forgot saved actions for 1 plain-English step in Checkout",
    );

    // Nothing left to forget is an honest error, not an empty mutation.
    const revision = all.appMap.revision;
    await assert.rejects(
      client.invoke("app-map.test.actions.forget", {
        appMapId: "store",
        testId: "checkout",
        expectedRevision: revision,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.match(error.message, /no saved actions to forget/);
        return true;
      },
    );
    await assert.rejects(
      client.invoke("app-map.test.actions.forget", {
        appMapId: "store",
        testId: "checkout",
        expectedRevision: revision,
        stepId: "missing-step",
      }),
      /does not exist/,
    );
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    resetControlDatabaseCache();
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { resetControlDatabaseCache, sameAppMapTestContent } from "@relay/core";
import type { AppMapScenarioTestEdit } from "@relay/protocol";
import { startServer } from "./index.js";

function clientFor(port: number, actorId: string): RelayClient {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "acme",
    projectId: "mobile",
    actorId,
    actorKind: "human",
  });
}

test("Test edit history restores every stable step operation and survives restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-test-history-route-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  let server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = clientFor(server.port, "human:test-editor");
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
          {
            id: "cart",
            kind: "manual",
            intent: "Open the cart",
            binding: { status: "resolved", kind: "pause", message: "Open the cart" },
          },
          {
            id: "pay",
            kind: "manual",
            intent: "Pay",
            binding: { status: "resolved", kind: "pause", message: "Pay" },
          },
        ],
      },
    } as never);

    let current = saved.appMap;
    const editAndRoundTrip = async (edits: readonly AppMapScenarioTestEdit[]) => {
      const edited = await client.invoke("app-map.test.edit", {
        appMapId: "store",
        testId: "checkout",
        expectedRevision: current.revision,
        edits: [...edits],
      });
      const changed = edited.appMap;
      const undone = await client.invoke("app-map.test.undo", {
        appMapId: "store",
        testId: "checkout",
        expectedRevision: changed.revision,
      });
      assert.equal(undone.appMap.tests.checkout?.validation?.status, "needs-validation");
      assert.equal(
        sameAppMapTestContent(undone.appMap.tests.checkout!, current.tests.checkout!),
        true,
      );
      const redone = await client.invoke("app-map.test.redo", {
        appMapId: "store",
        testId: "checkout",
        expectedRevision: undone.appMap.revision,
      });
      assert.equal(
        sameAppMapTestContent(redone.appMap.tests.checkout!, changed.tests.checkout!),
        true,
      );
      current = redone.appMap;
    };

    await editAndRoundTrip([
      { kind: "step.patch", stepId: "cart", patch: { intent: "Open the basket" } },
    ]);
    await editAndRoundTrip([
      {
        kind: "step.add",
        step: {
          id: "confirm",
          kind: "manual",
          intent: "Confirm",
          binding: { status: "resolved", kind: "pause", message: "Confirm" },
        },
      },
    ]);
    await editAndRoundTrip([{ kind: "step.reorder", orderedStepIds: ["confirm", "pay", "cart"] }]);
    await editAndRoundTrip([
      {
        kind: "step.bind",
        stepId: "cart",
        binding: { status: "resolved", kind: "pause", message: "Open the basket" },
      },
    ]);
    await editAndRoundTrip([{ kind: "step.remove", stepId: "confirm" }]);

    const beforeRestart = current;
    await client.invoke("app-map.test.edit", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: current.revision,
      edits: [{ kind: "test.patch", patch: { name: "Checkout edited" } }],
    });
    await server.close();
    resetControlDatabaseCache();
    server = await startServer({ host: "127.0.0.1", port: 0 });
    const afterRestart = clientFor(server.port, "human:test-editor");
    const undone = await afterRestart.invoke("app-map.test.undo", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: beforeRestart.revision + 1,
    });
    assert.equal(undone.appMap.tests.checkout?.name, beforeRestart.tests.checkout?.name);
    assert.equal(undone.appMap.tests.checkout?.id, "checkout");
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Test undo requires the current revision and invalidates redo after a new edit", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-test-history-conflict-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = clientFor(server.port, "human:test-editor");
    await client.invoke("app-map.create", { appMapId: "store", name: "Store" });
    const saved = await client.invoke("app-map.test.save", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: 0,
      test: {
        name: "Checkout",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [],
      },
    } as never);
    const edited = await client.invoke("app-map.test.edit", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: saved.appMap.revision,
      edits: [{ kind: "test.patch", patch: { name: "Checkout v2" } }],
    });
    await assert.rejects(
      client.invoke("app-map.test.undo", {
        appMapId: "store",
        testId: "checkout",
        expectedRevision: saved.appMap.revision,
      }),
      (error) => error instanceof ApiError && error.status === 409,
    );
    const undone = await client.invoke("app-map.test.undo", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: edited.appMap.revision,
    });
    const divergent = await client.invoke("app-map.test.edit", {
      appMapId: "store",
      testId: "checkout",
      expectedRevision: undone.appMap.revision,
      edits: [{ kind: "test.patch", patch: { name: "Checkout divergent" } }],
    });
    assert.equal(divergent.appMap.tests.checkout?.name, "Checkout divergent");
    await assert.rejects(
      client.invoke("app-map.test.redo", {
        appMapId: "store",
        testId: "checkout",
        expectedRevision: divergent.appMap.revision,
      }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        assert.equal((error.body as { code?: string }).code, "history-empty");
        return true;
      },
    );
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

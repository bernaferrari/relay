import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppMapScenarioTest } from "@relay/protocol";
import {
  appendAppMapTestMutationHistory,
  readAppMapTestMutationHistory,
  setAppMapTestHistoryCursor,
} from "./app-map.js";
import { createAppMap, resetControlDatabaseCache } from "./collaboration.js";
import { readControlStore, withControlStore } from "./collaboration-store.js";

const before: AppMapScenarioTest = {
  id: "checkout",
  organizationId: "acme",
  projectId: "mobile",
  appMapId: "store",
  createdAt: 1,
  updatedAt: 1,
  name: "Checkout",
  kind: "scenario",
  intentSchemaVersion: 1,
  steps: [],
};

test("Test mutation snapshots persist across database reopen and truncate redo branches", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-test-history-core-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    await createAppMap({
      organizationId: "acme",
      projectId: "mobile",
      appMapId: "store",
      name: "Store",
      at: 1,
    });
    await withControlStore((store) =>
      appendAppMapTestMutationHistory(store, "mobile", "store", "checkout", {
        eventId: "edit-one",
        beforeRevision: 0,
        afterRevision: 1,
        before,
        after: { ...before, name: "Checkout one" },
        touched: ["test:checkout:metadata"],
        at: 2,
      }),
    );
    await withControlStore((store) =>
      appendAppMapTestMutationHistory(store, "mobile", "store", "checkout", {
        eventId: "edit-two",
        beforeRevision: 1,
        afterRevision: 2,
        before: { ...before, name: "Checkout one" },
        after: { ...before, name: "Checkout two" },
        touched: ["test:checkout:metadata"],
        at: 3,
      }),
    );
    await withControlStore((store) =>
      setAppMapTestHistoryCursor(store, "mobile", "store", "checkout", 1, 4),
    );
    resetControlDatabaseCache();
    assert.deepEqual(
      await readControlStore((store) =>
        readAppMapTestMutationHistory(store, "mobile", "store", "checkout"),
      ),
      {
        cursor: 1,
        entries: [
          {
            index: 1,
            eventId: "edit-one",
            beforeRevision: 0,
            afterRevision: 1,
            before,
            after: { ...before, name: "Checkout one" },
            touched: ["test:checkout:metadata"],
            at: 2,
          },
          {
            index: 2,
            eventId: "edit-two",
            beforeRevision: 1,
            afterRevision: 2,
            before: { ...before, name: "Checkout one" },
            after: { ...before, name: "Checkout two" },
            touched: ["test:checkout:metadata"],
            at: 3,
          },
        ],
      },
    );
    await withControlStore((store) =>
      appendAppMapTestMutationHistory(store, "mobile", "store", "checkout", {
        eventId: "edit-branch",
        beforeRevision: 3,
        afterRevision: 4,
        before: { ...before, name: "Checkout one" },
        after: { ...before, name: "Checkout branch" },
        touched: ["test:checkout:metadata"],
        at: 5,
      }),
    );
    const branched = await readControlStore((store) =>
      readAppMapTestMutationHistory(store, "mobile", "store", "checkout"),
    );
    assert.equal(branched.cursor, 2);
    assert.deepEqual(
      branched.entries.map((entry) => [entry.index, entry.eventId]),
      [
        [1, "edit-one"],
        [2, "edit-branch"],
      ],
    );
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

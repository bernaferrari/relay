import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringSession } from "@relay/protocol";
import { pruneAbandonedAuthoringSessions } from "./authoring-session-retention.js";
import { KeyedSerialQueue } from "./coordination-store.js";

test("a prune candidate that changed, became active, or failed validation is retained", async () => {
  const previous = process.env.RELAY_ABANDONED_AUTHORING_LIMIT;
  process.env.RELAY_ABANDONED_AUTHORING_LIMIT = "0";
  const candidate = {
    id: "candidate",
    projectId: "project",
    state: "cancelled" as const,
    updatedAt: 1,
  };
  const outcomes = [
    null,
    { ...candidate, state: "recording" },
    { ...candidate, updatedAt: 2 },
    { ...candidate, id: "another-session" },
    { ...candidate, projectId: "other-project" },
    {
      ...candidate,
      archive: { reason: "superseded", archivedAt: 1, supersededBySessionId: "replacement" },
    },
  ];
  try {
    for (const current of outcomes) {
      const removed: string[] = [];
      await pruneAbandonedAuthoringSessions("project", new KeyedSerialQueue(), {
        listFiles: async () => ["candidate.json"],
        readRetention: async () => candidate,
        readSession: async () => current as AuthoringSession | null,
        remove: async (id) => {
          removed.push(id);
        },
      });
      assert.deepEqual(removed, []);
    }
  } finally {
    if (previous === undefined) delete process.env.RELAY_ABANDONED_AUTHORING_LIMIT;
    else process.env.RELAY_ABANDONED_AUTHORING_LIMIT = previous;
  }
});

test("pruning waits for the session mutation and preserves a revived recording", async () => {
  const previous = process.env.RELAY_ABANDONED_AUTHORING_LIMIT;
  process.env.RELAY_ABANDONED_AUTHORING_LIMIT = "0";
  const queue = new KeyedSerialQueue();
  const candidate = {
    id: "candidate",
    projectId: "project",
    state: "failed" as const,
    updatedAt: 1,
  };
  let current: typeof candidate | (Omit<typeof candidate, "state"> & { state: "reviewing" }) =
    candidate;
  let finishRecovery!: () => void;
  const recoveryPending = new Promise<void>((resolve) => {
    finishRecovery = resolve;
  });
  let candidateListed!: () => void;
  const metadataRead = new Promise<void>((resolve) => {
    candidateListed = resolve;
  });
  let sessionReads = 0;
  const removed: string[] = [];
  const recovery = queue.run(candidate.id, async () => {
    await recoveryPending;
    current = { ...candidate, state: "reviewing", updatedAt: 2 };
  });
  try {
    const pruning = pruneAbandonedAuthoringSessions("project", queue, {
      listFiles: async () => ["candidate.json"],
      readRetention: async () => {
        candidateListed();
        return candidate;
      },
      readSession: async () => {
        sessionReads += 1;
        return current as AuthoringSession;
      },
      remove: async (id) => {
        removed.push(id);
      },
    });
    await metadataRead;
    await Promise.resolve();
    assert.equal(sessionReads, 0, "the candidate must be reread after recovery releases ownership");
    finishRecovery();
    await Promise.all([recovery, pruning]);
    assert.equal(sessionReads, 1);
    assert.deepEqual(removed, []);
  } finally {
    finishRecovery();
    await recovery;
    if (previous === undefined) delete process.env.RELAY_ABANDONED_AUTHORING_LIMIT;
    else process.env.RELAY_ABANDONED_AUTHORING_LIMIT = previous;
  }
});

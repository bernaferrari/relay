import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { JourneyMetadata } from "@relay/protocol";
import {
  commitJourneyAggregate,
  persistAuthoringEvidence,
  readJourneyAggregate,
} from "./journey-aggregate.js";

const metadata = (transitionId: string): JourneyMetadata => ({
  schemaVersion: 6,
  positions: {},
  edgeLabels: {},
  edgeKinds: {},
  graph: {
    schemaVersion: 1,
    screens: [
      { id: "start", title: "Start", createdAt: 1, updatedAt: 1 },
      { id: "next", title: "Next", createdAt: 1, updatedAt: 1 },
    ],
    transitions: [
      {
        id: transitionId,
        fromScreenId: "start",
        destination: { kind: "screen", screenId: "next" },
        stepIds: [transitionId],
        state: "recorded",
        review: { status: "verified", updatedAt: 1, verifiedAt: 1 },
        kind: "forward",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    flows: [{ id: "main", name: "Main flow", screenId: "start", createdAt: 1, updatedAt: 1 }],
  },
});

test("aggregate rename is the only visibility point across every injected boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-aggregate-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = directory;
  try {
    const evidence = await persistAuthoringEvidence({
      kind: "screenshot",
      capturedAt: 1,
      data: Buffer.from("immutable"),
      mime: "image/png",
    });
    await commitJourneyAggregate({
      organizationId: "local",
      projectId: "project-a",
      journeyId: "journey-a",
      transactionId: "old",
      recipe: {
        id: "journey-a",
        title: "Journey",
        source: "custom",
        steps: [{ id: "old-step", kind: "sleep", ms: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
      document: { revision: 1, value: metadata("old-step"), updatedAt: 1 },
      evidence: [evidence],
    });

    for (const boundary of ["before-verify", "after-verify", "before-rename"] as const) {
      await assert.rejects(
        commitJourneyAggregate({
          organizationId: "local",
          projectId: "project-a",
          journeyId: "journey-a",
          transactionId: `new-${boundary}`,
          recipe: {
            id: "journey-a",
            title: "Journey",
            source: "custom",
            steps: [{ id: "new-step", kind: "key", key: "back" }],
            createdAt: 1,
            updatedAt: 2,
          },
          document: { revision: 2, value: metadata("new-step"), updatedAt: 2 },
          evidence: [evidence],
          fault: (at) => {
            if (at === boundary) throw new Error(`fault:${boundary}`);
          },
        }),
        new RegExp(`fault:${boundary}`),
      );
      const visible = await readJourneyAggregate("project-a", "journey-a");
      assert.equal(visible?.transactionId, "old");
      assert.equal(visible?.recipe.steps[0]?.id, "old-step");
      assert.equal(visible?.document.value.graph?.transitions[0]?.stepIds[0], "old-step");
    }

    await assert.rejects(
      commitJourneyAggregate({
        organizationId: "local",
        projectId: "project-a",
        journeyId: "journey-a",
        transactionId: "new-after-rename",
        recipe: {
          id: "journey-a",
          title: "Journey",
          source: "custom",
          steps: [{ id: "new-step", kind: "key", key: "back" }],
          createdAt: 1,
          updatedAt: 2,
        },
        document: { revision: 2, value: metadata("new-step"), updatedAt: 2 },
        evidence: [evidence],
        fault: (at) => {
          if (at === "after-rename") throw new Error("fault:after-rename");
        },
      }),
      /fault:after-rename/,
    );
    const committed = await readJourneyAggregate("project-a", "journey-a");
    assert.equal(committed?.transactionId, "new-after-rename");
    assert.equal(committed?.recipe.steps[0]?.id, "new-step");
    assert.equal(committed?.document.value.graph?.transitions[0]?.stepIds[0], "new-step");
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("aggregate rejects references to evidence that is not in the immutable store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-aggregate-missing-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = directory;
  try {
    await assert.rejects(
      commitJourneyAggregate({
        organizationId: "local",
        projectId: "project-a",
        journeyId: "journey-a",
        recipe: {
          id: "journey-a",
          title: "Journey",
          source: "custom",
          steps: [{ id: "missing", kind: "sleep", ms: 1 }],
          createdAt: 1,
          updatedAt: 1,
        },
        document: { revision: 1, value: metadata("missing"), updatedAt: 1 },
        evidence: [
          {
            id: "missing",
            kind: "screenshot",
            capturedAt: 1,
            uri: `relay-evidence://${"0".repeat(64)}`,
            sha256: "0".repeat(64),
          },
        ],
      }),
      /is not durable/,
    );
    assert.equal(await readJourneyAggregate("project-a", "journey-a"), null);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

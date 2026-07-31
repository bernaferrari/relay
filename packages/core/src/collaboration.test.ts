import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RevisionConflict } from "@relay/protocol";
import {
  leaseDevice,
  deleteCompatibilityMatrix,
  listCompatibilityMatrices,
  listDeviceLeases,
  readJourney,
  readProjectVariables,
  releaseDeviceLease,
  saveCompatibilityMatrix,
  writeJourney,
  writeProjectVariables,
} from "./collaboration.js";

test("revisioned project data detects conflicts and preserves idempotency", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-state-"));
  const previous = process.env.GROK_DEVICE_STATE_DIR;
  process.env.GROK_DEVICE_STATE_DIR = root;
  try {
    const initial = await readProjectVariables("project-a");
    const first = await writeProjectVariables("project-a", {
      expectedRevision: initial.revision,
      value: [
        {
          id: "email",
          name: "email",
          source: "static",
          values: ["qa@example.com"],
          fallback: "qa@example.com",
        },
      ],
      idempotencyKey: "once",
    });
    assert.equal(first.revision, 1);
    const repeated = await writeProjectVariables("project-a", {
      expectedRevision: 0,
      value: [],
      idempotencyKey: "once",
    });
    assert.equal(repeated.revision, first.revision);
    assert.deepEqual(repeated.value, first.value);
    assert.equal(repeated.updatedAt, first.updatedAt);
    await assert.rejects(
      writeProjectVariables("project-a", { expectedRevision: 0, value: [] }),
      (error) => error instanceof RevisionConflict && error.current.revision === 1,
    );

    const journey = await writeJourney("project-a", "login", {
      expectedRevision: 0,
      value: {
        schemaVersion: 6,
        positions: { first: { x: 12, y: 24 } },
        edgeLabels: { "first:second": "Continue" },
        edgeKinds: { "first:second": "flow" },
        notes: [
          {
            id: "note-1",
            text: "Keep this branch independent",
            x: 44,
            y: 52,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        takes: [
          {
            id: "take-1",
            recipeId: "login",
            startedAt: 1,
            group: "Sign in",
            state: "review",
            steps: [{ kind: "key", key: "home" }],
          },
        ],
        review: { state: "needs-review", updatedAt: 2 },
        graph: {
          schemaVersion: 1,
          screens: [
            { id: "start", title: "Start", createdAt: 1, updatedAt: 1 },
            {
              id: "settings",
              title: "Settings",
              representativeStepId: "open-settings",
              createdAt: 2,
              updatedAt: 2,
            },
          ],
          transitions: [
            {
              id: "open-settings",
              fromScreenId: "start",
              destination: { kind: "screen", screenId: "settings" },
              stepIds: ["open-settings"],
              state: "recorded",
              kind: "forward",
              createdAt: 2,
              updatedAt: 2,
            },
          ],
          flows: [{ id: "main", name: "Main flow", screenId: "start", createdAt: 1, updatedAt: 1 }],
        },
      },
    });
    assert.equal(journey.revision, 1);
    assert.deepEqual((await readJourney("project-a", "login")).value.positions.first, {
      x: 12,
      y: 24,
    });
    assert.equal((await readJourney("project-a", "login")).value.takes?.[0]?.state, "review");
    assert.equal((await readJourney("project-a", "login")).value.review?.state, "needs-review");
    assert.equal((await readJourney("project-a", "login")).value.graph?.transitions[0]?.id, "open-settings");
  } finally {
    if (previous === undefined) delete process.env.GROK_DEVICE_STATE_DIR;
    else process.env.GROK_DEVICE_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("device leases enforce exclusive ownership and release lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-leases-"));
  const previous = process.env.GROK_DEVICE_STATE_DIR;
  process.env.GROK_DEVICE_STATE_DIR = root;
  try {
    const lease = await leaseDevice({
      projectId: "p",
      poolId: "android",
      deviceSerial: "ABC",
      ownerId: "worker-1",
      expiresAt: Date.now() + 60_000,
    });
    await assert.rejects(
      leaseDevice({
        projectId: "p",
        poolId: "android",
        deviceSerial: "ABC",
        ownerId: "worker-2",
        expiresAt: Date.now() + 60_000,
      }),
      /already leased/,
    );
    assert.equal((await releaseDeviceLease(lease.id)).status, "released");
    assert.equal((await listDeviceLeases("p"))[0]?.status, "released");
  } finally {
    if (previous === undefined) delete process.env.GROK_DEVICE_STATE_DIR;
    else process.env.GROK_DEVICE_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("compatibility matrices have project-scoped CRUD", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-matrices-"));
  const previous = process.env.GROK_DEVICE_STATE_DIR;
  process.env.GROK_DEVICE_STATE_DIR = root;
  try {
    const created = await saveCompatibilityMatrix({
      id: "release",
      projectId: "p",
      name: "Release",
      selectors: [{ platforms: ["browser"] }],
    });
    assert.equal(created.name, "Release");
    const updated = await saveCompatibilityMatrix({
      ...created,
      name: "Release smoke",
      selectors: [{ platforms: ["android"], requiredCapabilities: ["lock-screen"] }],
    });
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal((await listCompatibilityMatrices("p"))[0]?.name, "Release smoke");
    await deleteCompatibilityMatrix("p", "release");
    assert.deepEqual(await listCompatibilityMatrices("p"), []);
  } finally {
    if (previous === undefined) delete process.env.GROK_DEVICE_STATE_DIR;
    else process.env.GROK_DEVICE_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

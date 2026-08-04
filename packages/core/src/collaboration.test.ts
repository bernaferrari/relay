import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RevisionConflict } from "@relay/protocol";
import {
  createAppMap,
  deleteAppMap,
  duplicateAppMap,
  leaseDevice,
  deleteCompatibilityMatrix,
  listCompatibilityMatrices,
  listAppMaps,
  listDeviceLeases,
  readAppMap,
  readProjectVariables,
  releaseDeviceLease,
  takeOverDeviceLease,
  saveCompatibilityMatrix,
  mutateStoredAppMap,
  writeProjectVariables,
} from "./collaboration.js";
import { addAppMapScreen } from "./app-map.js";

test("App Maps persist normalized revisions and reject unsafe stored mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-maps-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    const created = await createAppMap({
      organizationId: "acme",
      projectId: "mobile",
      appMapId: "store",
      name: "Store",
      at: 100,
    });
    assert.equal(created.revision, 0);
    assert.deepEqual(
      (await listAppMaps("mobile")).map((map) => map.id),
      ["store"],
    );

    const saved = await mutateStoredAppMap("mobile", "store", (map) =>
      addAppMapScreen(
        map,
        {
          screen: {
            id: "welcome",
            organizationId: "acme",
            projectId: "mobile",
            appMapId: "store",
            title: "Welcome",
            variantIds: [],
            createdAt: 101,
            updatedAt: 101,
          },
        },
        {
          expectedRevision: 0,
          eventId: "event-add-welcome",
          actorId: "agent:mapper",
          actorKind: "agent",
          at: 101,
        },
      ),
    );
    assert.equal(saved.revision, 1);
    assert.equal(saved.screens.welcome?.title, "Welcome");
    assert.equal(saved.activity["event-add-welcome"]?.actorKind, "agent");
    assert.equal((await readAppMap("mobile", "store"))?.revision, 1);

    const copy = await duplicateAppMap({
      organizationId: "acme",
      projectId: "mobile",
      sourceAppMapId: "store",
      appMapId: "store-copy",
      name: "Store copy",
      at: 200,
    });
    assert.equal(copy.name, "Store copy");
    assert.equal(copy.revision, 0);
    assert.equal(copy.screens.welcome?.appMapId, "store-copy");
    assert.equal(copy.screens.welcome?.createdAt, 200);
    assert.deepEqual(copy.activity, {});
    assert.equal(saved.screens.welcome?.appMapId, "store");

    await assert.rejects(
      mutateStoredAppMap("mobile", "store", (map) => ({ ...map, projectId: "other" })),
      /scope/u,
    );
    await assert.rejects(
      mutateStoredAppMap("mobile", "store", (map) => ({ ...map, revision: map.revision + 2 })),
      /exactly one revision/u,
    );
    assert.equal(await deleteAppMap("mobile", "store"), true);
    assert.equal(await deleteAppMap("mobile", "store-copy"), true);
    assert.equal(await readAppMap("mobile", "store"), null);
    assert.equal(await deleteAppMap("mobile", "store"), false);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("revisioned project data detects conflicts and preserves idempotency", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-state-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    const initial = await readProjectVariables("project-a");
    const first = await writeProjectVariables("project-a", {
      expectedRevision: initial.revision,
      value: [
        {
          id: "email",
          name: "email",
          scope: "shared",
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
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("device leases enforce exclusive ownership and release lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-leases-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
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
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("device lease takeover is explicit, atomic, and preserves handoff provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-lease-takeover-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    const original = await leaseDevice({
      projectId: "p",
      poolId: "local",
      deviceSerial: "ABC",
      ownerId: "human:owner",
      expiresAt: Date.now() + 60_000,
    });
    await assert.rejects(
      takeOverDeviceLease(original.id, {
        projectId: "p",
        ownerId: "agent:mapper",
        expiresAt: Date.now() + 60_000,
        reason: "  ",
      }),
      /reason is required/u,
    );

    const next = await takeOverDeviceLease(original.id, {
      projectId: "p",
      ownerId: "agent:mapper",
      expiresAt: Date.now() + 120_000,
      reason: "User delegated this unattended run",
    });
    assert.equal(next.ownerId, "agent:mapper");
    assert.equal(next.handoffFromLeaseId, original.id);
    assert.equal(next.handoffReason, "User delegated this unattended run");
    const history = await listDeviceLeases("p");
    assert.equal(history.find((lease) => lease.id === original.id)?.status, "released");
    assert.equal(history.find((lease) => lease.id === next.id)?.status, "leased");
    await assert.rejects(
      takeOverDeviceLease(original.id, {
        projectId: "p",
        ownerId: "agent:other",
        expiresAt: Date.now() + 120_000,
        reason: "Stale takeover",
      }),
      /Active device lease not found/u,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("compatibility matrices have project-scoped CRUD", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-matrices-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
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
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

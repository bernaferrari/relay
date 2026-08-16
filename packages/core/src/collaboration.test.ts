import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RevisionConflict } from "@relay/protocol";
import {
  createAppMap,
  deleteAppMap,
  duplicateAppMap,
  isDeviceLeaseClaimActive,
  leaseDevice,
  listBuilds,
  deleteCompatibilityMatrix,
  listCompatibilityMatrices,
  listAppMaps,
  listAppMapCatalog,
  listDevicePools,
  listDeviceLeases,
  listProjects,
  readAppMap,
  readProjectVariables,
  releaseDeviceLease,
  renewDeviceLease,
  saveBuild,
  takeOverDeviceLease,
  saveDevicePool,
  saveCompatibilityMatrix,
  mutateStoredAppMap,
  writeProjectVariables,
  recoverCollaborationState,
} from "./collaboration.js";
import { addAppMapScreen } from "./app-map.js";

async function withStateRoot<T>(
  prefix: string,
  operation: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    return await operation(root);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("missing state initializes safely and valid mutations retain a last-known-good backup", async () => {
  await withStateRoot("relay-state-backup-", async (root) => {
    assert.equal((await listProjects("local"))[0]?.id, "default");
    await saveBuild({
      id: "debug",
      projectId: "p",
      name: "Debug",
      platform: "android",
      status: "ready",
    });
    const path = join(root, "collaboration.json");
    const first = await readFile(path, "utf8");
    await saveBuild({
      id: "release",
      projectId: "p",
      name: "Release",
      platform: "ios",
      status: "ready",
    });
    assert.equal(await readFile(`${path}.bak`, "utf8"), first);
  });
});

test("invalid collaboration state rejects reads and mutations without changing original bytes", async () => {
  await withStateRoot("relay-state-corrupt-", async (root) => {
    const path = join(root, "collaboration.json");
    const invalidStates = [
      '{"projects":',
      "[]",
      JSON.stringify({ projects: {} }),
      JSON.stringify({ builds: ["not-a-build"] }),
    ];
    for (const source of invalidStates) {
      await writeFile(path, source, "utf8");
      await assert.rejects(listProjects("local"));
      await assert.rejects(
        saveBuild({
          id: "must-not-write",
          projectId: "p",
          name: "Unsafe",
          platform: "android",
          status: "ready",
        }),
      );
      assert.equal(await readFile(path, "utf8"), source);
    }
  });
});

test(
  "non-file collaboration read failures reject without recovery writes",
  { skip: process.platform === "win32" },
  async () => {
    await withStateRoot("relay-state-read-failure-", async (root) => {
      const path = join(root, "collaboration.json");
      await mkdir(path);
      await assert.rejects(listProjects("local"));
      await assert.rejects(
        saveBuild({
          id: "must-not-write",
          projectId: "p",
          name: "Unsafe",
          platform: "android",
          status: "ready",
        }),
      );
      assert.equal((await stat(path)).isDirectory(), true);
    });
  },
);

test("build and device-pool IDs are isolated by project", async () => {
  await withStateRoot("relay-state-project-keys-", async () => {
    const firstBuild = await saveBuild({
      id: "debug",
      projectId: "one",
      name: "One debug",
      platform: "android",
      status: "ready",
    });
    const secondBuild = await saveBuild({
      id: "debug",
      projectId: "two",
      name: "Two debug",
      platform: "ios",
      status: "ready",
    });
    assert.equal((await listBuilds("one"))[0]?.name, "One debug");
    assert.equal((await listBuilds("two"))[0]?.name, "Two debug");
    const updatedFirstBuild = await saveBuild({
      id: "debug",
      projectId: "one",
      name: "One debug updated",
      platform: "android",
      status: "ready",
    });
    assert.equal(updatedFirstBuild.createdAt, firstBuild.createdAt);
    assert.equal((await listBuilds("one"))[0]?.name, "One debug updated");
    assert.equal((await listBuilds("two"))[0]?.name, secondBuild.name);

    const firstPool = await saveDevicePool({
      id: "local",
      projectId: "one",
      name: "One pool",
      platform: "android",
      deviceSerials: ["A"],
    });
    const secondPool = await saveDevicePool({
      id: "local",
      projectId: "two",
      name: "Two pool",
      platform: "ios",
      deviceSerials: ["B"],
    });
    assert.equal((await listDevicePools("one"))[0]?.name, "One pool");
    assert.equal((await listDevicePools("two"))[0]?.name, "Two pool");
    const updatedFirstPool = await saveDevicePool({
      id: "local",
      projectId: "one",
      name: "One pool updated",
      platform: "android",
      deviceSerials: ["A", "C"],
    });
    assert.equal(updatedFirstPool.createdAt, firstPool.createdAt);
    assert.deepEqual((await listDevicePools("one"))[0]?.deviceSerials, ["A", "C"]);
    assert.equal((await listDevicePools("two"))[0]?.name, secondPool.name);
  });
});

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
    const claim = {
      projectId: "p",
      deviceSerial: "ABC",
      ownerId: "worker-1",
      leaseId: lease.id,
    };
    assert.equal(await isDeviceLeaseClaimActive(claim), true);
    assert.equal(await isDeviceLeaseClaimActive(claim, lease.expiresAt), false);
    assert.equal(await isDeviceLeaseClaimActive({ ...claim, projectId: "other-project" }), false);
    assert.equal(await isDeviceLeaseClaimActive({ ...claim, deviceSerial: "other-target" }), false);
    assert.equal(await isDeviceLeaseClaimActive({ ...claim, ownerId: "other-owner" }), false);
    const sameActorDifferentLease = await leaseDevice({
      projectId: "p",
      poolId: "android",
      deviceSerial: "XYZ",
      ownerId: "worker-1",
      expiresAt: Date.now() + 60_000,
    });
    assert.equal(
      await isDeviceLeaseClaimActive({ ...claim, leaseId: sameActorDifferentLease.id }),
      false,
    );
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
    assert.equal(await isDeviceLeaseClaimActive(claim), false);
    assert.equal((await listDeviceLeases("p"))[0]?.status, "released");
    const again = await leaseDevice({
      projectId: "p",
      poolId: "android",
      deviceSerial: "ABC",
      ownerId: "worker-1",
      expiresAt: Date.now() + 60_000,
    });
    const later = Date.now() + 120_000;
    assert.equal((await renewDeviceLease(again.id, later)).expiresAt, later);
    assert.equal(await isDeviceLeaseClaimActive({ ...claim, leaseId: again.id }), true);
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
      organizationId: "org-a",
      projectId: "p",
      poolId: "local",
      deviceSerial: "ABC",
      ownerId: "human:owner",
      expiresAt: Date.now() + 60_000,
    });
    await assert.rejects(
      takeOverDeviceLease(original.id, {
        organizationId: "org-b",
        projectId: "p",
        ownerId: "agent:other-org",
        expiresAt: Date.now() + 60_000,
        reason: "Cross-organization takeover",
      }),
      /Active device lease not found/u,
    );
    await assert.rejects(
      takeOverDeviceLease(original.id, {
        organizationId: "org-a",
        projectId: "p",
        ownerId: "agent:mapper",
        expiresAt: Date.now() + 60_000,
        reason: "  ",
      }),
      /reason is required/u,
    );

    const next = await takeOverDeviceLease(original.id, {
      organizationId: "org-a",
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
    assert.equal(
      await isDeviceLeaseClaimActive({
        projectId: "p",
        deviceSerial: "ABC",
        ownerId: "human:owner",
        leaseId: original.id,
      }),
      false,
    );
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

test("one unreadable App Map does not take down the collection", async () => {
  await withStateRoot("relay-state-degraded-map-", async (root) => {
    const healthy = await createAppMap({
      organizationId: "acme",
      projectId: "mobile",
      appMapId: "store",
      name: "Store",
      at: 100,
    });
    const path = join(root, "collaboration.json");
    const state = JSON.parse(await readFile(path, "utf8")) as {
      appMaps: Record<string, Record<string, unknown>>;
    };
    state.appMaps["mobile:broken"] = { schemaVersion: 1 };
    state.appMaps["mobile:store"] = {
      ...state.appMaps["mobile:store"],
      tests: {
        smoke: {
          id: "smoke",
          organizationId: "acme",
          projectId: "mobile",
          appMapId: "store",
          name: "Smoke",
          kind: "scenario",
          intentSchemaVersion: 1,
          steps: [
            {
              id: "launch",
              kind: "instruction",
              intent: "Launch home",
              cleanup: { kind: "home" },
              binding: { status: "unresolved", reason: "not mapped yet" },
            },
          ],
          createdAt: 100,
          updatedAt: 100,
        },
      },
    };
    await writeFile(path, JSON.stringify(state), "utf8");

    const catalog = await listAppMapCatalog("mobile");
    assert.deepEqual(
      catalog.appMaps.map((map) => map.id),
      [healthy.id],
    );
    const step = catalog.appMaps[0]?.tests.smoke?.steps[0];
    assert.equal(Boolean(step && "cleanup" in step), false);
    assert.equal(catalog.degraded?.length, 1);
    assert.equal(catalog.degraded?.[0]?.key, "mobile:broken");
  });
});

test("unreadable JSON falls back to the last-known-good backup", async () => {
  await withStateRoot("relay-state-backup-recover-", async (root) => {
    await createAppMap({
      organizationId: "acme",
      projectId: "mobile",
      appMapId: "store",
      name: "Store",
      at: 100,
    });
    const path = join(root, "collaboration.json");
    const good = await readFile(path, "utf8");
    await writeFile(`${path}.bak`, good, "utf8");
    await writeFile(path, '{"projects":', "utf8");
    const listed = await listAppMaps("mobile");
    assert.deepEqual(
      listed.map((map) => map.id),
      ["store"],
    );
    const recovered = await recoverCollaborationState();
    assert.equal(recovered.recoveredFromBackup, true);
    JSON.parse(await readFile(path, "utf8"));
  });
});

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  readAppMapRecoveryDocument,
  listDevicePools,
  listDeviceLeases,
  listDurableControlEvents,
  listProjects,
  readAppMap,
  readProjectVariables,
  releaseDeviceLease,
  renewDeviceLease,
  resetControlDatabaseCache,
  saveBuild,
  takeOverDeviceLease,
  saveDevicePool,
  saveCompatibilityMatrix,
  mutateStoredAppMap,
  writeProjectVariables,
  recoverCollaborationState,
} from "./collaboration.js";
import { addAppMapScreen, APP_MAP_SCHEMA_VERSION } from "./app-map.js";
import {
  CONTROL_DB_NAME,
  CONTROL_SCHEMA_VERSION,
  openControlDatabase,
  pruneControlEvents,
} from "./collaboration-db.js";
import { publish, subscribe } from "./events.js";
import { readControlStore, withControlStore } from "./collaboration-store.js";

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
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function controlDb(root: string): DatabaseSync {
  return new DatabaseSync(join(root, CONTROL_DB_NAME));
}

function appMapDocument(root: string, key: string): string {
  const db = controlDb(root);
  try {
    const row = db.prepare("SELECT document FROM app_maps WHERE map_key = ?").get(key) as
      | { document: string }
      | undefined;
    if (!row) throw new Error(`missing App Map ${key}`);
    return row.document;
  } finally {
    db.close();
  }
}

function sampleStoredAppMap(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: APP_MAP_SCHEMA_VERSION,
    id: "store",
    organizationId: "acme",
    projectId: "mobile",
    name: "Store",
    revision: 0,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

test("missing state initializes safely and valid mutations persist in SQLite", async () => {
  await withStateRoot("relay-state-backup-", async (root) => {
    assert.equal((await listProjects("local"))[0]?.id, "default");
    await saveBuild({
      id: "debug",
      projectId: "p",
      name: "Debug",
      platform: "android",
      status: "ready",
    });
    await stat(join(root, "control.sqlite"));
    await saveBuild({
      id: "release",
      projectId: "p",
      name: "Release",
      platform: "ios",
      status: "ready",
    });
    assert.deepEqual((await listBuilds("p")).map((build) => build.id).sort(), ["debug", "release"]);
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
      assert.equal(existsSync(join(root, CONTROL_DB_NAME)), false);
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
      assert.equal(existsSync(join(root, CONTROL_DB_NAME)), false);
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
    resetControlDatabaseCache();
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
    resetControlDatabaseCache();
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
    resetControlDatabaseCache();
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
    resetControlDatabaseCache();
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
    resetControlDatabaseCache();
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
    const db = controlDb(root);
    try {
      const current = JSON.parse(appMapDocument(root, "mobile:store")) as Record<string, unknown>;
      db.prepare("UPDATE app_maps SET document = ? WHERE map_key = ?").run(
        JSON.stringify({
          ...current,
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
        }),
        "mobile:store",
      );
      db.prepare(
        `INSERT INTO app_maps(map_key, project_id, app_map_id, status, error, document, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "mobile:broken",
        "mobile",
        "broken",
        "ok",
        null,
        JSON.stringify({ schemaVersion: 1 }),
        100,
      );
    } finally {
      db.close();
    }

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

test("unreadable JSON falls back to the last-known-good backup before SQLite exists", async () => {
  await withStateRoot("relay-state-backup-recover-", async (root) => {
    const path = join(root, "collaboration.json");
    const good = JSON.stringify({
      projects: [
        {
          id: "default",
          organizationId: "local",
          name: "Mobile QA",
          createdAt: 100,
          updatedAt: 100,
        },
      ],
      appMaps: { "mobile:store": sampleStoredAppMap() },
    });
    await writeFile(`${path}.bak`, good, "utf8");
    await writeFile(path, '{"projects":', "utf8");
    const listed = await listAppMaps("mobile");
    assert.deepEqual(
      listed.map((map) => map.id),
      ["store"],
    );
    const recovered = await recoverCollaborationState();
    assert.equal(recovered.recoveredFromBackup, true);
    await stat(join(root, CONTROL_DB_NAME));
  });
});

test("legacy collaboration.json migrates into SQLite once", async () => {
  await withStateRoot("relay-state-json-migrate-", async (root) => {
    const path = join(root, "collaboration.json");
    await writeFile(
      path,
      JSON.stringify({
        projects: [
          {
            id: "default",
            organizationId: "local",
            name: "Mobile QA",
            createdAt: 100,
            updatedAt: 100,
          },
        ],
        appMaps: { "mobile:store": sampleStoredAppMap() },
      }),
      "utf8",
    );
    assert.deepEqual(
      (await listAppMaps("mobile")).map((map) => map.id),
      ["store"],
    );
    assert.equal(existsSync(path), false);
    await stat(`${path}.migrated`);
    await stat(join(root, CONTROL_DB_NAME));
    assert.deepEqual(
      (await listAppMaps("mobile")).map((map) => map.id),
      ["store"],
    );
  });
});

test("unversioned App Map JSON migrates while retaining its original source document", async () => {
  await withStateRoot("relay-state-app-map-legacy-source-", async (root) => {
    const legacy = sampleStoredAppMap();
    delete legacy.schemaVersion;
    await writeFile(
      join(root, "collaboration.json"),
      JSON.stringify({
        projects: [
          {
            id: "default",
            organizationId: "local",
            name: "Mobile QA",
            createdAt: 100,
            updatedAt: 100,
          },
        ],
        appMaps: { "mobile:store": legacy },
      }),
      "utf8",
    );

    assert.deepEqual(
      (await listAppMaps("mobile")).map((map) => map.id),
      ["store"],
    );
    const db = controlDb(root);
    try {
      const row = db
        .prepare("SELECT document, source_document, disposition FROM app_maps WHERE map_key = ?")
        .get("mobile:store") as
        | { document: string; source_document?: string | null; disposition?: string }
        | undefined;
      assert.ok(row);
      assert.equal((JSON.parse(row.document) as { schemaVersion: number }).schemaVersion, 1);
      assert.deepEqual(JSON.parse(row.source_document ?? "null"), legacy);
      assert.equal(row.disposition, "migrated");
    } finally {
      db.close();
    }
  });
});

test("newer App Map JSON is quarantined as read-only without losing its source", async () => {
  await withStateRoot("relay-state-app-map-future-source-", async (root) => {
    const future = sampleStoredAppMap({ schemaVersion: APP_MAP_SCHEMA_VERSION + 1, future: true });
    await writeFile(
      join(root, "collaboration.json"),
      JSON.stringify({ appMaps: { "mobile:store": future } }),
      "utf8",
    );

    const catalog = await listAppMapCatalog("mobile");
    assert.deepEqual(catalog.appMaps, []);
    assert.equal(catalog.degraded?.[0]?.key, "mobile:store");
    assert.equal(catalog.degraded?.[0]?.disposition, "read-only");
    assert.deepEqual(await readAppMapRecoveryDocument("mobile", "store"), {
      document: JSON.stringify(future),
      disposition: "read-only",
    });
    const db = controlDb(root);
    try {
      const row = db
        .prepare(
          "SELECT status, document, source_document, disposition FROM app_maps WHERE map_key = ?",
        )
        .get("mobile:store") as
        | {
            status: string;
            document: string;
            source_document?: string | null;
            disposition?: string;
          }
        | undefined;
      assert.ok(row);
      assert.equal(row.status, "degraded");
      assert.equal(row.disposition, "read-only");
      assert.deepEqual(JSON.parse(row.document), future);
      assert.deepEqual(JSON.parse(row.source_document ?? "null"), future);
    } finally {
      db.close();
    }
  });
});

test("resumes a partially applied App Map recovery-column migration", async () => {
  await withStateRoot("relay-state-app-map-column-recovery-", async (root) => {
    const path = join(root, CONTROL_DB_NAME);
    const interrupted = new DatabaseSync(path);
    const original = JSON.stringify(sampleStoredAppMap());
    try {
      interrupted.exec(`
        CREATE TABLE app_maps (
          map_key TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          app_map_id TEXT NOT NULL,
          status TEXT NOT NULL,
          error TEXT,
          document TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        ALTER TABLE app_maps ADD COLUMN source_document TEXT;
        PRAGMA user_version = 4;
      `);
      interrupted
        .prepare(
          `INSERT INTO app_maps(
            map_key, project_id, app_map_id, status, error, document, source_document, updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("mobile:store", "mobile", "store", "ok", null, original, null, 100);
    } finally {
      interrupted.close();
    }

    const resumed = openControlDatabase(path);
    try {
      const columns = resumed.prepare("PRAGMA table_info(app_maps)").all() as Array<{
        name: string;
      }>;
      assert.equal(
        columns.some((column) => column.name === "source_document"),
        true,
      );
      assert.equal(
        columns.some((column) => column.name === "disposition"),
        true,
      );
      const version = resumed.prepare("PRAGMA user_version").get() as { user_version: number };
      assert.equal(version.user_version, CONTROL_SCHEMA_VERSION);
      const row = resumed
        .prepare("SELECT document, source_document, disposition FROM app_maps WHERE map_key = ?")
        .get("mobile:store") as
        | { document: string; source_document?: string | null; disposition?: string }
        | undefined;
      assert.ok(row);
      assert.equal(row.document, original);
      assert.equal(row.source_document, null);
      assert.equal(row.disposition, "ready");
    } finally {
      resumed.close();
    }
  });
});

test("renewing a lease does not rewrite App Map documents", async () => {
  await withStateRoot("relay-state-lease-isolation-", async (root) => {
    await createAppMap({
      organizationId: "acme",
      projectId: "mobile",
      appMapId: "store",
      name: "Store",
      at: 100,
    });
    const before = appMapDocument(root, "mobile:store");
    const lease = await leaseDevice({
      projectId: "p",
      poolId: "android",
      deviceSerial: "ABC",
      ownerId: "worker-1",
      expiresAt: Date.now() + 60_000,
    });
    await renewDeviceLease(lease.id, Date.now() + 120_000);
    assert.equal(appMapDocument(root, "mobile:store"), before);
  });
});

test("control writes notify subscribers only after COMMIT", async () => {
  await withStateRoot("relay-state-after-commit-", async () => {
    const seen: string[] = [];
    const unsubscribe = subscribe((event) => {
      if (event.payload.type === "lease.changed") seen.push(event.payload.resourceId);
    });
    try {
      await assert.rejects(
        withControlStore(() => {
          publish({
            type: "lease.changed",
            at: Date.now(),
            projectId: "p",
            resource: "lease",
            resourceId: "rolled-back",
          });
          throw new Error("boom");
        }),
        /boom/u,
      );
      assert.deepEqual(seen, []);
      await leaseDevice({
        projectId: "p",
        poolId: "android",
        deviceSerial: "ABC",
        ownerId: "worker-1",
        expiresAt: Date.now() + 60_000,
      });
      assert.equal(seen.length, 1);
    } finally {
      unsubscribe();
    }
  });
});

test("subscribers can start another control write after COMMIT", async () => {
  await withStateRoot("relay-state-reenter-write-", async () => {
    let nested = Promise.resolve();
    const unsubscribe = subscribe((event) => {
      if (event.payload.type !== "lease.changed") return;
      nested = withControlStore((store) => {
        store.seedDefaultProject();
      });
    });
    try {
      await leaseDevice({
        projectId: "p",
        poolId: "android",
        deviceSerial: "ABC",
        ownerId: "worker-1",
        expiresAt: Date.now() + 60_000,
      });
      await Promise.race([
        nested,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("writer gate deadlock")), 2_000);
        }),
      ]);
    } finally {
      unsubscribe();
    }
  });
});

test("durable control events survive for later sync and skip presence", async () => {
  await withStateRoot("relay-state-control-events-", async (root) => {
    const lease = await leaseDevice({
      projectId: "p",
      poolId: "android",
      deviceSerial: "ABC",
      ownerId: "worker-1",
      expiresAt: Date.now() + 60_000,
    });
    publish({
      type: "resource.updated",
      at: Date.now(),
      projectId: "p",
      resource: "presence",
      resourceId: "agent:mapper",
    });
    const events = await listDurableControlEvents();
    assert.equal(
      events.some((event) => event.resourceId === lease.id && event.type === "lease.changed"),
      true,
    );
    assert.equal(
      events.some((event) => event.resource === "presence"),
      false,
    );
    const db = controlDb(root);
    try {
      const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
      assert.equal(Number(version.user_version), CONTROL_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});

test("control reads skip the writer gate after COMMIT", async () => {
  await withStateRoot("relay-state-control-read-", async () => {
    let nestedCount = Promise.resolve(0);
    const unsubscribe = subscribe((event) => {
      if (event.payload.type !== "lease.changed") return;
      nestedCount = readControlStore((store) => store.leases("p").length);
    });
    try {
      await leaseDevice({
        projectId: "p",
        poolId: "android",
        deviceSerial: "ABC",
        ownerId: "worker-1",
        expiresAt: Date.now() + 60_000,
      });
      assert.equal(await nestedCount, 1);
    } finally {
      unsubscribe();
    }
  });
});

test("control event log keeps a bounded newest window", async () => {
  await withStateRoot("relay-state-event-bound-", async (root) => {
    await leaseDevice({
      projectId: "p",
      poolId: "android",
      deviceSerial: "ABC",
      ownerId: "worker-1",
      expiresAt: Date.now() + 60_000,
    });
    resetControlDatabaseCache();
    const db = controlDb(root);
    try {
      for (let index = 0; index < 8; index += 1) {
        db.prepare(
          `INSERT INTO control_events(id, at, project_id, type, payload) VALUES(?, ?, ?, ?, ?)`,
        ).run(`extra-${index}`, index, "p", "test", "{}");
      }
      pruneControlEvents(db, 3);
      const count = db.prepare("SELECT COUNT(*) AS n FROM control_events").get() as { n: number };
      const newest = db
        .prepare("SELECT id FROM control_events ORDER BY seq DESC LIMIT 1")
        .get() as { id: string };
      assert.equal(Number(count.n), 3);
      assert.equal(newest.id, "extra-7");
    } finally {
      db.close();
    }
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAppMap, readAppMap, resetControlDatabaseCache } from "./collaboration.js";
import { readTarget, saveBrowserTarget } from "./targets.js";
import {
  LANE_FIXTURE_PERSIST_ERROR,
  LANE_UNSIGNED_PROFILE_ERROR,
  assertLaneDoesNotPersistAuthFixture,
  laneFixtureReference,
  laneToProfileTarget,
  listLanes,
  readLane,
  removeLane,
  resolveLaneExecution,
  saveLane,
} from "./lane.js";

const fixtureAccount = {
  kind: "fixture" as const,
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  accountRevision: "1",
  reference: "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1",
};

const uniqueProfileId = "browser:shop-web-1280x800-lab";

async function withStateRoot<T>(operation: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "relay-lanes-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    return await operation(root);
  } finally {
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
}

test("laneFixtureReference prefers the explicit overlay reference", () => {
  assert.equal(laneFixtureReference({ account: fixtureAccount }), fixtureAccount.reference);
  assert.equal(
    laneFixtureReference({
      account: { kind: "fixture", accountId: fixtureAccount.accountId, accountRevision: "2" },
    }),
    "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:2",
  );
  assert.equal(
    laneFixtureReference({ account: { kind: "signed-out", attested: true } }),
    undefined,
  );
});

test("a Lane fixture must never become the next saved authenticationFixtureId", () => {
  assert.throws(
    () =>
      assertLaneDoesNotPersistAuthFixture({
        lane: { account: fixtureAccount },
        nextAuthenticationFixtureId: fixtureAccount.reference,
      }),
    new RegExp(LANE_FIXTURE_PERSIST_ERROR),
  );
  assert.doesNotThrow(() =>
    assertLaneDoesNotPersistAuthFixture({
      lane: { account: fixtureAccount },
      nextAuthenticationFixtureId: undefined,
    }),
  );
  assert.doesNotThrow(() =>
    assertLaneDoesNotPersistAuthFixture({
      lane: { account: { kind: "signed-out", attested: true } },
      nextAuthenticationFixtureId: fixtureAccount.reference,
    }),
  );
});

test("laneToProfileTarget is one Combine profileTargets entry", () => {
  assert.deepEqual(
    laneToProfileTarget({
      id: "shop-lab",
      appMapId: "shop-web",
      target: { kind: "browser", browserTargetId: "shop-web" },
      targetProfileId: uniqueProfileId,
      engine: "chromium",
      account: fixtureAccount,
    }),
    {
      profileId: "shop-web",
      targetProfileId: uniqueProfileId,
      engine: "chromium",
      account: fixtureAccount,
      target: { targetKind: "browser", browserTargetId: "shop-web", platform: "browser" },
    },
  );
});

test("save, list, remove, and resolve a unique-profile fixture Lane without writing the environment", async () => {
  await withStateRoot(async () => {
    const created = await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "shop-web",
      name: "Shop",
      at: 10,
    });
    const lane = await saveLane({
      projectId: "default",
      id: "shop-lab",
      appMapId: "shop-web",
      target: { kind: "browser", browserTargetId: "shop-web" },
      targetProfileId: uniqueProfileId,
      engine: "chromium",
      account: fixtureAccount,
      actorId: "human:lab",
      capture: { mode: "every-screen" },
    });
    assert.equal(lane.id, "shop-lab");
    assert.equal((await listLanes("default")).length, 1);
    const resolved = await resolveLaneExecution({ projectId: "default", laneId: "shop-lab" });
    assert.equal(resolved.laneId, "shop-lab");
    assert.equal(resolved.appMapId, "shop-web");
    assert.equal(resolved.expectedRevision, created.revision);
    assert.equal(resolved.expectedRevision, (await readAppMap("default", "shop-web"))!.revision);
    assert.equal(resolved.profileTargets.length, 1);
    assert.deepEqual(resolved.profileTargets[0]?.account, fixtureAccount);
    assert.equal(resolved.targetProfileId, uniqueProfileId);
    assert.deepEqual(resolved.target, {
      kind: "browser",
      platform: "browser",
      targetId: "shop-web",
    });
    const after = await readAppMap("default", "shop-web");
    assert.deepEqual(after?.screenVariants, {});
    assert.equal(
      Object.values(after?.screenVariants ?? {}).some(
        (variant) => variant.targetProfile.browserCaseProfile?.authenticationFixtureId,
      ),
      false,
    );
    assert.equal(await removeLane("default", "shop-lab"), true);
    assert.equal(await readLane("default", "shop-lab"), null);
  });
});

test("a fixture Lane cannot bind the unsigned saved browser environment", async () => {
  await withStateRoot(async () => {
    await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "shop-web",
      name: "Shop",
    });
    await assert.rejects(
      saveLane({
        projectId: "default",
        id: "shop-poison",
        appMapId: "shop-web",
        target: { kind: "browser", browserTargetId: "shop-web" },
        targetProfileId: "browser:shop-web",
        engine: "chromium",
        account: fixtureAccount,
      }),
      new RegExp(LANE_UNSIGNED_PROFILE_ERROR),
    );
    await assert.rejects(
      saveLane({
        projectId: "default",
        id: "shop-poison",
        appMapId: "shop-web",
        target: { kind: "browser", browserTargetId: "shop-web" },
        engine: "chromium",
        account: fixtureAccount,
      }),
      new RegExp(LANE_UNSIGNED_PROFILE_ERROR),
    );
    assert.deepEqual(await listLanes("default"), []);
  });
});

test("a signed-out Lane can use the unsigned profile and still fetches revision", async () => {
  await withStateRoot(async () => {
    const created = await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "shop-web",
      name: "Shop",
    });
    const lane = await saveLane({
      projectId: "default",
      id: "shop-daily",
      appMapId: "shop-web",
      target: { kind: "browser", browserTargetId: "shop-web" },
      targetProfileId: "browser:shop-web",
      actorId: "human:local-cli",
    });
    const resolved = await resolveLaneExecution({ projectId: "default", lane });
    assert.equal(resolved.expectedRevision, created.revision);
    assert.equal(resolved.profileTargets[0]?.targetProfileId, "browser:shop-web");
    assert.equal(resolved.profileTargets[0]?.account, undefined);
  });
});

test("saving a fixture Lane leaves the managed browser environment unsigned", async () => {
  await withStateRoot(async () => {
    await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "shop-web",
      name: "Shop",
    });
    await saveBrowserTarget({
      id: "shop-web",
      name: "Shop",
      startUrl: "https://shop.example/",
    });
    await saveLane({
      projectId: "default",
      id: "shop-lab",
      appMapId: "shop-web",
      target: { kind: "browser", browserTargetId: "shop-web" },
      targetProfileId: uniqueProfileId,
      engine: "chromium",
      account: fixtureAccount,
    });
    assert.equal(
      (await readTarget("shop-web"))?.browser?.environment?.authenticationFixtureId,
      undefined,
    );
  });
});

test("a Lane fixture already on the saved browser environment is rejected", async () => {
  await withStateRoot(async () => {
    await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "shop-web",
      name: "Shop",
    });
    await saveBrowserTarget({
      id: "shop-web",
      name: "Shop",
      startUrl: "https://shop.example/",
      environment: { authenticationFixtureId: fixtureAccount.reference },
    });
    await assert.rejects(
      saveLane({
        projectId: "default",
        id: "shop-lab",
        appMapId: "shop-web",
        target: { kind: "browser", browserTargetId: "shop-web" },
        targetProfileId: uniqueProfileId,
        engine: "chromium",
        account: fixtureAccount,
      }),
      new RegExp(LANE_FIXTURE_PERSIST_ERROR),
    );
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAppMap, resetControlDatabaseCache } from "./collaboration.js";
import { saveLane } from "./lane.js";
import { applyLaneToCombineStart, applyLaneToInteract, applyLaneToTestRun } from "./lane-run.js";
import { GROK_DAILY_LANE, GROK_LAB_LANE, seedGrokLanes } from "./lane-seed.js";
import { readTarget, saveBrowserTarget } from "./targets.js";

async function withStateRoot<T>(operation: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "relay-lane-run-"));
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

test("--lane Test run fills revision and target through resolveLaneExecution", async () => {
  await withStateRoot(async () => {
    const created = await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "shop-web",
      name: "Shop",
    });
    await saveLane({
      projectId: "default",
      id: "shop-daily",
      appMapId: "shop-web",
      target: { kind: "browser", browserTargetId: "shop-web" },
      targetProfileId: "browser:shop-web",
      actorId: "human:local-cli",
    });
    const resolved = await applyLaneToTestRun("default", "shop-web", {
      appMapId: "shop-web",
      testId: "open-home",
      laneId: "shop-daily",
    });
    assert.equal(resolved.expectedRevision, created.revision);
    assert.deepEqual(resolved.target, {
      kind: "browser",
      platform: "browser",
      targetId: "shop-web",
    });
    assert.equal(resolved.targetProfileId, "browser:shop-web");
    assert.equal(resolved.laneId, "shop-daily");
  });
});

test("--lane Combine start fills one profileTargets entry through core", async () => {
  await withStateRoot(async () => {
    await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "shop-web",
      name: "Shop",
    });
    const account = {
      kind: "fixture" as const,
      accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      accountRevision: "1",
      reference: "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1",
    };
    await saveLane({
      projectId: "default",
      id: "shop-lab",
      appMapId: "shop-web",
      target: { kind: "browser", browserTargetId: "shop-web" },
      targetProfileId: "browser:shop-web-1280x800-lab",
      engine: "chromium",
      account,
      actorId: "human:lab",
    });
    const resolved = await applyLaneToCombineStart("default", {
      appMapId: "shop-web",
      combineId: "daily",
      laneId: "shop-lab",
    });
    assert.equal(resolved.browserTargetId, "shop-web");
    assert.equal(resolved.targetKind, "browser");
    assert.equal(resolved.defaultTargetProfileId, "browser:shop-web-1280x800-lab");
    assert.equal(resolved.profileTargets?.length, 1);
    assert.deepEqual(resolved.profileTargets?.[0]?.account, account);
    assert.equal(resolved.profileTargets?.[0]?.engine, "chromium");
  });
});

test("--lane interact resolves serial and fixture without a client overlay", async () => {
  await withStateRoot(async () => {
    await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "shop-web",
      name: "Shop",
    });
    await saveLane({
      projectId: "default",
      id: "shop-lab",
      appMapId: "shop-web",
      target: { kind: "browser", browserTargetId: "shop-web" },
      targetProfileId: "browser:shop-web-1280x800-lab",
      engine: "chromium",
      account: {
        kind: "fixture",
        accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        accountRevision: "1",
        reference: "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1",
      },
    });
    const resolved = await applyLaneToInteract({
      projectId: "default",
      laneId: "shop-lab",
    });
    assert.equal(resolved.serial, "shop-web");
    assert.equal(resolved.authenticationFixtureId, "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1");
    assert.equal(resolved.laneId, "shop-lab");
    assert.equal(resolved.unsignedLaneId, undefined);
  });
});

test("iOS device Lane interact keeps laneId and omits unsigned signed-out identity", async () => {
  await withStateRoot(async () => {
    await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "grok-ios",
      name: "Grok iOS",
    });
    await saveLane({
      projectId: "default",
      id: "grok-ios-daily",
      appMapId: "grok-ios",
      target: {
        kind: "device",
        serial: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
        platform: "ios",
      },
      targetProfileId: "device:db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
      actorId: "agent:cursor",
    });
    const resolved = await applyLaneToInteract({
      projectId: "default",
      laneId: "grok-ios-daily",
    });
    assert.equal(resolved.serial, "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5");
    assert.equal(resolved.laneId, "grok-ios-daily");
    assert.equal(resolved.unsignedLaneId, undefined);
    assert.equal(resolved.authenticationFixtureId, undefined);
  });
});

test("seed helper writes grok-daily, grok-auth, and grok-lab without touching grok-com fixture", async () => {
  await withStateRoot(async () => {
    await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "grok-web",
      name: "Grok",
    });
    await saveBrowserTarget({
      id: "grok-com",
      name: "Grok",
      startUrl: "https://grok.com/",
    });
    const seeded = await seedGrokLanes("default");
    assert.deepEqual(
      seeded.map((lane) => lane.id),
      [
        "grok-daily",
        "grok-daily-b",
        "grok-daily-c",
        "grok-daily-d",
        "grok-daily-e",
        "grok-daily-f",
        "grok-daily-g",
        "grok-daily-h",
        "grok-auth-email",
        "grok-auth-gmail",
        "grok-auth-x",
        "grok-auth-x-out",
        "grok-lab",
      ],
    );
    assert.equal(seeded[0]?.actorId, GROK_DAILY_LANE.actorId);
    assert.equal(seeded[1]?.targetProfileId, GROK_DAILY_LANE.targetProfileId);
    assert.equal(seeded[3]?.targetProfileId, GROK_DAILY_LANE.targetProfileId);
    assert.equal(seeded[7]?.targetProfileId, GROK_DAILY_LANE.targetProfileId);
    assert.equal(seeded[11]?.targetProfileId, GROK_DAILY_LANE.targetProfileId);
    assert.equal(seeded[12]?.targetProfileId, GROK_LAB_LANE.targetProfileId);
    assert.deepEqual(seeded[12]?.account, GROK_LAB_LANE.account);
    assert.equal(
      (await readTarget("grok-com"))?.browser?.environment?.authenticationFixtureId,
      undefined,
    );
    const daily = await applyLaneToTestRun("default", "grok-web", {
      testId: "open-home",
      laneId: "grok-daily",
    });
    assert.equal(daily.targetProfileId, "browser:grok-com");
    assert.equal(daily.account, undefined);
    const dailyB = await applyLaneToTestRun("default", "grok-web", {
      testId: "open-home",
      laneId: "grok-daily-b",
    });
    assert.equal(dailyB.targetProfileId, "browser:grok-com");
    assert.equal(dailyB.account, undefined);
    const dailyC = await applyLaneToTestRun("default", "grok-web", {
      testId: "open-home",
      laneId: "grok-daily-c",
    });
    assert.equal(dailyC.targetProfileId, "browser:grok-com");
    assert.equal(dailyC.account, undefined);
    const lab = await applyLaneToCombineStart("default", {
      appMapId: "grok-web",
      combineId: "grok-hourly",
      laneId: "grok-lab",
    });
    assert.equal(lab.defaultTargetProfileId, GROK_LAB_LANE.targetProfileId);
    assert.deepEqual(lab.profileTargets?.[0]?.account, GROK_LAB_LANE.account);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAppMap, resetControlDatabaseCache } from "../collaboration/collaboration.js";
import { saveLane } from "./lane.js";
import { applyLaneToCombineStart, applyLaneToInteract, applyLaneToTestRun } from "./lane-run.js";

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
      appMapId: "shop-ios",
      name: "Shop iOS",
    });
    await saveLane({
      projectId: "default",
      id: "shop-ios-daily",
      appMapId: "shop-ios",
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
      laneId: "shop-ios-daily",
    });
    assert.equal(resolved.serial, "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5");
    assert.equal(resolved.laneId, "shop-ios-daily");
    assert.equal(resolved.unsignedLaneId, undefined);
    assert.equal(resolved.authenticationFixtureId, undefined);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  cancelJob,
  createCombineCampaign,
  findActiveCombineCampaignForCombine,
  mutateStoredAppMap,
  readAppMap,
  resetControlDatabaseCache,
  saveBrowserTarget,
  waitForJobCompletion,
} from "@relay/core";
import { compileBrowserEnvironment, type CombineCampaign, type DeviceLease } from "@relay/protocol";
import { startServer } from "./index.js";

function lease(targetId: string): DeviceLease {
  return {
    id: `lease:${targetId}`,
    organizationId: "acme",
    projectId: "mobile",
    poolId: "local",
    deviceSerial: targetId,
    ownerId: "human:designer",
    controlScope: "local-project",
    status: "leased",
    leasedAt: 1,
    expiresAt: Date.now() + 60_000,
  };
}

async function saveUnsignedShopCombine(client: RelayClient): Promise<void> {
  const browserCaseProfile = compileBrowserEnvironment({ engine: "chromium" });
  await saveBrowserTarget({
    id: "shop-web",
    name: "Shop",
    startUrl: "https://example.test/",
    environment: browserCaseProfile,
  });
  await client.invoke("app-map.create", { appMapId: "store", name: "Store" });
  await client.invoke("app-map.screen.add", {
    appMapId: "store",
    expectedRevision: 0,
    screen: {
      id: "home",
      title: "Home",
      identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
    },
  });
  const created = await client.invoke("app-map.test.save", {
    appMapId: "store",
    testId: "script-only",
    expectedRevision: 1,
    test: {
      name: "Prepare once",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: [
        {
          id: "prepare",
          kind: "script",
          intent: "Prepare without a selector",
          binding: { status: "resolved", kind: "script", source: "return true" },
        },
      ],
    } as never,
  });
  const variableSaved = await client.invoke("app-map.variable.save", {
    appMapId: "store",
    variableId: "language",
    expectedRevision: created.appMap.revision,
    variable: {
      name: "Language",
      kind: "language",
      apply: { kind: "appLocale", app: "com.example" },
      options: [{ id: "en", label: "English" }],
    } as never,
  });
  await mutateStoredAppMap("mobile", "store", (current) => {
    const next = structuredClone(current);
    next.screenVariants["home-web"] = {
      id: "home-web",
      organizationId: next.organizationId,
      projectId: next.projectId,
      appMapId: next.id,
      screenId: "home",
      targetProfile: {
        id: "browser:shop-web",
        targetId: "shop-web",
        source: "browser",
        platform: "browser",
        name: "Shop unsigned",
        capabilities: ["snapshot"],
        observedAt: 1,
        browserCaseProfile,
      },
      observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
      evidenceIds: [],
      evidenceUris: [],
      createdAt: 1,
      updatedAt: 1,
    };
    next.screens.home!.variantIds = ["home-web"];
    next.revision = variableSaved.appMap.revision + 1;
    next.updatedAt += 1;
    return next;
  });
  const map = await readAppMap("mobile", "store");
  if (!map) throw new Error("expected store App Map");
  await client.invoke("app-map.combine.save", {
    appMapId: "store",
    combineId: "daily",
    expectedRevision: map.revision,
    combine: {
      name: "Daily",
      variableIds: ["language"],
      testIds: ["script-only"],
      selected: { language: ["en"] },
      strategy: "zip",
      cellRuntimeProfiles: [
        { testId: "script-only", values: { language: "en" }, targetProfileId: "browser:shop-web" },
      ],
    } as never,
  });
  for (const id of ["shop-daily", "shop-daily-b"] as const) {
    await client.invoke("lane.save", {
      id,
      appMapId: "store",
      target: { kind: "browser", browserTargetId: "shop-web" },
      targetProfileId: "browser:shop-web",
      actorId: "human:designer",
    });
  }
}

function startDaily(client: RelayClient, laneId: string) {
  return client.invoke("job.combine.start", {
    appMapId: "store",
    combineId: "daily",
    executionMode: "all",
    laneId,
  });
}

async function cancelStarted(result: { jobs?: Array<{ id?: string }> }): Promise<void> {
  for (const job of result.jobs ?? []) {
    if (!job.id) continue;
    cancelJob(job.id);
    await waitForJobCompletion(job.id);
  }
}

test("distinct unsigned Lanes admit the same Plan; the same Lane still 409s", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-unsigned-lane-start-"));
  const previous = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  resetControlDatabaseCache();
  let releaseFirstControl!: () => void;
  let markFirstControl!: () => void;
  const firstControl = new Promise<void>((resolve) => {
    markFirstControl = resolve;
  });
  const holdFirstControl = new Promise<void>((resolve) => {
    releaseFirstControl = resolve;
  });
  let controlCalls = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async listDevices() {
        return [];
      },
      async assertTargetControl(_scope, targetId) {
        if (!targetId) throw new Error("target id is required");
        controlCalls += 1;
        if (controlCalls === 1) {
          markFirstControl();
          await holdFirstControl;
        }
        return lease(targetId);
      },
    },
  });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:designer",
      actorKind: "human",
    });
    await saveUnsignedShopCombine(client);
    await assert.rejects(
      client.invoke("job.combine.start", {
        appMapId: "store",
        combineId: "daily",
        executionMode: "all",
        laneId: "shop-daily",
        expectedRevision: 0,
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    const first = startDaily(client, "shop-daily");
    await firstControl;
    const second = startDaily(client, "shop-daily-b");
    for (let attempt = 0; attempt < 100 && controlCalls < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(controlCalls, 2);
    releaseFirstControl();
    const results = await Promise.all([first, second]);
    const campaigns = results.map((result) => result.campaign as CombineCampaign);
    assert.deepEqual(campaigns.map((campaign) => campaign.execution?.unsignedLaneId).sort(), [
      "shop-daily",
      "shop-daily-b",
    ]);
    assert.equal(new Set(campaigns.map((campaign) => campaign.id)).size, 2);
    await assert.rejects(
      startDaily(client, "shop-daily"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code === "ACTIVE_REPEAT_EXISTS" &&
        (error.body as { repeatId?: unknown }).repeatId ===
          campaigns.find((campaign) => campaign.execution?.unsignedLaneId === "shop-daily")?.id,
    );
    for (const result of results) await cancelStarted(result);
  } finally {
    releaseFirstControl();
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

test("seeded same-lane Combine campaign 409s before a second unsigned start", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-unsigned-lane-seed-"));
  const previous = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  resetControlDatabaseCache();
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async listDevices() {
        return [];
      },
      async assertTargetControl(_scope, targetId) {
        if (!targetId) throw new Error("target id is required");
        return lease(targetId);
      },
    },
  });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:designer",
      actorKind: "human",
    });
    await saveUnsignedShopCombine(client);
    await createCombineCampaign({
      schemaVersion: 1,
      id: "already-daily",
      projectId: "mobile",
      ownerId: "human:designer",
      appMapId: "store",
      combineId: "daily",
      sourceRevision: 1,
      latestRevision: 1,
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cases: [
        {
          index: 0,
          cellId: "c" + "a".repeat(32),
          testId: "script-only",
          world: "English",
          values: { language: "en" },
          targetProfileId: "browser:shop-web",
          childIntentDigest: "a".repeat(64),
          outerIntentDigest: "b".repeat(64),
          wrapperGraphDigest: "c".repeat(64),
          staticInputDigest: "d".repeat(64),
          phase: "coverage",
          status: "queued",
        },
      ],
      lineage: [{ kind: "created", at: 10, appMapRevision: 1, actorId: "human:designer" }],
      execution: {
        selectedCellIds: ["c" + "a".repeat(32)],
        seed: 1,
        unsignedLaneId: "shop-daily",
      },
    });
    assert.equal(
      (await findActiveCombineCampaignForCombine("mobile", "store", "daily", "shop-daily"))?.id,
      "already-daily",
    );
    await assert.rejects(
      startDaily(client, "shop-daily"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown; repeatId?: unknown }).code === "ACTIVE_REPEAT_EXISTS" &&
        (error.body as { repeatId?: unknown }).repeatId === "already-daily",
    );
    const admitted = await startDaily(client, "shop-daily-b");
    assert.equal((admitted.campaign as CombineCampaign).execution?.unsignedLaneId, "shop-daily-b");
    await cancelStarted(admitted);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

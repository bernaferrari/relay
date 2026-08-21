import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  appMapCombineCellId,
  combineCampaignCaseFromPreparedCell,
  createCombineCampaign,
  enqueueJob,
  listDevices,
  mutateStoredAppMap,
  prepareAppMapCombineCells,
  readAppMap,
} from "@relay/core";
import type { CombineCampaign } from "@relay/protocol";
import { startServer } from "./index.js";
import { assertTargetControl } from "./access-control.js";

test("Combine start prepares cells offline and refuses missing bindings without discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-cell-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const calls = { listDevices: 0, assertTargetControl: 0, enqueueJob: 0 };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async listDevices() {
        calls.listDevices += 1;
        return listDevices();
      },
      async assertTargetControl(scope, targetId) {
        calls.assertTargetControl += 1;
        return assertTargetControl(scope, targetId);
      },
      enqueueJob(input) {
        calls.enqueueJob += 1;
        return enqueueJob(input);
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
        options: [
          { id: "en", label: "English" },
          { id: "it", label: "Italiano" },
        ],
      } as never,
    });
    await client.invoke("app-map.combine.save", {
      appMapId: "store",
      combineId: "locales",
      expectedRevision: variableSaved.appMap.revision,
      combine: {
        name: "Language × Prepare",
        variableIds: ["language"],
        testIds: ["script-only"],
        selected: { language: ["en", "it"] },
        strategy: "zip",
      } as never,
    });
    const jobsBefore = await client.invoke("job.list", { limit: 100 });
    await assert.rejects(
      client.invoke("job.combine.start", {
        appMapId: "store",
        combineId: "locales",
        serial: "pixel-1",
        platform: "android",
      }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code === "APP_MAP_COMBINE_CELL_CONTRACT",
    );
    const jobsAfter = await client.invoke("job.list", { limit: 100 });
    assert.equal(jobsAfter.jobs.length, jobsBefore.jobs.length);
    assert.equal(calls.listDevices, 0);
    assert.equal(calls.assertTargetControl, 0);
    assert.equal(calls.enqueueJob, 0);
    assert.equal(appMapCombineCellId("script-only", { language: "en" }).length, 33);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

async function saveLocaleCombine(client: RelayClient): Promise<void> {
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
  await client.invoke("app-map.variable.save", {
    appMapId: "store",
    variableId: "language",
    expectedRevision: created.appMap.revision,
    variable: {
      name: "Language",
      kind: "language",
      apply: { kind: "appLocale", app: "com.example" },
      options: [
        { id: "en", label: "English" },
        { id: "it", label: "Italiano" },
        { id: "fr", label: "Français" },
      ],
    } as never,
  });
  await mutateStoredAppMap("mobile", "store", (current) => {
    const next = structuredClone(current);
    const variant = (id: string, profileId: string, name: string) => ({
      id,
      organizationId: next.organizationId,
      projectId: next.projectId,
      appMapId: next.id,
      screenId: "home",
      targetProfile: {
        id: profileId,
        targetId: "pixel-1",
        source: "device" as const,
        platform: "android" as const,
        name,
        capabilities: ["snapshot" as const],
        observedAt: 1,
      },
      observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
      evidenceIds: [],
      evidenceUris: [],
      createdAt: 1,
      updatedAt: 1,
    });
    next.screenVariants["home-en"] = variant("home-en", "pixel-en", "Pixel · English");
    next.screenVariants["home-it"] = variant("home-it", "pixel-it", "Pixel · Italian");
    next.screenVariants["home-fr"] = variant("home-fr", "pixel-fr", "Pixel · French");
    next.screens.home!.variantIds = ["home-en", "home-it", "home-fr"];
    next.revision += 1;
    next.updatedAt += 1;
    return next;
  });
  const map = await readAppMap("mobile", "store");
  if (!map) throw new Error("expected store App Map");
  await client.invoke("app-map.combine.save", {
    appMapId: "store",
    combineId: "locales",
    expectedRevision: map.revision,
    combine: {
      name: "Language × Prepare",
      variableIds: ["language"],
      testIds: ["script-only"],
      selected: { language: ["en", "it", "fr"] },
      strategy: "zip",
      cellRuntimeProfiles: [
        { testId: "script-only", values: { language: "en" }, targetProfileId: "pixel-en" },
        { testId: "script-only", values: { language: "it" }, targetProfileId: "pixel-it" },
        { testId: "script-only", values: { language: "fr" }, targetProfileId: "pixel-fr" },
      ],
    } as never,
  });
}

test("campaign resume queues one pending selected cell and leaves a passed pilot untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-resume-scope-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:designer",
      actorKind: "human",
    });
    await saveLocaleCombine(client);
    const map = await readAppMap("mobile", "store");
    if (!map?.combines.locales) throw new Error("expected locales Combine");
    const prepared = await prepareAppMapCombineCells({
      map,
      combine: map.combines.locales,
      target: { targetId: "pixel-1", platform: "android" },
    });
    const byLanguage = Object.fromEntries(
      prepared.cells.map((cell) => [cell.values.language, cell]),
    );
    const english = byLanguage.en;
    const italian = byLanguage.it;
    const french = byLanguage.fr;
    if (!english || !italian || !french) throw new Error("expected en/it/fr cells");
    await createCombineCampaign({
      schemaVersion: 1,
      id: "campaign-scope",
      projectId: "mobile",
      ownerId: "human:designer",
      appMapId: "store",
      combineId: "locales",
      sourceRevision: map.revision,
      latestRevision: map.revision,
      target: { kind: "device", id: "pixel-1", platform: "android" },
      status: "ready-to-resume",
      createdAt: 10,
      updatedAt: 10,
      cases: [
        {
          ...combineCampaignCaseFromPreparedCell(english, {
            index: 0,
            phase: "pilot",
            status: "pending",
          }),
          status: "passed",
        },
        combineCampaignCaseFromPreparedCell(italian, {
          index: 1,
          phase: "coverage",
          status: "pending",
        }),
        combineCampaignCaseFromPreparedCell(french, {
          index: 2,
          phase: "coverage",
          status: "pending",
        }),
      ],
      lineage: [
        { kind: "created", at: 10, appMapRevision: map.revision, actorId: "human:designer" },
      ],
      execution: {
        selected: { language: ["en", "it", "fr"] },
        selectedCellIds: [english.cellId, italian.cellId],
        strategy: "zip",
        seed: prepared.matrix.seed,
      },
    });
    const before = await client.invoke("job.combine.campaign.get", { batchId: "campaign-scope" });
    assert.equal((before.campaign as CombineCampaign).status, "ready-to-resume");
    const jobsBefore = await client.invoke("job.list", { limit: 100 });
    const resumed = await client.invoke("job.combine.campaign.resume", {
      batchId: "campaign-scope",
      reviewed: true,
    });
    const jobs = (resumed.jobs as Array<{ id: string }>) ?? [];
    assert.equal(jobs.length, 1);
    const jobsAfter = await client.invoke("job.list", { limit: 100 });
    assert.equal(jobsAfter.jobs.length, jobsBefore.jobs.length + 1);
    const campaign = (resumed.campaign ??
      (await client.invoke("job.combine.campaign.get", { batchId: "campaign-scope" }))
        .campaign) as CombineCampaign;
    const passed = campaign.cases.find((item) => item.cellId === english.cellId);
    const queued = campaign.cases.find((item) => item.cellId === italian.cellId);
    const unselected = campaign.cases.find((item) => item.cellId === french.cellId);
    assert.equal(passed?.status, "passed");
    assert.equal(passed?.jobId, undefined);
    assert.ok(queued?.status === "queued" || queued?.status === "running");
    assert.equal(queued?.jobId, jobs[0]?.id);
    assert.equal(unselected?.status, "pending");
    assert.equal(unselected?.jobId, undefined);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

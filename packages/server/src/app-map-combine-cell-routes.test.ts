import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  appMapCombineCellId,
  cancelJob,
  combineCampaignCaseFromPreparedCell,
  createCombineCampaign,
  enqueueJob,
  getJob,
  localExecutionTargetRef,
  listDevices,
  mutateStoredAppMap,
  prepareAppMapCombineCells,
  readAppMap,
  updateCombineCampaign,
  waitForJobCompletion,
} from "@relay/core";
import type { CombineCampaign, DeviceLease } from "@relay/protocol";
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

type LocaleTarget = { targetId: string; platform: "android" | "ios" };

async function saveLocaleCombine(
  client: RelayClient,
  targets: Record<"en" | "it" | "fr", LocaleTarget> = {
    en: { targetId: "pixel-1", platform: "android" },
    it: { targetId: "pixel-1", platform: "android" },
    fr: { targetId: "pixel-1", platform: "android" },
  },
): Promise<void> {
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
    const variant = (id: string, profileId: string, name: string, target: LocaleTarget) => ({
      id,
      organizationId: next.organizationId,
      projectId: next.projectId,
      appMapId: next.id,
      screenId: "home",
      targetProfile: {
        id: profileId,
        targetId: target.targetId,
        source: "device" as const,
        platform: target.platform,
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
    next.screenVariants["home-en"] = variant("home-en", "pixel-en", "Pixel · English", targets.en);
    next.screenVariants["home-it"] = variant("home-it", "pixel-it", "Pixel · Italian", targets.it);
    next.screenVariants["home-fr"] = variant("home-fr", "pixel-fr", "Pixel · French", targets.fr);
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

function admissionLease(targetId: string): DeviceLease {
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

test("Combine admission binds cells across local Android and iOS before one job queues", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-multi-target-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const calls = { devices: 0, leases: 0, workers: 0, controls: [] as string[], releases: 0 };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async listDevices() {
        calls.devices += 1;
        return [
          {
            id: "pixel-a",
            serial: "pixel-a",
            name: "Pixel A",
            kind: "Physical device",
            booted: true,
            platform: "android" as const,
          },
          {
            id: "ipad-b",
            serial: "ipad-b",
            name: "iPad B",
            kind: "Physical device",
            booted: true,
            platform: "ios" as const,
          },
        ];
      },
      async listDeviceLeases() {
        calls.leases += 1;
        return [];
      },
      listTargetWorkers() {
        calls.workers += 1;
        return [
          {
            workerId: "local:android:target:pixel-a",
            capacity: 1,
            active: 0,
            queued: 0,
            activeTargets: [],
            queuedTargets: [],
          },
          {
            workerId: "local:ios:target:ipad-b",
            capacity: 1,
            active: 0,
            queued: 0,
            activeTargets: [],
            queuedTargets: [],
          },
        ];
      },
      async assertTargetControl(_scope, targetId) {
        if (!targetId) throw new Error("target id is required");
        calls.controls.push(targetId);
        return admissionLease(targetId);
      },
      async admitTargetControl(_scope, targetId) {
        if (!targetId) throw new Error("target id is required");
        calls.controls.push(targetId);
        return { lease: admissionLease(targetId), createdByThisCall: true };
      },
      async releaseDeviceLease() {
        calls.releases += 1;
        throw new Error("successful admission must not release a lease");
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
    await saveLocaleCombine(client, {
      en: { targetId: "pixel-a", platform: "android" },
      it: { targetId: "ipad-b", platform: "ios" },
      fr: { targetId: "pixel-a", platform: "android" },
    });
    const observedAt = Date.now();
    const result = await client.invoke("job.combine.start", {
      appMapId: "store",
      combineId: "locales",
      selected: { language: ["en", "it"] },
      cellTargetBindings: [
        {
          testId: "script-only",
          values: { language: "en" },
          target: localExecutionTargetRef({ targetId: "pixel-a", platform: "android" }),
        },
        {
          testId: "script-only",
          values: { language: "it" },
          target: localExecutionTargetRef({ targetId: "ipad-b", platform: "ios" }),
        },
      ],
      localAdmission: {
        deadlineMs: 10_000,
        duration: {
          workItemDurationMs: 1_000,
          provenance: "observed-p95",
          observedAt,
          sampleCount: 20,
          maxAgeMs: 60_000,
        },
        durationsByPlatform: {
          android: {
            workItemDurationMs: 1_000,
            provenance: "observed-p95",
            observedAt,
            sampleCount: 20,
            maxAgeMs: 60_000,
          },
          ios: {
            workItemDurationMs: 1_000,
            provenance: "observed-p95",
            observedAt,
            sampleCount: 20,
            maxAgeMs: 60_000,
          },
        },
        setupHeadroomMs: 500,
        recoveryHeadroomMs: 500,
      },
    });
    const jobs = (result.jobs as Array<{ serial?: string }>) ?? [];
    assert.deepEqual(jobs.map((job) => job.serial).sort(), ["ipad-b", "pixel-a"]);
    const admission = result.admission as {
      preflight: {
        deadline: { achievableWithCurrentCapacity: boolean };
        plan: {
          platforms: Array<{
            platform: string;
            scheduledSlots: number;
            budget?: { requiredIndependentTargetSlots: number | null };
          }>;
        };
      };
    };
    assert.equal(admission.preflight.deadline.achievableWithCurrentCapacity, true);
    assert.deepEqual(
      admission.preflight.plan.platforms.map((platform) => ({
        platform: platform.platform,
        availableSlots: platform.scheduledSlots,
        requiredSlots: platform.budget?.requiredIndependentTargetSlots,
      })),
      [
        { platform: "android", availableSlots: 1, requiredSlots: 1 },
        { platform: "ios", availableSlots: 1, requiredSlots: 1 },
      ],
    );
    assert.deepEqual(calls.controls.sort(), ["ipad-b", "pixel-a"]);
    assert.equal(calls.releases, 0);
    assert.ok(calls.devices >= 1);
    assert.equal(
      calls.leases,
      1,
      "capacity reads once; exact lease provenance comes from control admission",
    );
    assert.equal(calls.workers, 1);
    const campaign = result.campaign as CombineCampaign;
    assert.equal(campaign.target, undefined);
    assert.deepEqual(campaign.cases.map((item) => item.target?.targetId).sort(), [
      "ipad-b",
      "pixel-a",
    ]);
    assert.equal(
      campaign.execution?.localAdmission?.preflight.deadline.achievableWithCurrentCapacity,
      true,
    );
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Combine admission reuses a caller-controlled local lease during initial queueing", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-owned-lease-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const existing = admissionLease("pixel-1");
  const calls = { controls: 0, releases: 0 };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async listDevices() {
        return [
          {
            id: "pixel-1",
            serial: "pixel-1",
            name: "Pixel 1",
            kind: "Physical device",
            booted: true,
            platform: "android" as const,
          },
        ];
      },
      async listDeviceLeases() {
        return [existing];
      },
      listTargetWorkers() {
        return [
          {
            workerId: "local:android:target:pixel-1",
            capacity: 1,
            active: 0,
            queued: 0,
            activeTargets: [],
            queuedTargets: [],
          },
        ];
      },
      async assertTargetControl() {
        calls.controls += 1;
        return existing;
      },
      async admitTargetControl() {
        calls.controls += 1;
        return { lease: existing, createdByThisCall: false };
      },
      async releaseDeviceLease() {
        calls.releases += 1;
        throw new Error("an existing caller lease must not be released");
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
    await saveLocaleCombine(client);
    const result = await client.invoke("job.combine.start", {
      appMapId: "store",
      combineId: "locales",
      selected: { language: ["en"] },
      cellTargetBindings: [
        {
          testId: "script-only",
          values: { language: "en" },
          target: localExecutionTargetRef({ targetId: "pixel-1", platform: "android" }),
        },
      ],
      localAdmission: {
        deadlineMs: 10_000,
        duration: {
          workItemDurationMs: 1_000,
          provenance: "observed-p95",
          observedAt: Date.now(),
          sampleCount: 20,
          maxAgeMs: 60_000,
        },
      },
    });
    assert.equal(
      (result.admission as { preflight: { deadline: { achievableWithCurrentCapacity: boolean } } })
        .preflight.deadline.achievableWithCurrentCapacity,
      true,
    );
    assert.equal((result.jobs as unknown[]).length, 1);
    assert.deepEqual(calls, { controls: 1, releases: 0 });
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a passed pilot resumes on its retained caller lease through local admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-pilot-resume-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const targetId = "pilot-resume-pixel";
  const existing = admissionLease(targetId);
  const calls = { controls: 0, releases: 0 };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async listDevices() {
        return [
          {
            id: targetId,
            serial: targetId,
            name: "Pilot resume Pixel",
            kind: "Physical device",
            booted: true,
            platform: "android" as const,
          },
        ];
      },
      async listDeviceLeases() {
        return [existing];
      },
      listTargetWorkers() {
        return [
          {
            workerId: `local:android:target:${targetId}`,
            capacity: 1,
            active: 0,
            queued: 0,
            activeTargets: [],
            queuedTargets: [],
          },
        ];
      },
      async admitTargetControl() {
        calls.controls += 1;
        return { lease: existing, createdByThisCall: false };
      },
      async releaseDeviceLease() {
        calls.releases += 1;
        throw new Error("a retained caller lease must not be released");
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
    await saveLocaleCombine(client, {
      en: { targetId, platform: "android" },
      it: { targetId, platform: "android" },
      fr: { targetId, platform: "android" },
    });
    const observedAt = Date.now();
    const target = localExecutionTargetRef({ targetId, platform: "android" });
    const admission = {
      deadlineMs: 10_000,
      duration: {
        workItemDurationMs: 1_000,
        provenance: "observed-p95" as const,
        observedAt,
        sampleCount: 20,
        maxAgeMs: 60_000,
      },
    };
    const pilot = await client.invoke("job.combine.start", {
      appMapId: "store",
      combineId: "locales",
      executionMode: "pilot",
      selected: { language: ["en", "it"] },
      cellTargetBindings: [
        { testId: "script-only", values: { language: "en" }, target },
        { testId: "script-only", values: { language: "it" }, target },
      ],
      localAdmission: admission,
    });
    const created = pilot.campaign as CombineCampaign;
    const pilotJobId = created.cases.find((item) => item.phase === "pilot")?.jobId;
    if (!pilotJobId) throw new Error("pilot did not create a job");
    cancelJob(pilotJobId);
    await waitForJobCompletion(pilotJobId);
    // The route projection reads the immutable pilot job as well as the
    // campaign. Model the reviewed terminal pilot before exercising resume.
    const pilotJob = getJob(pilotJobId);
    if (!pilotJob) throw new Error("pilot job disappeared before resume");
    pilotJob.status = "ok";
    await updateCombineCampaign("mobile", created.id, (current) => ({
      ...current,
      status: "ready-to-resume",
      updatedAt: Date.now(),
      cases: current.cases.map((item) =>
        item.phase === "pilot" ? { ...item, status: "passed" as const } : item,
      ),
    }));

    const resumed = await client.invoke("job.combine.campaign.resume", {
      batchId: created.id,
      reviewed: true,
    });
    assert.equal((resumed.jobs as unknown[]).length, 1);
    assert.deepEqual(calls, { controls: 2, releases: 0 });
    const campaign = resumed.campaign as CombineCampaign;
    assert.equal(campaign.cases.find((item) => item.phase === "pilot")?.status, "passed");
    assert.ok(
      ["queued", "running"].includes(
        campaign.cases.find((item) => item.phase === "coverage")?.status ?? "",
      ),
    );
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Combine rejects an infeasible deadline before acquiring any lease or queueing work", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-deadline-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const calls = { controls: 0, releases: 0 };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async listDevices() {
        return [
          {
            id: "pixel-a",
            serial: "pixel-a",
            name: "Pixel A",
            kind: "Physical device",
            booted: true,
            platform: "android" as const,
          },
          {
            id: "ipad-b",
            serial: "ipad-b",
            name: "iPad B",
            kind: "Physical device",
            booted: true,
            platform: "ios" as const,
          },
        ];
      },
      async listDeviceLeases() {
        return [];
      },
      listTargetWorkers() {
        return [
          {
            workerId: "local:android:target:pixel-a",
            capacity: 1,
            active: 0,
            queued: 0,
            activeTargets: [],
            queuedTargets: [],
          },
          {
            workerId: "local:ios:target:ipad-b",
            capacity: 1,
            active: 0,
            queued: 0,
            activeTargets: [],
            queuedTargets: [],
          },
        ];
      },
      async assertTargetControl() {
        calls.controls += 1;
        return admissionLease("unexpected");
      },
      async releaseDeviceLease() {
        calls.releases += 1;
        return admissionLease("unexpected");
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
    await saveLocaleCombine(client, {
      en: { targetId: "pixel-a", platform: "android" },
      it: { targetId: "ipad-b", platform: "ios" },
      fr: { targetId: "pixel-a", platform: "android" },
    });
    const before = await client.invoke("job.list", { limit: 100 });
    await assert.rejects(
      client.invoke("job.combine.start", {
        appMapId: "store",
        combineId: "locales",
        selected: { language: ["en", "it"] },
        cellTargetBindings: [
          {
            testId: "script-only",
            values: { language: "en" },
            target: localExecutionTargetRef({ targetId: "pixel-a", platform: "android" }),
          },
          {
            testId: "script-only",
            values: { language: "it" },
            target: localExecutionTargetRef({ targetId: "ipad-b", platform: "ios" }),
          },
        ],
        localAdmission: {
          deadlineMs: 500,
          duration: {
            workItemDurationMs: 1_000,
            provenance: "observed-p95",
            observedAt: Date.now(),
            sampleCount: 20,
            maxAgeMs: 60_000,
          },
          durationsByPlatform: {
            android: {
              workItemDurationMs: 1_000,
              provenance: "observed-p95",
              observedAt: Date.now(),
              sampleCount: 20,
              maxAgeMs: 60_000,
            },
            ios: {
              workItemDurationMs: 1_000,
              provenance: "observed-p95",
              observedAt: Date.now(),
              sampleCount: 20,
              maxAgeMs: 60_000,
            },
          },
        },
      }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code === "LOCAL_COMBINE_ADMISSION_DEADLINE_INFEASIBLE",
    );
    const after = await client.invoke("job.list", { limit: 100 });
    assert.equal((after.jobs as unknown[]).length, (before.jobs as unknown[]).length);
    assert.deepEqual(calls, { controls: 0, releases: 0 });
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

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
    await saveLocaleCombine(client, {
      en: { targetId: "resume-pixel-1", platform: "android" },
      it: { targetId: "resume-pixel-1", platform: "android" },
      fr: { targetId: "resume-pixel-1", platform: "android" },
    });
    const map = await readAppMap("mobile", "store");
    if (!map?.combines.locales) throw new Error("expected locales Combine");
    const prepared = await prepareAppMapCombineCells({
      map,
      combine: map.combines.locales,
      target: { targetId: "resume-pixel-1", platform: "android" },
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
      target: { kind: "device", id: "resume-pixel-1", platform: "android" },
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

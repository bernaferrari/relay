import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS } from "@relay/protocol";
import type { JobInfo } from "./api-types.js";
import { createServerRunController } from "./server-run-controller.js";
import type { ServerRequest } from "./server-matrix-remote.js";

test("single-Test execution remembers and selects the exact queued compiler root", async () => {
  const remembered: JobInfo[] = [];
  let selectedJob = "";
  let selectedAction = "";
  const rootRecipeId = "app-map:shop:test:checkout:root:r7";
  const request: ServerRequest = async <T>(path: string) => {
    assert.equal(path, "/jobs/combine");
    return {
      batch: {
        id: "job-1",
        title: "Checkout",
        worlds: ["once"],
        recipeId: rootRecipeId,
      },
      jobs: [
        {
          id: "job-1",
          action: rootRecipeId,
          status: "queued",
          queuedAt: 1,
          logs: [],
        },
      ],
      matrix: { id: "job-1" },
    } as T;
  };
  const controller = createServerRunController({
    request,
    health: () => "online",
    devices: () => [{ serial: "device-1", platform: "ios" }],
    recipes: () => [],
    matrices: () => [],
    selectedDevice: () => "device-1",
    selectedJobId: () => null,
    prodAccountMatch: () => "",
    projectId: () => "project",
    projectVariables: () => [],
    activeJob: () => null,
    queuedJobs: () => [],
    captureBeforeRun: async () => undefined,
    appendLog: () => undefined,
    setSelectedJobId: (id) => (selectedJob = id),
    setSelectedAction: (id) => (selectedAction = id),
    setError: () => undefined,
    refreshJobs: async () => undefined,
    rememberJob: (job) => remembered.push(job),
  });

  const result = await controller.runPathAcrossVariables({
    appMapId: "shop",
    testId: "checkout",
    title: "Checkout",
  });

  assert.deepEqual(result, { jobId: "job-1" });
  assert.equal(selectedJob, "job-1");
  assert.equal(selectedAction, rootRecipeId);
  assert.deepEqual(
    remembered.map((job) => job.id),
    ["job-1"],
  );
});

test("explicit local Combine bindings run without a globally selected device", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const request: ServerRequest = async <T>(path: string, init?: RequestInit) => {
    assert.equal(path, "/jobs/combine");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return {
      batch: {
        id: "campaign-1",
        title: "Settings",
        worlds: ["Italian"],
        recipeId: "app-map:settings:test:settings:root",
      },
      jobs: [],
      matrix: { id: "campaign-1" },
      campaign: { id: "campaign-1" },
    } as T;
  };
  const controller = createServerRunController({
    request,
    health: () => "online",
    devices: () => [],
    recipes: () => [],
    matrices: () => [],
    selectedDevice: () => null,
    selectedJobId: () => null,
    prodAccountMatch: () => "",
    projectId: () => "project",
    projectVariables: () => [],
    activeJob: () => null,
    queuedJobs: () => [],
    captureBeforeRun: async () => undefined,
    appendLog: () => undefined,
    setSelectedJobId: () => undefined,
    setSelectedAction: () => undefined,
    setError: () => undefined,
    refreshJobs: async () => undefined,
    rememberJob: () => undefined,
  });
  const localAdmission = {
    deadlineMs: 120_000,
    durationEvidence: [
      {
        schemaVersion: 1 as const,
        cohort: {
          targetId: "ipad-1",
          platform: "ios" as const,
          testId: "settings",
          action: "app-map:settings:test:settings",
        },
        duration: {
          workItemDurationMs: 10_000,
          provenance: "observed-p50" as const,
          observedAt: 100,
          sampleCount: 5,
          maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
        },
        measurement: {
          estimator: "campaign-duration-estimate" as const,
          recordSource: "persisted-runs" as const,
          durationSource: "run-wall-clock" as const,
          sampleIds: ["1", "2", "3", "4", "5"],
          observationWindow: { startedAt: 1, finishedAt: 100 },
        },
      },
    ],
  };

  const result = await controller.runPathAcrossVariables({
    appMapId: "settings",
    combineId: "language",
    cellRuntimeProfiles: [
      { testId: "settings", values: { language: "it" }, targetProfileId: "ios-profile" },
    ],
    cellTargetBindings: [
      {
        testId: "settings",
        values: { language: "it" },
        target: {
          schemaVersion: 1,
          kind: "local-device",
          provider: { key: "relay.local.agent-device", scope: "local" },
          targetId: "ipad-1",
          platform: "ios",
          identity: { kind: "device-serial", value: "ipad-1" },
        },
      },
    ],
    localAdmission,
  });

  assert.deepEqual(result, { jobId: null, campaignId: "campaign-1" });
  assert.equal(requestBody?.serial, undefined);
  assert.deepEqual(requestBody?.localAdmission, localAdmission);
  assert.equal((requestBody?.cellTargetBindings as unknown[])?.length, 1);
});

test("explicit locale target intent never consults the selected serial, including an invalidated plan", async () => {
  let requestBody: Record<string, unknown> | undefined;
  let captures = 0;
  const request: ServerRequest = async <T>(path: string, init?: RequestInit) => {
    assert.equal(path, "/jobs/locale-matrix");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return {
      batch: {
        id: "locale-1",
        title: "Settings",
        locales: ["en", "it", "en"],
        recipeId: "settings",
      },
      jobs: [],
      matrix: { id: "locale-1" },
    } as T;
  };
  const controller = createServerRunController({
    request,
    health: () => "online",
    devices: () => [],
    recipes: () => [],
    matrices: () => [],
    selectedDevice: () => {
      throw new Error("explicit locale mode must not read selected serial");
    },
    selectedJobId: () => null,
    prodAccountMatch: () => "",
    projectId: () => "project",
    projectVariables: () => [],
    activeJob: () => null,
    queuedJobs: () => [],
    captureBeforeRun: async () => {
      captures += 1;
    },
    appendLog: () => undefined,
    setSelectedJobId: () => undefined,
    setSelectedAction: () => undefined,
    setError: () => undefined,
    refreshJobs: async () => undefined,
    rememberJob: () => undefined,
  });
  const localAdmission = {
    deadlineMs: 180_000,
    durationEvidence: [
      {
        schemaVersion: 1 as const,
        cohort: {
          targetId: "ipad-1",
          platform: "ios" as const,
          testId: "settings",
          action: "settings",
        },
        duration: {
          workItemDurationMs: 12_000,
          provenance: "observed-p95" as const,
          observedAt: 100,
          sampleCount: 5,
          maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
        },
        measurement: {
          estimator: "campaign-duration-estimate" as const,
          recordSource: "persisted-runs" as const,
          durationSource: "run-wall-clock" as const,
          sampleIds: ["1", "2", "3", "4", "5"],
          observationWindow: { startedAt: 1, finishedAt: 100 },
        },
      },
    ],
  };
  const target = {
    schemaVersion: 1 as const,
    kind: "local-device" as const,
    provider: { key: "relay.local.agent-device" as const, scope: "local" as const },
    targetId: "ipad-1",
    platform: "ios" as const,
    identity: { kind: "device-serial" as const, value: "ipad-1" },
  };

  await controller.localeMatrix.run("settings", ["en", "it"], {
    scope: {
      locales: ["en", "it"],
      entryPath: [{ kind: "tap" }],
      restoreLocale: "en",
    },
    caseTargetBindings: [
      { caseIndex: 0, locale: "en", executionTarget: target },
      { caseIndex: 1, locale: "it", executionTarget: target },
      { caseIndex: 2, locale: "en", executionTarget: target },
    ],
    localAdmission,
  });

  assert.equal(captures, 0);
  assert.equal(requestBody?.serial, undefined);
  assert.equal(requestBody?.targetKind, undefined);
  assert.equal(requestBody?.browserTargetId, undefined);
  assert.deepEqual(requestBody?.localAdmission, localAdmission);
  assert.equal((requestBody?.caseTargetBindings as unknown[])?.length, 3);

  // A stale explicit plan is blocked by the admission surface before it gets
  // here. Keep this transport boundary fail-closed too: the empty explicit
  // binding list is still an explicit-mode request, never a selected serial.
  await controller.localeMatrix.run("settings", ["fr"], {
    scope: {
      locales: ["fr"],
      entryPath: [{ kind: "tap" }],
      restoreLocale: "en",
    },
    caseTargetBindings: [],
  });

  assert.equal(captures, 0);
  assert.equal(requestBody?.serial, undefined);
  assert.deepEqual(requestBody?.caseTargetBindings, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS } from "@relay/protocol";
import {
  buildLocaleMatrixInput,
  enqueueAppMapFlow,
  enqueueMatrix,
  enqueueOptionMatrix,
  enqueueRecipe,
  estimateCampaignDurationCohortsRemote,
  exportRunMatrixPack,
  materializeLocaleMatrix,
  preflightLocalCampaignAdmissionRemote,
  removeCombineRemote,
  removeVariableRemote,
  retryJob,
  withLocalePickerNav,
} from "./server-run-remote";

test("Combine and Variable removal use revision-checked App Map actions", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init });
    return { appMap: { revision: 8 } } as T;
  };

  await removeCombineRemote(request, {
    appMapId: "map/a",
    combineId: "language × settings",
    expectedRevision: 6,
  });
  await removeVariableRemote(request, {
    appMapId: "map/a",
    variableId: "language/locale",
    expectedRevision: 7,
  });

  assert.deepEqual(
    calls.map(({ path, init }) => ({
      path,
      method: init?.method,
      body: JSON.parse(String(init?.body)),
    })),
    [
      {
        path: "/app-maps/map%2Fa/combines/language%20%C3%97%20settings/remove",
        method: "POST",
        body: { expectedRevision: 6 },
      },
      {
        path: "/app-maps/map%2Fa/variables/language%2Flocale/remove",
        method: "POST",
        body: { expectedRevision: 7 },
      },
    ],
  );
});

test("keeps execution endpoints typed and predictable", async () => {
  const calls: string[] = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    return {
      jobs: [{ id: "job-1" }],
      matrix: { id: "matrix-1", profiles: [], excluded: [] },
      job: { id: "job-2" },
    } as T;
  };
  await enqueueRecipe(request, {
    recipe: "login",
    targetKind: "device",
    platform: "android",
    repetitions: 1,
    projectId: "default",
  });
  await enqueueMatrix(request, { recipe: "login", matrixId: "smoke", repetitions: 1 });
  await exportRunMatrixPack(request, "batch/one");
  const job = await retryJob(request, "job-1");
  assert.equal(job.id, "job-2");
  assert.deepEqual(calls, [
    "POST /jobs/matrix",
    "POST /jobs/compatibility-matrix",
    "GET /jobs/combine/batch%2Fone/export",
    "POST /jobs/job-1/retry",
  ]);
});

test("a run-to-screen request keeps its explicit flow boundary", async () => {
  let requestBody: unknown;
  const request = async <T>(_path: string, init?: RequestInit): Promise<T> => {
    requestBody = JSON.parse(String(init?.body));
    return { job: { id: "job-1" }, jobs: [{ id: "job-1" }] } as T;
  };

  await enqueueAppMapFlow(request, {
    appMapId: "map-1",
    flowId: "main",
    throughConnectionId: "open-settings",
    serial: "phone-1",
    targetKind: "device",
    platform: "android",
  });

  assert.deepEqual(requestBody, {
    throughConnectionId: "open-settings",
    serial: "phone-1",
    targetKind: "device",
    platform: "android",
  });
});

test("explicit local Combine transport never falls back to a selected serial", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const request = async <T>(_path: string, init?: RequestInit): Promise<T> => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return {
      batch: { id: "batch-1", title: "Locale settings", worlds: ["Italian"], recipeId: "root" },
      jobs: [],
      matrix: { id: "batch-1" },
    } as T;
  };
  const localAdmission = {
    deadlineMs: 180_000,
    durationEvidence: [
      {
        schemaVersion: 1 as const,
        cohort: {
          targetId: "pixel-1",
          platform: "android" as const,
          testId: "settings",
          action: "app-map:settings:test:settings",
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
          sampleIds: ["run-1", "run-2", "run-3", "run-4", "run-5"],
          observationWindow: { startedAt: 1, finishedAt: 100 },
        },
      },
    ],
    setupHeadroomMs: 10_000,
  };

  await enqueueOptionMatrix(request, {
    appMapId: "map-1",
    combineId: "language-settings",
    projectId: "default",
    cellRuntimeProfiles: [
      { testId: "settings", values: { language: "it" }, targetProfileId: "profile-1" },
    ],
    cellTargetBindings: [
      {
        testId: "settings",
        values: { language: "it" },
        target: {
          schemaVersion: 1,
          kind: "local-device",
          provider: { key: "relay.local.agent-device", scope: "local" },
          targetId: "pixel-1",
          platform: "android",
          identity: { kind: "device-serial", value: "pixel-1" },
        },
      },
    ],
    localAdmission,
  });

  assert.equal(requestBody?.serial, undefined);
  assert.equal(requestBody?.browserTargetId, undefined);
  assert.deepEqual(requestBody?.cellTargetBindings, [
    {
      testId: "settings",
      values: { language: "it" },
      target: {
        schemaVersion: 1,
        kind: "local-device",
        provider: { key: "relay.local.agent-device", scope: "local" },
        targetId: "pixel-1",
        platform: "android",
        identity: { kind: "device-serial", value: "pixel-1" },
      },
    },
  ]);
  assert.deepEqual(requestBody?.localAdmission, localAdmission);
});

test("read-only local evidence and admission previews preserve exact cohorts", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return { checkedAt: 100, estimates: [], preflight: {}, targetPreflights: [] } as T;
  };
  const cohort = {
    targetId: "pixel-1",
    platform: "android" as const,
    testId: "settings",
    action: "app-map:settings:test:settings",
  };
  const localAdmission = {
    deadlineMs: 180_000,
    durationEvidence: [
      {
        schemaVersion: 1 as const,
        cohort,
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
  await estimateCampaignDurationCohortsRemote(request, {
    cohorts: [cohort],
    maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
    percentile: "p95",
    minSamples: 5,
  });
  await preflightLocalCampaignAdmissionRemote(request, {
    workItems: [
      {
        id: 'settings:{"language":"it"}',
        target: {
          schemaVersion: 1,
          kind: "local-device",
          provider: { key: "relay.local.agent-device", scope: "local" },
          targetId: "pixel-1",
          platform: "android",
          identity: { kind: "device-serial", value: "pixel-1" },
        },
        testId: "settings",
        action: cohort.action,
      },
    ],
    request: localAdmission,
  });

  assert.deepEqual(calls, [
    {
      path: "/campaign-duration/cohorts/estimate",
      body: {
        cohorts: [cohort],
        maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
        percentile: "p95",
        minSamples: 5,
      },
    },
    {
      path: "/jobs/local-admission/preflight",
      body: {
        workItems: [
          {
            id: 'settings:{"language":"it"}',
            target: {
              schemaVersion: 1,
              kind: "local-device",
              provider: { key: "relay.local.agent-device", scope: "local" },
              targetId: "pixel-1",
              platform: "android",
              identity: { kind: "device-serial", value: "pixel-1" },
            },
            testId: "settings",
            action: cohort.action,
          },
        ],
        request: localAdmission,
      },
    },
  ]);
});

test("taught locale scope is enqueued instead of the Grok language profile", () => {
  const scope = {
    locales: ["en", "it"],
    languageOptions: {
      en: { identifier: "lang.en" },
      it: { label: "Italiano" },
    },
    screenshotEachLocale: true,
    restoreAtEnd: false,
  };
  const body = buildLocaleMatrixInput({
    recipe: "settings-smoke",
    serial: "phone-1",
    targetKind: "device",
    platform: "ios",
    locales: ["en", "it"],
    scope,
    title: "Settings smoke",
    projectId: "default",
  });
  assert.equal(body.preset, undefined);
  assert.equal(body.profileId, undefined);
  assert.equal(body.scope?.screenshotEachLocale, true);
  assert.deepEqual(body.scope?.languageOptions?.en, { identifier: "lang.en" });
  assert.equal(body.scope?.languagePath, undefined);
  assert.equal(JSON.stringify(body.scope).includes("App Language"), false);
});

test("a scoped App Map Test start keeps its source revision and profile constraint", () => {
  const body = buildLocaleMatrixInput({
    appMapId: "settings-map",
    testId: "settings-smoke",
    variableId: "language",
    expectedAppMapRevision: 12,
    locales: ["en"],
    scope: {
      locales: ["en"],
      entryPath: [{ kind: "tap", target: { identifier: "settings.language" } }],
      exitPath: [{ kind: "back" }],
    },
    profileId: "grok-ios",
    preset: "grok",
    projectId: "default",
    caseTargetBindings: [],
  });
  assert.deepEqual(body, {
    appMapId: "settings-map",
    testId: "settings-smoke",
    variableId: "language",
    expectedAppMapRevision: 12,
    locales: ["en"],
    scope: {
      locales: ["en"],
      entryPath: [{ kind: "tap", target: { identifier: "settings.language" } }],
      exitPath: [{ kind: "back" }],
    },
    title: undefined,
    projectId: "default",
    preset: "grok",
    profileId: "grok-ios",
    caseTargetBindings: [],
  });
  assert.equal(body.serial, undefined);
  assert.equal(body.targetKind, undefined);
});

test("locale matrix transport preserves explicit case targets and shared local admission", () => {
  const localAdmission = {
    deadlineMs: 180_000,
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
  const body = buildLocaleMatrixInput({
    appMapId: "settings",
    flowId: "main",
    locales: ["it"],
    projectId: "default",
    caseTargetBindings: [
      {
        caseIndex: 0,
        locale: "it",
        executionTarget: {
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

  assert.equal(body.serial, undefined);
  assert.equal(body.targetKind, undefined);
  assert.deepEqual(body.localAdmission, localAdmission);
  assert.equal(body.caseTargetBindings?.[0]?.executionTarget.targetId, "ipad-1");
});

test("locale materialization reads the canonical target-free restore plan before assignment", async () => {
  let call: { path: string; init?: RequestInit } | undefined;
  const expected = {
    schemaVersion: 1 as const,
    materializedAt: 10,
    source: { kind: "recipe" as const, recipeId: "settings" },
    scope: {
      locales: ["en", "it"],
      entryPath: [{ kind: "tap", target: { label: "Settings" } }],
      restoreLocale: "en",
    },
    cases: [
      { caseIndex: 0, locale: "en" },
      { caseIndex: 1, locale: "it" },
      { caseIndex: 2, locale: "en" },
    ],
    durationCohort: { testId: "settings", action: "settings" },
  };
  const result = await materializeLocaleMatrix(
    async <T>(path: string, init?: RequestInit) => {
      call = { path, init };
      return expected as T;
    },
    {
      recipe: "settings",
      scope: expected.scope,
    },
  );
  assert.deepEqual(result, expected);
  assert.equal(call?.path, "/jobs/locale-matrix/materialize");
  assert.equal(call?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(call?.init?.body)), {
    recipe: "settings",
    scope: expected.scope,
  });
});

test("UI enqueue payload includes picker nav taps before locale select", () => {
  const taught = withLocalePickerNav({
    locales: ["en", "it"],
    languageOptions: {
      en: { identifier: "lang.en" },
      it: { label: "Italiano" },
    },
    screenshotEachLocale: true,
    restoreAtEnd: false,
  });
  const body = buildLocaleMatrixInput({
    appMapId: "map-1",
    flowId: "checkout",
    serial: "phone-1",
    targetKind: "device",
    platform: "ios",
    locales: taught.locales,
    scope: taught,
    title: "Checkout",
    projectId: "default",
  });
  const languagePath = body.scope?.languagePath as Array<{
    kind?: string;
    target?: { text?: string };
  }>;
  const entryPath = body.scope?.entryPath as Array<{ target?: { identifier?: string } }>;
  assert.ok(entryPath?.some((step) => step.target?.identifier === "sidebar.settings.button"));
  assert.ok(languagePath?.some((step) => step.target?.text === "App Language"));
  assert.deepEqual(body.scope?.languageOptions?.en, { identifier: "lang.en" });
});

test("recorded picker prelude is not replaced with Grok Settings nav", () => {
  const scope = {
    locales: ["en", "de"],
    entryPath: [
      { kind: "tap", target: { label: "Profile" } },
      { kind: "wait", ms: 300 },
      { kind: "tap", target: { text: "Language" } },
    ],
    languageOptions: {
      en: { identifier: "lang.en" },
      de: { label: "Deutsch" },
    },
    screenshotEachLocale: true,
    restoreAtEnd: false,
  };
  const body = buildLocaleMatrixInput({
    appMapId: "map-1",
    flowId: "checkout",
    serial: "phone-1",
    targetKind: "device",
    platform: "ios",
    locales: ["en", "de"],
    scope,
    title: "Checkout",
    projectId: "default",
  });
  assert.deepEqual(body.scope?.entryPath, scope.entryPath);
  assert.equal(JSON.stringify(body.scope).includes("sidebar.settings.button"), false);
  assert.equal(JSON.stringify(body.scope).includes("App Language"), false);
});

test("without a taught scope Relay does not assume a Grok profile", () => {
  const body = buildLocaleMatrixInput({
    recipe: "settings-smoke",
    serial: "phone-1",
    targetKind: "device",
    platform: "ios",
    locales: ["en"],
    projectId: "default",
  });
  assert.equal(body.preset, undefined);
  assert.equal(body.profileId, undefined);
  assert.equal(body.scope, undefined);
});

test("a map flow locale run does not send a Grok preset or library recipe id", () => {
  const scope = {
    locales: ["en", "it"],
    screenshotEachLocale: true,
    restoreAtEnd: false,
  };
  const body = buildLocaleMatrixInput({
    appMapId: "map-1",
    flowId: "checkout",
    serial: "phone-1",
    targetKind: "device",
    platform: "ios",
    locales: ["en", "it"],
    scope,
    title: "Checkout",
    projectId: "default",
  });
  assert.equal(body.recipe, undefined);
  assert.equal(body.appMapId, "map-1");
  assert.equal(body.flowId, "checkout");
  assert.equal(body.preset, undefined);
  assert.deepEqual(body.scope?.locales, ["en", "it"]);
  assert.equal(body.preset, undefined);
  assert.equal(JSON.stringify(body.scope ?? {}).includes("sidebar.settings"), false);
});

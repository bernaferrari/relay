import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocaleMatrixInput,
  enqueueAppMapFlow,
  enqueueMatrix,
  enqueueRecipe,
  retryJob,
  withLocalePickerNav,
} from "./server-run-remote";

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
  const job = await retryJob(request, "job-1");
  assert.equal(job.id, "job-2");
  assert.deepEqual(calls, [
    "POST /jobs/matrix",
    "POST /jobs/compatibility-matrix",
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

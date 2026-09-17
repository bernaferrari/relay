import assert from "node:assert/strict";
import test from "node:test";
import {
  describeCoverageStepReason,
  type AppMap,
  type AppMapEntity,
  type AppMapScenarioTest,
  type Connection,
  type RecipeStep,
  type RequirementActionKind,
  type Screen,
} from "@relay/protocol";
import { compileAppMapConnection, compileAppMapRoutine } from "./app-map-compiler.js";
import { compileAppMapTest } from "./map-work.js";
import { reviewChecklistRows } from "./combine-evidence-review-checklist.js";
import {
  coverageOutcomesFromArtifacts,
  inspectSetupSkip,
  leftoverSkipForbidden,
} from "./coverage-step-outcome.js";
import type { Device } from "./device.js";
import { runCampaignCheck } from "./recipe-runner-campaign-checks.js";
import { runRecipeStep } from "./recipe-runner.js";
import { captureRecipeScreenshot } from "./recipe-runner-screen.js";
import { runRecipeSteps } from "./session.js";
import { summarizeJob, type TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";
import type { ScreenshotPayload } from "./workspace-capture.js";

const at = 1_000;
const scope = { organizationId: "org-1", projectId: "project-1", appMapId: "map-1" };

function entity(id: string): AppMapEntity {
  return { ...scope, id, createdAt: at, updatedAt: at };
}

function screen(id: string, title: string): Screen {
  return {
    ...entity(id),
    title,
    identity: { schemaVersion: 1, fingerprint: (id === "welcome" ? "a" : "b").repeat(64) },
    variantIds: [],
  };
}

function destEndMap(connection: Connection): AppMap {
  return {
    schemaVersion: 1,
    id: scope.appMapId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    name: "Store",
    revision: 7,
    notes: {},
    groups: {},
    screens: {
      welcome: screen("welcome", "Welcome"),
      home: screen("home", "Home"),
    },
    screenVariants: {},
    connections: { [connection.id]: connection },
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
    createdAt: at,
    updatedAt: at,
  };
}

function inspectDestEndConnection(): Connection {
  return {
    ...entity("open-settings-panel"),
    fromScreenId: "welcome",
    destination: { kind: "end" },
    coverage: "inspect",
    state: "ready",
    actions: [
      {
        id: "settings-panel",
        kind: "steps",
        steps: [
          { kind: "wait-for", target: { identifier: "sidebar-search" }, timeoutMs: 8_000 },
          { kind: "tap", target: { label: "Account" } },
          { kind: "tap", target: { label: "Settings" } },
          { kind: "wait-for", target: { label: "Appearance" }, timeoutMs: 8_000 },
        ],
      },
    ],
  };
}

function transitionDestEndConnection(): Connection {
  return {
    ...entity("open-settings"),
    fromScreenId: "welcome",
    destination: { kind: "end" },
    coverage: "transition",
    state: "ready",
    actions: [
      {
        id: "open-settings",
        kind: "steps",
        coverage: "transition",
        steps: [
          { kind: "wait-for", target: { identifier: "composer" }, timeoutMs: 8_000 },
          { kind: "tap", target: { identifier: "sidebar.settings" }, coverage: "transition" },
          { kind: "wait-for", target: { identifier: "settings.account" }, timeoutMs: 8_000 },
        ],
      },
    ],
  };
}

function leftoverControl(identifier: string, label: string, y: number) {
  return {
    role: "button",
    identifier,
    label,
    enabled: true,
    hittable: true,
    rect: { x: 40, y, width: 280, height: 56 },
  };
}

function leftoverNodes() {
  return [
    { role: "application", enabled: true, rect: { x: 0, y: 0, width: 1080, height: 2340 } },
    leftoverControl("sidebar-search", "Search", 80),
    leftoverControl("composer", "Composer", 150),
    leftoverControl("sidebar.settings", "Settings", 220),
    leftoverControl("settings.account", "Account", 290),
    {
      role: "button",
      label: "Appearance",
      enabled: true,
      hittable: true,
      rect: { x: 40, y: 360, width: 280, height: 56 },
    },
  ];
}

function leftoverDevice(presses: string[]): Device {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  return {
    interactions: {
      find: () => Promise.resolve({}),
      press: (options: { query?: string; selector?: string; x?: number; y?: number }) => {
        presses.push(
          options.selector ??
            options.query ??
            (typeof options.x === "number" ? `${options.x},${options.y}` : "press"),
        );
        return Promise.resolve({});
      },
      longPress: () => Promise.resolve({}),
      fill: () => Promise.resolve({}),
      type: () => Promise.resolve({}),
      swipe: () => Promise.resolve({}),
      scroll: () => Promise.reject(new Error("scroll unavailable")),
      pan: () => Promise.resolve({}),
    },
    command: { wait: () => Promise.resolve({}), back: () => Promise.resolve({}) },
    capture: {
      snapshot: () => Promise.resolve({ nodes: leftoverNodes() }),
      screenshot: async () => ({
        capturedAt: Date.now(),
        mime: "image/png",
        base64: png.toString("base64"),
        bytes: png.length,
      }),
    },
  } as unknown as Device;
}

function recipeJob(id: string, steps: RecipeStep[]): TestJob {
  return {
    id,
    action: id,
    platform: "android",
    queuedAt: at,
    steps: [],
    artifacts: [],
    frames: [],
    logs: [],
    resolvedInputs: {},
    recipeId: id,
    recipeSnapshot: { id, title: id, steps },
    recipeGraph: { [id]: { id, title: id, steps } },
  } as unknown as TestJob;
}

function skipReasons(job: TestJob): unknown[] {
  return job.artifacts
    .filter((artifact) => artifact.kind === "conditional-step-skipped")
    .map((artifact) => (artifact.data as { reason?: unknown }).reason);
}

function executedReasons(job: TestJob): unknown[] {
  return job.artifacts
    .filter((artifact) => artifact.kind === "coverage-step-result")
    .map((artifact) => (artifact.data as { reason?: unknown }).reason);
}

function claimsOpenerTap(text: string): boolean {
  return (
    /tap(?:ped|s)?\b/iu.test(text) &&
    /account|settings|sidebar\.open|sidebar\.settings/iu.test(text)
  );
}

function androidTarget<T>(run: () => Promise<T>): Promise<T> {
  return runWithTargetContext(
    { kind: "device", platform: "android", serial: "leftover-skip" },
    run,
  );
}

test("skip vs transition is stamped from RecipeStep.coverage, not leftover chrome", () => {
  const leftover = { target: { label: "Appearance" }, condition: "absent" as const };
  const inspectTap: RecipeStep = {
    kind: "tap",
    coverage: "inspect",
    target: { label: "Settings" },
    when: leftover,
  };
  const transitionTap: RecipeStep = {
    kind: "tap",
    coverage: "transition",
    target: { identifier: "sidebar.settings" },
    when: leftover,
  };
  assert.equal(inspectSetupSkip(inspectTap), true);
  assert.equal(leftoverSkipForbidden(inspectTap), false);
  assert.equal(leftoverSkipForbidden(transitionTap), true);
  assert.equal(inspectSetupSkip(transitionTap), false);
  assert.deepEqual(
    coverageOutcomesFromArtifacts([
      { kind: "conditional-step-skipped", data: { reason: "inspect-setup-skipped" } },
      { kind: "coverage-step-result", data: { reason: "transition-executed" } },
    ]),
    ["inspect-setup-skipped", "transition-executed"],
  );
});

test("inspect dest-end leftover skip records inspect-setup skipped and still captures", async () => {
  const compiled = compileAppMapConnection(
    destEndMap(inspectDestEndConnection()),
    "open-settings-panel",
  );
  const steps = compiled.recipes[compiled.rootRecipeId]!.steps;
  assert.equal(steps[0]?.coverage, "inspect");
  assert.equal(steps[1]?.coverage, "inspect");
  assert.equal(steps[2]?.coverage, "inspect");
  assert.equal(steps[1]?.kind, "tap");
  assert.equal(steps[2]?.kind, "tap");
  assert.deepEqual(steps[1]?.when?.condition, "absent");
  assert.deepEqual(steps[2]?.when?.condition, "absent");
  assert.equal(steps[3]?.when, undefined);

  const presses: string[] = [];
  const logs: string[] = [];
  const job = recipeJob("inspect-leftover", steps);
  const device = leftoverDevice(presses);
  await androidTarget(() =>
    runRecipeSteps(
      job,
      device,
      (line) => logs.push(line),
      () => {},
    ),
  );

  assert.deepEqual(presses, []);
  assert.ok(skipReasons(job).length >= 1);
  assert.equal(
    skipReasons(job).every((reason) => reason === "inspect-setup-skipped"),
    true,
  );
  assert.deepEqual(executedReasons(job), []);
  const skipTitle = describeCoverageStepReason("inspect-setup-skipped");
  assert.ok(job.steps.some((step) => step.title === skipTitle));
  assert.equal(
    job.steps.some((step) => step.title.startsWith("Tap ") && step.status === "ok"),
    false,
  );
  assert.equal(logs.some(claimsOpenerTap), false);
  assert.ok(logs.some((line) => line.includes(skipTitle)));

  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await androidTarget(() =>
    captureRecipeScreenshot(
      device,
      "Settings panel",
      { artifacts, log: () => {} },
      {
        captureScreenshot: async () =>
          ({
            capturedAt: Date.now(),
            mime: "image/png",
            base64: Buffer.from("panel").toString("base64"),
            path: "/tmp/leftover-skip.png",
            bytes: 5,
          }) satisfies ScreenshotPayload,
      },
    ),
  );
  assert.ok(artifacts.some((artifact) => artifact.kind === "visual-settling"));

  const checkJob = recipeJob("inspect-check", []);
  const checkLogs: string[] = [];
  const checkCtx = { log: (line: string) => checkLogs.push(line), job: checkJob, runtime: {} };
  await androidTarget(() =>
    runCampaignCheck(
      leftoverDevice([]),
      {
        kind: "module",
        recipeId: "inspect-leftover",
        check: { id: "open-settings-panel", title: "Open Settings" },
      },
      checkCtx,
      async () => {
        for (const step of steps) {
          await runRecipeStep(device, step, checkCtx);
        }
      },
    ),
  );
  assert.ok(skipReasons(checkJob).every((reason) => reason === "inspect-setup-skipped"));
  const passed = checkJob.artifacts.find((artifact) => artifact.kind === "campaign-check-result");
  assert.equal((passed?.data as { status?: unknown }).status, "passed");
  assert.deepEqual((passed?.data as { coverageOutcomes?: unknown }).coverageOutcomes, [
    "inspect-setup-skipped",
  ]);
  assert.equal((passed?.data as { coverageNote?: string }).coverageNote, skipTitle);
  assert.equal(checkLogs.some(claimsOpenerTap), false);
  assert.ok(checkLogs.some((line) => line.includes(skipTitle)));
  assert.equal(
    checkLogs.some((line) => /conditional tap: skipped/iu.test(line)),
    false,
  );
  const summary = summarizeJob(checkJob);
  assert.equal(summary.checks?.[0]?.coverageNote, skipTitle);
  assert.equal(
    summary.checks?.some((check) => claimsOpenerTap(check.coverageNote ?? "")),
    false,
  );

  const rows = reviewChecklistRows({
    cases: [
      {
        jobId: job.id,
        name: "Open Settings",
        status: "ok",
        frames: ["screenshots/001.png"],
        note: skipTitle,
      },
    ],
    findings: [],
  });
  assert.equal(rows[0]?.note, skipTitle);
  assert.doesNotMatch(rows[0]?.note ?? "", /\btap(?:ped|s)?\b/iu);
});

test("coverage:transition leftover still present must run the opener tap", async () => {
  const compiled = compileAppMapConnection(
    destEndMap(transitionDestEndConnection()),
    "open-settings",
  );
  const steps = compiled.recipes[compiled.rootRecipeId]!.steps;
  assert.equal(steps[1]?.kind, "tap");
  assert.equal(steps[1]?.coverage, "transition");
  assert.equal(steps[0]?.when, undefined);
  assert.equal(steps[1]?.when, undefined);
  assert.equal(steps[2]?.when, undefined);

  const presses: string[] = [];
  const logs: string[] = [];
  const job = recipeJob("transition-leftover", steps);
  const device = leftoverDevice(presses);
  await androidTarget(() =>
    runRecipeSteps(
      job,
      device,
      (line) => logs.push(line),
      () => {},
    ),
  );

  assert.ok(presses.length >= 1, "compiler/runtime skipped a required transition opener");
  assert.equal(skipReasons(job).includes("inspect-setup-skipped"), false);
  assert.ok(executedReasons(job).includes("transition-executed"));
  const executedTitle = describeCoverageStepReason("transition-executed");
  assert.ok(job.steps.some((step) => step.title === executedTitle));
  assert.equal(
    job.steps.some((step) => step.title === describeCoverageStepReason("inspect-setup-skipped")),
    false,
  );
  assert.ok(logs.some((line) => line.includes(executedTitle)));

  const checkJob = recipeJob("transition-check", []);
  await androidTarget(() =>
    runCampaignCheck(
      leftoverDevice(presses),
      {
        kind: "module",
        recipeId: "transition-leftover",
        check: { id: "open-settings", title: "Open Settings" },
      },
      { log: (line) => logs.push(line), job: checkJob, runtime: {} },
      async () => {
        await runRecipeStep(device, steps[1]!, {
          log: (line) => logs.push(line),
          job: checkJob,
          runtime: {},
        });
      },
    ),
  );
  const passed = checkJob.artifacts.find((artifact) => artifact.kind === "campaign-check-result");
  assert.equal((passed?.data as { status?: unknown }).status, "passed");
  assert.deepEqual((passed?.data as { coverageOutcomes?: unknown }).coverageOutcomes, [
    "transition-executed",
  ]);
  assert.equal(summarizeJob(checkJob).checks?.[0]?.coverageNote, executedTitle);
  assert.notEqual(
    summarizeJob(checkJob).checks?.[0]?.coverageNote,
    describeCoverageStepReason("inspect-setup-skipped"),
  );
  assert.ok(logs.some((line) => line.includes(`check passed: Open Settings — ${executedTitle}`)));

  const rows = reviewChecklistRows({
    cases: [
      {
        jobId: checkJob.id,
        name: "Open Settings",
        status: "ok",
        frames: ["screenshots/001.png"],
        note: executedTitle,
      },
    ],
    findings: [],
  });
  assert.equal(rows[0]?.note, executedTitle);
  assert.notEqual(rows[0]?.note, describeCoverageStepReason("inspect-setup-skipped"));
});

test("a coverage:transition opener with leftover dest chrome still present is not skipped", async () => {
  const presses: string[] = [];
  const job = recipeJob("transition-guard", []);
  await androidTarget(() =>
    runRecipeStep(
      leftoverDevice(presses),
      {
        kind: "tap",
        coverage: "transition",
        target: { identifier: "sidebar.settings" },
        when: { target: { identifier: "settings.account" }, condition: "absent" },
      },
      { log: () => {}, job, runtime: {} },
    ),
  );
  assert.ok(
    presses.length >= 1,
    "runtime skipped a required transition opener because leftover chrome was present",
  );
  assert.equal(skipReasons(job).includes("inspect-setup-skipped"), false);
  assert.ok(executedReasons(job).includes("transition-executed"));
});

function settingsTapDestEndConnection(): Connection {
  return {
    ...entity("open-settings-from-home"),
    fromScreenId: "home",
    destination: { kind: "end" },
    state: "ready",
    actions: [
      {
        id: "open-settings",
        kind: "steps",
        steps: [
          { kind: "wait-for", target: { identifier: "composer" }, timeoutMs: 8_000 },
          { kind: "tap", target: { identifier: "sidebar.settings" } },
          { kind: "wait-for", target: { identifier: "settings.account" }, timeoutMs: 8_000 },
        ],
      },
    ],
  };
}

function destEndTest(
  connectionId: string,
  requirementAction?: RequirementActionKind,
): AppMapScenarioTest {
  return {
    ...entity(connectionId),
    name: connectionId,
    kind: "scenario",
    intentSchemaVersion: 1,
    ...(requirementAction ? { requirementAction } : {}),
    steps: [
      {
        id: "open",
        intent: "Open Settings",
        kind: "instruction",
        capture: true,
        binding: { status: "resolved", kind: "connections", connectionIds: [connectionId] },
      },
    ],
  };
}

function destEndRecipeSteps(connection: Connection, requirementAction?: RequirementActionKind) {
  const map = destEndMap(connection);
  const compiled = compileAppMapTest(map, destEndTest(connection.id, requirementAction));
  const destModule = compiled.graph[compiled.plan.rootRecipeId]!.steps.find(
    (step) => step.kind === "module",
  );
  const destEndRecipe =
    destModule?.kind === "module" ? compiled.graph[destModule.recipeId] : undefined;
  assert.ok(destEndRecipe);
  return destEndRecipe.steps;
}

function destEndRuntimeSteps(steps: RecipeStep[]): RecipeStep[] {
  return steps.filter((step) => step.kind !== "screenshot");
}

test("omitted dest-end Test leftover Settings still taps Settings", async () => {
  const steps = destEndRecipeSteps(settingsTapDestEndConnection());
  const opener = steps.find((step) => step.kind === "tap");
  assert.equal(opener?.coverage, "transition");
  assert.equal(opener?.when, undefined);
  const presses: string[] = [];
  const job = recipeJob("omitted-test-action", destEndRuntimeSteps(steps));
  await androidTarget(() =>
    runRecipeSteps(
      job,
      leftoverDevice(presses),
      () => {},
      () => {},
    ),
  );
  assert.ok(presses.length >= 1, "omitted dest-end skipped the Settings tap");
  assert.equal(skipReasons(job).includes("inspect-setup-skipped"), false);
  assert.ok(executedReasons(job).includes("transition-executed"));
  assert.ok(
    job.steps.some((step) => step.title === describeCoverageStepReason("transition-executed")),
  );
});

function bakedInspectLeftoverSkipConnection(): Connection {
  const leftover = { target: { label: "Appearance" }, condition: "absent" as const };
  return {
    ...entity("open-settings-baked"),
    fromScreenId: "home",
    destination: { kind: "end" },
    state: "ready",
    actions: [
      {
        id: "settings-panel",
        kind: "steps",
        steps: [
          {
            kind: "wait-for",
            target: { identifier: "composer" },
            timeoutMs: 8_000,
            coverage: "inspect",
            when: leftover,
          },
          {
            kind: "tap",
            target: { identifier: "sidebar.settings" },
            coverage: "inspect",
            when: leftover,
          },
          { kind: "wait-for", target: { label: "Appearance" }, timeoutMs: 8_000 },
        ],
      },
    ],
  };
}

test("baked inspect leftover skip on omitted dest-end still taps Settings", async () => {
  const steps = destEndRecipeSteps(bakedInspectLeftoverSkipConnection());
  const opener = steps.find((step) => step.kind === "tap");
  assert.equal(opener?.when, undefined);
  assert.equal(opener?.coverage, "transition");
  const presses: string[] = [];
  const job = recipeJob("baked-omitted-tap", destEndRuntimeSteps(steps));
  await androidTarget(() =>
    runRecipeSteps(
      job,
      leftoverDevice(presses),
      () => {},
      () => {},
    ),
  );
  assert.ok(presses.length >= 1, "baked leftover skip dropped the omitted Settings tap");
  assert.equal(skipReasons(job).includes("inspect-setup-skipped"), false);
});

test("baked inspect leftover skip on test-action dest-end still taps Settings", async () => {
  const steps = destEndRecipeSteps(bakedInspectLeftoverSkipConnection(), "test-action");
  const opener = steps.find((step) => step.kind === "tap");
  assert.equal(opener?.when, undefined);
  assert.equal(opener?.coverage, "transition");
  const presses: string[] = [];
  const job = recipeJob("baked-test-action-tap", destEndRuntimeSteps(steps));
  await androidTarget(() =>
    runRecipeSteps(
      job,
      leftoverDevice(presses),
      () => {},
      () => {},
    ),
  );
  assert.ok(presses.length >= 1, "baked leftover skip dropped the test-action Settings tap");
  assert.equal(skipReasons(job).includes("inspect-setup-skipped"), false);
});

test("baked inspect leftover skip on capture-view dest-end still skips opener", async () => {
  const steps = destEndRecipeSteps(bakedInspectLeftoverSkipConnection(), "capture-view");
  const opener = steps.find((step) => step.kind === "tap");
  assert.equal(opener?.when?.condition, "absent");
  assert.equal(opener?.coverage, "inspect");
  const destWait = steps.find(
    (step) => step.kind === "wait-for" && step.target?.label === "Appearance",
  );
  assert.equal(destWait?.when, undefined);
  const presses: string[] = [];
  const job = recipeJob("baked-capture-view-skip", destEndRuntimeSteps(steps));
  await androidTarget(() =>
    runRecipeSteps(
      job,
      leftoverDevice(presses),
      () => {},
      () => {},
    ),
  );
  assert.deepEqual(presses, []);
  assert.ok(skipReasons(job).every((reason) => reason === "inspect-setup-skipped"));
});

test("capture-view Test leftover Settings skips opener and does not look like a tap", async () => {
  const connection = inspectDestEndConnection();
  const steps = destEndRecipeSteps(connection, "capture-view");
  const taps = steps.filter((step) => step.kind === "tap");
  assert.ok(taps.every((step) => step.when?.condition === "absent"));
  assert.ok(taps.every((step) => step.coverage === "inspect"));
  const destWait = steps.find(
    (step) => step.kind === "wait-for" && step.target?.label === "Appearance",
  );
  assert.equal(destWait?.when, undefined);
  const destShot = steps.find((step) => step.kind === "screenshot");
  assert.equal(destShot?.kind, "screenshot");
  assert.equal(destShot?.kind === "screenshot" ? destShot.review?.phase : undefined, "dest");
  const presses: string[] = [];
  const logs: string[] = [];
  const job = recipeJob("capture-view-leftover", destEndRuntimeSteps(steps));
  await androidTarget(() =>
    runRecipeSteps(
      job,
      leftoverDevice(presses),
      (line) => logs.push(line),
      () => {},
    ),
  );
  assert.deepEqual(presses, []);
  assert.ok(skipReasons(job).every((reason) => reason === "inspect-setup-skipped"));
  assert.equal(executedReasons(job).includes("transition-executed"), false);
  assert.equal(
    job.steps.some((step) => step.title.startsWith("Tap ") && step.status === "ok"),
    false,
  );
  assert.equal(logs.some(claimsOpenerTap), false);
});

test("test-action Test from Home still taps Settings when leftover Settings chrome is present", async () => {
  const connection = inspectDestEndConnection();
  connection.coverage = "inspect";
  connection.fromScreenId = "home";
  const map = destEndMap(connection);
  const work = destEndTest(connection.id, "test-action");
  work.startingState = { sourceScreenId: "home" };
  const compiled = compileAppMapTest(map, work);
  const destModule = compiled.graph[compiled.plan.rootRecipeId]!.steps.find(
    (step) => step.kind === "module",
  );
  const destEndRecipe =
    destModule?.kind === "module" ? compiled.graph[destModule.recipeId] : undefined;
  assert.ok(destEndRecipe);
  const opener = destEndRecipe.steps.find((step) => step.kind === "tap");
  assert.equal(opener?.when, undefined);
  assert.equal(opener?.coverage, "transition");
  const destWaitIndex = destEndRecipe.steps.findIndex(
    (step) => step.kind === "wait-for" && step.target?.label === "Appearance",
  );
  assert.ok(destWaitIndex >= 0);
  const destShot = destEndRecipe.steps[destWaitIndex + 1];
  assert.equal(destShot?.kind, "screenshot");
  assert.equal(destShot?.kind === "screenshot" ? destShot.review?.phase : undefined, "dest");
  const presses: string[] = [];
  const job = recipeJob("test-action-from-home", destEndRuntimeSteps(destEndRecipe.steps));
  await androidTarget(() =>
    runRecipeSteps(
      job,
      leftoverDevice(presses),
      () => {},
      () => {},
    ),
  );
  assert.ok(presses.length >= 1, "test-action leftover Settings skipped the Settings tap");
  assert.equal(skipReasons(job).includes("inspect-setup-skipped"), false);
  assert.ok(executedReasons(job).includes("transition-executed"));
});

test("capture-view Routine leftover Settings skips the opener; test-action Routine taps", () => {
  const map = destEndMap(inspectDestEndConnection());
  map.routines["ensure-settings"] = {
    ...entity("ensure-settings"),
    name: "Ensure Settings",
    requirementAction: "capture-view",
    parameters: [],
    actions: inspectDestEndConnection().actions,
  };
  map.routines["open-settings-from-home"] = {
    ...entity("open-settings-from-home"),
    name: "Open Settings from Home",
    requirementAction: "test-action",
    parameters: [],
    actions: transitionDestEndConnection().actions,
  };
  const captureView = compileAppMapRoutine(map, "ensure-settings");
  const captureSteps = captureView.recipes[captureView.rootRecipeId]!.steps;
  assert.ok(captureSteps.some((step) => step.kind === "tap" && step.when?.condition === "absent"));
  const testAction = compileAppMapRoutine(map, "open-settings-from-home");
  const tap = testAction.recipes[testAction.rootRecipeId]!.steps.find(
    (step) => step.kind === "tap",
  );
  assert.equal(tap?.when, undefined);
  assert.equal(tap?.coverage, "transition");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppMap,
  currentOperationContext,
  listJobs,
  mutateStoredAppMap,
  deterministicGenerationProvider,
  registerGenerationProvider,
  writeProjectVariables,
  type LocalSchedule,
  type OperationContext,
} from "@relay/core";
import { defaultJobRouteRuntime } from "./job-routes.js";
import { startScheduledCombine } from "./scheduler-combine.js";
import { defaultSchedulerRuntime, runDueSchedules } from "./scheduler.js";
import { nativeInputDataSetCombineFixture } from "./native-combine-inputs-test-fixture.js";

test("a due native Plan carries its durable occurrence identity through real admission", async (t) => {
  const projectId = "scheduled-native-plan-context";
  const appMapId = "native-plan";
  const targetId = "isolated-native-fixture";
  const scope = { organizationId: "local", projectId, appMapId };
  await createAppMap({ ...scope, name: "Native Plan" });
  await mutateStoredAppMap(projectId, appMapId, (current) => ({
    ...current,
    revision: current.revision + 1,
    screens: {
      home: {
        ...scope,
        id: "home",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: ["home-native"],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: {
      "home-native": {
        ...scope,
        id: "home-native",
        screenId: "home",
        targetProfile: {
          id: "native-profile",
          targetId,
          source: "device",
          platform: "android",
          name: "Native fixture",
          capabilities: ["snapshot"],
          observedAt: 1,
        },
        observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
        evidenceIds: [],
        evidenceUris: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    variables: {
      language: {
        ...scope,
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example.fixture" },
        options: [{ id: "en", label: "English" }],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    tests: {
      prepare: {
        ...scope,
        id: "prepare",
        name: "Prepare",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "prepare",
            kind: "script",
            intent: "Prepare without controlling the target",
            binding: { status: "resolved", kind: "script", source: 'return "{{chat_prompt}}";' },
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    combines: {
      daily: {
        ...scope,
        id: "daily",
        name: "Daily",
        variableIds: ["language"],
        testIds: ["prepare"],
        selected: { language: ["en"] },
        cellRuntimeProfiles: [
          { testId: "prepare", values: { language: "en" }, targetProfileId: "native-profile" },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
  }));
  await writeProjectVariables(projectId, {
    expectedRevision: 0,
    value: [
      {
        id: "prompt-data",
        name: "chat_prompt",
        scope: "shared",
        source: "generated",
        prompt: "Ask about geography",
      },
    ],
  });
  const generationSeeds: number[] = [];
  const removeProvider = registerGenerationProvider({
    id: "deterministic",
    async generate(input) {
      generationSeeds.push(input.seed!);
      return {
        provider: "deterministic",
        model: "fixture",
        values: [`Prompt ${input.seed}`],
        generatedAt: 1,
      };
    },
  });
  t.after(() => {
    removeProvider();
    registerGenerationProvider(deterministicGenerationProvider);
  });
  const schedule: LocalSchedule = {
    id: "native-due",
    recipeId: "",
    combineId: "daily",
    appMapId,
    projectId,
    targetKind: "device",
    targetId,
    platform: "android",
    intervalMinutes: 30,
    repetitions: 1,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    nextRunAt: 1_000,
  };
  const observed: Array<OperationContext | undefined> = [];
  const failures: string[] = [];
  const marked: string[] = [];
  const before = listJobs().length;
  t.mock.method(defaultJobRouteRuntime, "listDevices", async () => []);
  t.mock.method(
    defaultJobRouteRuntime,
    "assertTargetControl",
    async (...args: Parameters<typeof defaultJobRouteRuntime.assertTargetControl>) => {
      const [, id] = args;
      assert.equal(id, targetId);
      observed.push(currentOperationContext());
      assert.equal(
        generationSeeds.length,
        observed.length,
        "input generation completed before native lease admission",
      );
      // Exercise the native starter's real map binding and preflight, then stop
      // at its lease boundary so this regression cannot dispatch target actions.
      throw new Error("fixture lease unavailable");
    },
  );
  for (const at of [2_000, 9_000]) {
    await runDueSchedules(at, {
      ...defaultSchedulerRuntime,
      listSchedules: async () => [schedule],
      listDevices: async () => [],
      listTargets: async () => [],
      startCombine: startScheduledCombine,
      markScheduleRun: async (id) => {
        marked.push(id);
      },
      markScheduleFailure: async (_id, detail) => {
        failures.push(detail);
      },
      notify: async () => {},
    });
  }
  assert.equal(observed.length, 2, "both polls reached native lease admission");
  assert.equal(
    generationSeeds[0],
    generationSeeds[1],
    "the durable due occurrence fixes the input seed across later polls",
  );
  assert.notEqual(generationSeeds[0], 2000);
  assert.notEqual(generationSeeds[0], 9000);
  for (const [index, context] of observed.entries()) {
    assert.equal(context?.actorId, "system:scheduler");
    assert.equal(context?.actorKind, "system");
    assert.equal(context?.organizationId, "local");
    assert.equal(context?.projectId, projectId);
    assert.equal(context?.operationId, "job.combine.start");
    assert.equal(context?.requestId, "schedule:native-due:1000");
    assert.equal(context?.idempotencyKey, "schedule:native-due:1000");
    assert.equal(context?.issuedAt, index === 0 ? 2_000 : 9_000);
  }
  assert.deepEqual(failures, ["fixture lease unavailable", "fixture lease unavailable"]);
  assert.deepEqual(marked, []);
  assert.equal(listJobs().length, before, "failed admission queued no jobs");
  assert.equal(currentOperationContext(), undefined, "the occurrence context does not escape");
});

test("scheduled input-only native Plan approves both rows and freezes selected scope before control", async (t) => {
  const projectId = "scheduled-native-input-rows";
  const { appMapId, targetId, values } = await nativeInputDataSetCombineFixture(projectId);
  await mutateStoredAppMap(projectId, appMapId, (current) => ({
    ...current,
    revision: current.revision + 1,
    tests: {
      prompt: {
        ...current.tests.prompt!,
        steps: [
          {
            id: "prompt",
            kind: "script",
            intent: "Use frozen inputs",
            binding: {
              status: "resolved",
              kind: "script",
              source: 'return "{{chat_prompt}} / {{receipt_guard}}";',
            },
          },
        ],
      },
    },
  }));
  await writeProjectVariables(projectId, {
    expectedRevision: 1,
    value: [
      { id: "prompt-data", name: "chat_prompt", scope: "shared", source: "list", values },
      {
        id: "receipt-data",
        name: "receipt_guard",
        scope: "shared",
        source: "generated",
        prompt: "Freeze before control",
      },
    ],
  });
  const seeds: number[] = [];
  const removeProvider = registerGenerationProvider({
    id: "deterministic",
    async generate(input) {
      seeds.push(input.seed!);
      return {
        provider: "deterministic",
        model: "fixture",
        values: ["Frozen receipt"],
        generatedAt: 1,
      };
    },
  });
  t.after(() => {
    removeProvider();
    registerGenerationProvider(deterministicGenerationProvider);
  });
  let controls = 0;
  let discoveries = 0;
  t.mock.method(defaultJobRouteRuntime, "listDevices", async () => {
    discoveries++;
    return [];
  });
  t.mock.method(
    defaultJobRouteRuntime,
    "assertTargetControl",
    async (
      _scope: Parameters<typeof defaultJobRouteRuntime.assertTargetControl>[0],
      id: string,
    ) => {
      assert.equal(id, targetId);
      controls++;
      assert.equal(seeds.length, 2, "both input cells are frozen before any target control");
      assert.equal(currentOperationContext()?.requestId, "schedule:input-only-due:1000");
      throw new Error("fixture control stop");
    },
  );
  const schedule: LocalSchedule = {
    id: "input-only-due",
    recipeId: "",
    combineId: "daily",
    appMapId,
    projectId,
    targetKind: "device",
    targetId,
    platform: "android",
    intervalMinutes: 30,
    repetitions: 1,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    nextRunAt: 1000,
  };
  const failures: string[] = [];
  const poll = () =>
    runDueSchedules(2000, {
      ...defaultSchedulerRuntime,
      listSchedules: async () => [schedule],
      listDevices: async () => [],
      listTargets: async () => [],
      startCombine: startScheduledCombine,
      markScheduleFailure: async (_id, detail) => {
        failures.push(detail);
      },
      markScheduleRun: async () => {
        assert.fail("failed target admission must not advance occurrence");
      },
      notify: async () => {},
    });
  const before = listJobs().length;
  await poll();
  assert.equal(controls, 1);
  assert.equal(seeds.length, 2);
  const discoveriesBeforeInvalid = discoveries;
  await writeProjectVariables(projectId, {
    expectedRevision: 2,
    value: [
      {
        id: "prompt-data",
        name: "chat_prompt",
        scope: "shared",
        source: "list",
        values: [values[0]!],
      },
      {
        id: "receipt-data",
        name: "receipt_guard",
        scope: "shared",
        source: "generated",
        prompt: "Freeze before control",
      },
    ],
  });
  await poll();
  assert.equal(controls, 1);
  assert.equal(
    discoveries,
    discoveriesBeforeInvalid,
    "unapproved second row blocks before target discovery",
  );
  assert.equal(seeds.length, 2, "invalid selected scope does not generate any inputs");
  assert.match(failures[1]!, /approved Project input values/);
  assert.equal(listJobs().length, before, "no fixture target actions are dispatched");
});

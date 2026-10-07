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

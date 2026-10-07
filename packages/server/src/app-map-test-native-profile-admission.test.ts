import assert from "node:assert/strict";
import test from "node:test";
import {
  appMapRuntimeTargetProfileFromSaved,
  nativeCaptureTargetProfile,
  nativeViewportForTarget,
  NATIVE_VIEWPORT_FACT_TTL_MS,
  recordNativeViewport,
  type NativeDeviceFacts,
} from "@relay/core";
import type {
  AppMap,
  AppMapCompiledRuntimeTargetProfile,
  AppMapScenarioTest,
} from "@relay/protocol";
import { freshNativeRunProfileFacts } from "./app-map-test-native-profile-admission.js";
import { frozenEvidenceTargetProfileForTarget } from "./app-map-run-target-admission.js";
import { assertTestRunInputAvailability } from "./app-map-test-run-inputs.js";
import { HttpError } from "./http.js";
import { prepareAppMapCompanionTestRun } from "./app-map-test-run-prepare.js";

const target = { kind: "device", targetId: "admission-ipad", platform: "ios" } as const;
const landscape = { width: 1112, height: 834 };
const canonical = appMapRuntimeTargetProfileFromSaved(
  nativeCaptureTargetProfile({
    ...target,
    viewport: landscape,
    osVersion: "17.7.11",
    model: "iPad Pro",
    observedAt: 1,
  }),
);
const profiles: AppMapCompiledRuntimeTargetProfile[] = [
  { id: `device:${target.targetId}`, targetId: target.targetId, platform: "ios", capabilities: [] },
  { ...canonical, id: `device:${target.targetId}-1112x834` },
  canonical,
];
const observed: NativeDeviceFacts = {
  serial: target.targetId,
  platform: "ios",
  osVersion: "17.7.11",
};
const originApplication = "com.example.product";

test("automatic admission qualifies current root bounds after the capture cache expires", async () => {
  recordNativeViewport(target, landscape, 1);
  assert.equal(nativeViewportForTarget(target, NATIVE_VIEWPORT_FACT_TTL_MS + 2), undefined);
  const calls: string[] = [];
  const facts = await freshNativeRunProfileFacts({
    target,
    profiles,
    observedDevice: observed,
    originApplication,
    validateOffline: async () => {
      calls.push("offline");
    },
    observeViewport: async (serial, suppliedOrigin) => {
      assert.equal(serial, target.targetId);
      assert.equal(suppliedOrigin, originApplication);
      calls.push("root");
      return landscape;
    },
  });
  assert.deepEqual(calls, ["offline", "root"]);
  assert.equal(
    frozenEvidenceTargetProfileForTarget({ target, profiles, observedDevice: facts })?.id,
    canonical.id,
  );
  assert.equal(observed.viewport, undefined, "passive inventory stays unchanged");
});

test("current rotation and conflicting saved identities cannot fall back to recorded geometry", async () => {
  const facts = await freshNativeRunProfileFacts({
    target,
    profiles,
    observedDevice: observed,
    originApplication,
    validateOffline: async () => undefined,
    observeViewport: async () => ({ width: 834, height: 1112 }),
  });
  assert.throws(
    () => frozenEvidenceTargetProfileForTarget({ target, profiles, observedDevice: facts }),
    (error: unknown) =>
      error instanceof HttpError && error.body?.code === "TARGET_PROFILE_SELECTION_REQUIRED",
  );
  assert.throws(
    () =>
      frozenEvidenceTargetProfileForTarget({
        target,
        profiles: [...profiles, { ...canonical, capabilities: [] }],
        observedDevice: { ...observed, viewport: landscape },
      }),
    (error: unknown) =>
      error instanceof HttpError && error.body?.code === "TARGET_PROFILE_SELECTION_REQUIRED",
  );
});

test("known missing/private inputs reject before any root read without generating values", async () => {
  const recipeGraph = {
    prompt: {
      id: "prompt",
      title: "Prompt",
      source: "custom" as const,
      createdAt: 1,
      updatedAt: 1,
      steps: [{ kind: "type" as const, text: "{{chat_prompt}}" }],
    },
  };
  for (const value of [
    [],
    [
      {
        id: "prompt",
        name: "chat_prompt",
        scope: "private" as const,
        source: "static" as const,
        values: ["must not use a private stored default"],
      },
    ],
  ]) {
    let reads = 0;
    await assert.rejects(
      freshNativeRunProfileFacts({
        target,
        profiles,
        observedDevice: observed,
        originApplication,
        validateOffline: () =>
          assertTestRunInputAvailability({
            projectId: "fixture",
            recipeGraph,
            readProjectVariables: async () => ({ revision: 1, updatedAt: 1, value }),
          }),
        observeViewport: async () => {
          reads++;
          return landscape;
        },
      }),
      (error: unknown) =>
        error instanceof HttpError &&
        ["missing-variable", "missing-private-value"].includes(String(error.body?.code)),
    );
    assert.equal(reads, 0);
  }
  await assertTestRunInputAvailability({
    projectId: "fixture",
    recipeGraph,
    readProjectVariables: async () => ({
      revision: 1,
      updatedAt: 1,
      value: [
        {
          id: "prompt",
          name: "chat_prompt",
          scope: "shared",
          source: "generated",
          prompt: "Generate once",
        },
      ],
    }),
  });
});

test("unavailable geometry is a definitive admission rejection and never retries", async () => {
  let reads = 0;
  await assert.rejects(
    freshNativeRunProfileFacts({
      target,
      profiles,
      observedDevice: observed,
      originApplication,
      validateOffline: async () => undefined,
      observeViewport: async () => {
        reads++;
        throw new Error("inspection unavailable");
      },
    }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.body?.code === "TARGET_VIEWPORT_UNAVAILABLE" &&
      !JSON.stringify(error.body).includes(target.targetId),
  );
  assert.equal(reads, 1);
});

test("passive/current, foreign, missing and Android facts do not invoke an iOS read", async () => {
  for (const input of [
    { target, profiles, observedDevice: { ...observed, viewport: landscape } },
    { target, profiles, observedDevice: undefined },
    { target, profiles, observedDevice: { ...observed, serial: "another-ipad" } },
    { target, profiles: [canonical], observedDevice: observed },
    { target: { ...target, platform: "android" as const }, profiles, observedDevice: observed },
  ]) {
    await freshNativeRunProfileFacts({
      ...input,
      validateOffline: async () => {
        throw new Error("must stay passive");
      },
      observeViewport: async () => {
        throw new Error("must stay passive");
      },
    });
  }
});

function savedFixture(): { map: AppMap; test: AppMapScenarioTest } {
  const scope = { appMapId: "viewport-fixture", organizationId: "org", projectId: "project" };
  const savedTest: AppMapScenarioTest = {
    ...scope,
    id: "prompt",
    name: "Prompt",
    kind: "scenario",
    intentSchemaVersion: 1,
    originApplication,
    createdAt: 1,
    updatedAt: 1,
    steps: [
      {
        id: "prompt",
        kind: "script",
        intent: "Use a prompt",
        binding: { status: "resolved", kind: "script", source: 'return "{{chat_prompt}}";' },
      },
    ],
  };
  const map: AppMap = {
    ...scope,
    id: scope.appMapId,
    schemaVersion: 1,
    name: "Viewport fixture",
    revision: 7,
    notes: {},
    groups: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: { prompt: savedTest },
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
    screens: {
      home: {
        ...scope,
        id: "home",
        title: "Home",
        createdAt: 1,
        updatedAt: 1,
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: ["legacy", "current"],
      },
    },
    screenVariants: Object.fromEntries(
      profiles.map((profile, index) => [
        `profile-${index}`,
        {
          ...scope,
          id: `profile-${index}`,
          screenId: "home",
          observationId: `observation-${index}`,
          targetProfile: {
            ...profile,
            source: "device",
            name: "iPad",
            capabilities: [...(profile.capabilities ?? [])],
            observedAt: 1,
          },
          observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
          evidenceIds: [],
          evidenceUris: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ),
  };
  map.screens.home!.variantIds = Object.keys(map.screenVariants);
  return { map, test: savedTest };
}

test("canonical preparation checks generic offline inputs before reading and then compiles the exact setup", async () => {
  const fixture = savedFixture();
  const calls: string[] = [];
  const options = {
    ...fixture,
    target,
    projectId: "project",
    observedDevice: observed,
    compileOptions: {},
    nativeProfileObservation: {
      validateInputs: async (
        compiled: Awaited<ReturnType<typeof prepareAppMapCompanionTestRun>>["compiled"],
      ) => {
        calls.push("inputs");
        await assertTestRunInputAvailability({
          projectId: "project",
          recipeGraph: compiled.graph,
          readProjectVariables: async () => ({ revision: 1, updatedAt: 1, value: [] }),
        });
      },
      observeViewport: async (_serial: string, suppliedOrigin: string) => {
        assert.equal(suppliedOrigin, originApplication);
        calls.push("window");
        return landscape;
      },
    },
  };
  await assert.rejects(
    prepareAppMapCompanionTestRun(options),
    (error: unknown) => error instanceof HttpError && error.body?.code === "missing-variable",
  );
  assert.deepEqual(calls, ["inputs"]);
  calls.length = 0;
  options.nativeProfileObservation.validateInputs = async (compiled) => {
    calls.push("inputs");
    await assertTestRunInputAvailability({
      projectId: "project",
      recipeGraph: compiled.graph,
      variables: { chat_prompt: "Hello" },
      readProjectVariables: async () => ({ revision: 1, updatedAt: 1, value: [] }),
    });
  };
  const prepared = await prepareAppMapCompanionTestRun(options);
  assert.deepEqual(calls, ["inputs", "window"]);
  assert.equal(prepared.runtimeTargetProfile?.id, canonical.id);
  assert.equal(prepared.compiled.plan.runtimeTargetProfile?.id, canonical.id);
  assert.deepEqual(prepared.observedDevice?.viewport, landscape);
});

test("canonical preparation rejects generic compile blockers before the window observer", async () => {
  const fixture = savedFixture();
  fixture.test.steps = [
    {
      id: "missing",
      kind: "instruction",
      intent: "Open an unrecorded route",
      binding: { status: "unresolved", reason: "No reviewed route" },
    },
  ];
  let reads = 0;
  await assert.rejects(
    prepareAppMapCompanionTestRun({
      ...fixture,
      target,
      projectId: "project",
      observedDevice: observed,
      compileOptions: {},
      nativeProfileObservation: {
        validateInputs: async () => undefined,
        observeViewport: async () => {
          reads++;
          return landscape;
        },
      },
    }),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );
  assert.equal(reads, 0);
});

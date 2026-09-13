import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppMap,
  AppMapCombine,
  AppMapScenarioTest,
  ScreenVariant,
  TargetProfile,
} from "@relay/protocol";
import { compileBrowserEnvironment } from "@relay/protocol";
import { runWithOperationContext } from "./operation-context.js";
import {
  AppMapCombineCellContractError,
  prepareAppMapCombineCells,
  resolveSavedAppMapRuntimeTargetProfile,
  unresolvedTargetProfileMessage,
} from "./app-map-combine-cell-prepare.js";
import { stagePreparedAppMapCombineCells } from "./app-map-combine-cell-run.js";

function scope(id: string) {
  return { organizationId: "org", projectId: "project", appMapId: "settings", id };
}

function scriptTest(): AppMapScenarioTest {
  return {
    ...scope("script-only"),
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
    createdAt: 1,
    updatedAt: 1,
  };
}

function profile(input: {
  id: string;
  targetId: string;
  name?: string;
  platform?: "android" | "ios";
}): TargetProfile {
  return {
    id: input.id,
    targetId: input.targetId,
    source: "device",
    platform: input.platform ?? "android",
    name: input.name ?? input.id,
    capabilities: ["snapshot"],
    observedAt: 1,
  };
}

function variant(id: string, targetProfile: TargetProfile): ScreenVariant {
  return {
    ...scope(id),
    screenId: "home",
    targetProfile,
    observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
    evidenceIds: [],
    evidenceUris: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function mapWithProfiles(
  profiles: TargetProfile[],
  selected: Record<string, string[]> = { language: ["en"] },
): AppMap {
  const work = scriptTest();
  const combine: AppMapCombine = {
    ...scope("locales"),
    name: "Language × Prepare",
    variableIds: ["language"],
    testIds: [work.id],
    selected,
    cellRuntimeProfiles: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    schemaVersion: 1,
    id: "settings",
    organizationId: "org",
    projectId: "project",
    name: "Settings",
    revision: 3,
    notes: {},
    groups: {},
    screens: {
      home: {
        ...scope("home"),
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: profiles.map((_, index) => `home-${index}`),
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: Object.fromEntries(
      profiles.map((targetProfile, index) => [
        `home-${index}`,
        variant(`home-${index}`, targetProfile),
      ]),
    ),
    connections: {},
    caseStacks: {},
    variables: {
      language: {
        ...scope("language"),
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example" },
        options: [
          { id: "en", label: "English" },
          { id: "it", label: "Italiano" },
          { id: "ja", label: "日本語" },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    tests: { [work.id]: work },
    combines: { [combine.id]: combine },
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

const pixel = { targetId: "pixel-1", platform: "android" } as const;

test("empty Repeat dimensions still prepare one implicit paired world", async () => {
  const map = mapWithProfiles([profile({ id: "pixel-en", targetId: "pixel-1" })]);
  const prepared = await prepareAppMapCombineCells({
    map,
    combine: {
      ...map.combines.locales!,
      id: "ad-hoc",
      variableIds: [],
      selected: {},
    },
    target: { ...pixel },
    defaultTargetProfileId: "pixel-en",
  });
  assert.equal(prepared.cells.length, 1);
  assert.equal(prepared.matrix.cases.length, 1);
  assert.equal(prepared.matrix.cases[0]!.name, "paired");
  assert.deepEqual(prepared.cells[0]!.values, {});
  assert.equal(prepared.cells[0]!.targetProfileId, "pixel-en");
});

test("resolveSavedAppMapRuntimeTargetProfile inherits the only saved profile for a target", () => {
  const map = mapWithProfiles([
    {
      ...profile({ id: "device:RQ8-1080x2340", targetId: "RQ8" }),
      viewport: { width: 1080, height: 2340 },
    },
    profile({ id: "ipad-en", targetId: "ipad-1", platform: "ios" }),
  ]);
  const resolved = resolveSavedAppMapRuntimeTargetProfile({
    map,
    target: { targetId: "RQ8", platform: "android" },
  });
  assert.deepEqual(resolved, {
    id: "device:RQ8-1080x2340",
    targetId: "RQ8",
    platform: "android",
    viewport: { width: 1080, height: 2340 },
    capabilities: ["snapshot"],
  });
});

test("Combine freezes the complete saved browser profile", () => {
  const browserCaseProfile = compileBrowserEnvironment({
    engine: "webkit",
    viewport: { width: 390, height: 844 },
    locale: "pt-BR",
    timezoneId: "America/Maceio",
    colorScheme: "dark",
    networkProfile: "wifi-slow",
    authenticationFixtureId: "member-session",
  });
  const map = mapWithProfiles([
    {
      id: "browser:checkout",
      targetId: "checkout",
      source: "browser",
      platform: "browser",
      name: "Checkout",
      browserCaseProfile,
      capabilities: ["snapshot"],
      observedAt: 1,
    },
  ]);
  assert.deepEqual(
    resolveSavedAppMapRuntimeTargetProfile({
      map,
      target: { targetId: "checkout", platform: "browser" },
    }),
    {
      id: "browser:checkout",
      targetId: "checkout",
      platform: "browser",
      viewport: browserCaseProfile.viewport,
      browserCaseProfile,
    },
  );
});

test("Combine refuses a legacy browser profile before staging", () => {
  const map = mapWithProfiles([
    {
      id: "browser:legacy",
      targetId: "legacy",
      source: "browser",
      platform: "browser",
      name: "Legacy",
      viewport: { width: 800, height: 600 },
      capabilities: ["snapshot"],
      observedAt: 1,
    },
  ]);
  assert.throws(
    () =>
      resolveSavedAppMapRuntimeTargetProfile({
        map,
        target: { targetId: "legacy", platform: "browser" },
      }),
    (error: unknown) =>
      error instanceof AppMapCombineCellContractError &&
      error.message.includes("no frozen browser environment"),
  );
});

test("resolveSavedAppMapRuntimeTargetProfile fails closed listing candidates when several match", () => {
  const map = mapWithProfiles([
    profile({ id: "pixel-en", targetId: "pixel-1", name: "Pixel · English" }),
    profile({ id: "pixel-it", targetId: "pixel-1", name: "Pixel · Italian" }),
  ]);
  assert.throws(
    () => resolveSavedAppMapRuntimeTargetProfile({ map, target: { ...pixel } }),
    (error: unknown) =>
      error instanceof AppMapCombineCellContractError &&
      error.message.includes("Multiple saved runtime profiles bind to android:pixel-1") &&
      error.message.includes("pixel-en, pixel-it"),
  );
});

test("resolveSavedAppMapRuntimeTargetProfile asks for a capture when the target has no saved profile", () => {
  const map = mapWithProfiles([profile({ id: "ipad-en", targetId: "ipad-1", platform: "ios" })]);
  assert.throws(
    () => resolveSavedAppMapRuntimeTargetProfile({ map, target: { ...pixel } }),
    (error: unknown) =>
      error instanceof AppMapCombineCellContractError &&
      error.message.includes("No saved runtime profile for target android:pixel-1") &&
      error.message.includes("capture a screen on this target first"),
  );
});

test("resolveSavedAppMapRuntimeTargetProfile still prefers an explicit id over inheritance", () => {
  const map = mapWithProfiles([
    profile({ id: "pixel-en", targetId: "pixel-1" }),
    profile({ id: "pixel-it", targetId: "pixel-1" }),
  ]);
  const resolved = resolveSavedAppMapRuntimeTargetProfile({
    map,
    targetProfileId: "pixel-it",
    target: { ...pixel },
  });
  assert.equal(resolved.id, "pixel-it");
});

test("a cell run with a concrete target auto-inherits the single matching saved profile", async () => {
  const inheritedId = "device:RQ8-1080x2340";
  const map = mapWithProfiles([profile({ id: inheritedId, targetId: "RQ8" })]);
  const prepared = await prepareAppMapCombineCells({
    map,
    combine: map.combines.locales!,
    target: { targetId: "RQ8", platform: "android" },
  });
  assert.equal(prepared.cells.length, 1);
  assert.equal(prepared.cells[0]!.targetProfileId, inheritedId);
  assert.equal(prepared.cells[0]!.targetProfileIdSource, "inherited");
});

test("the frozen inputs artifact records an inherited profile id for audit", async () => {
  const inheritedId = "device:RQ8-1080x2340";
  const map = mapWithProfiles([profile({ id: inheritedId, targetId: "RQ8" })]);
  const prepared = await prepareAppMapCombineCells({
    map,
    combine: map.combines.locales!,
    target: { targetId: "RQ8", platform: "android" },
  });
  const staged = runWithOperationContext(
    {
      schemaVersion: 1,
      actorId: "human:planner",
      actorKind: "human",
      organizationId: "org",
      projectId: "project",
      operationId: "job.combine.start",
      requestId: "combine-prepare-inheritance-test",
      idempotencyKey: "combine-prepare-inheritance-test",
      issuedAt: 1,
    },
    () =>
      stagePreparedAppMapCombineCells({
        cells: prepared.cells,
        title: "Language × Prepare",
        targetForCell: (cell) => cell.executionTarget,
        queuedTargetProfile: (cell) => ({
          ...cell.selectedRuntimeTargetProfile,
          source: "device",
          name: cell.selectedRuntimeTargetProfile.id,
          capabilities: ["snapshot"],
          observedAt: 1,
        }),
        projectId: "project",
        ownerId: "human:planner",
      }),
  );
  const frozen = staged.jobs[0]!.artifacts.find((artifact) => artifact.kind === "frozen-inputs");
  assert.ok(frozen, "staged combine cell job carries a frozen-inputs artifact");
  const data = frozen.data as Record<string, unknown>;
  assert.equal(data.kind, "combine-cell");
  assert.equal(data.targetProfileId, inheritedId);
  assert.equal(data.targetProfileIdSource, "inherited");
  assert.equal(data.cellId, prepared.cells[0]!.cellId);
  assert.equal(data.executionTarget, prepared.cells[0]!.executionTarget);
});

test("an explicit per-cell binding wins over inheritance and is recorded as explicit", async () => {
  const map = mapWithProfiles([profile({ id: "device:RQ8-1080x2340", targetId: "RQ8" })]);
  const combine = map.combines.locales!;
  combine.cellRuntimeProfiles = [
    { testId: "script-only", values: { language: "en" }, targetProfileId: "device:RQ8-1080x2340" },
  ];
  const prepared = await prepareAppMapCombineCells({
    map,
    combine,
    target: { targetId: "RQ8", platform: "android" },
  });
  assert.equal(prepared.cells[0]!.targetProfileId, "device:RQ8-1080x2340");
  assert.equal(prepared.cells[0]!.targetProfileIdSource, "explicit");
});

test("a multi-profile target fails closed and lists the candidate ids", async () => {
  const map = mapWithProfiles(
    [
      profile({ id: "pixel-en", targetId: "pixel-1", name: "Pixel · English" }),
      profile({ id: "pixel-it", targetId: "pixel-1", name: "Pixel · Italian" }),
    ],
    { language: ["ja"] },
  );
  await assert.rejects(
    () => prepareAppMapCombineCells({ map, combine: map.combines.locales!, target: { ...pixel } }),
    (error: unknown) =>
      error instanceof AppMapCombineCellContractError &&
      error.issues.some(
        (item) =>
          item.code === "missing-binding" &&
          item.message.includes("Multiple saved runtime profiles bind to android:pixel-1") &&
          item.message.includes("pixel-en, pixel-it"),
      ),
  );
});

test("a concrete target with no saved profile fails with capture guidance", async () => {
  const map = mapWithProfiles([profile({ id: "pixel-en", targetId: "pixel-1" })]);
  await assert.rejects(
    () =>
      prepareAppMapCombineCells({
        map,
        combine: map.combines.locales!,
        target: { targetId: "vacuum-1", platform: "android" },
      }),
    (error: unknown) =>
      error instanceof AppMapCombineCellContractError &&
      error.issues.some(
        (item) =>
          item.code === "missing-binding" &&
          item.message.includes("No saved runtime profile for target android:vacuum-1") &&
          item.message.includes("capture a screen on this target first"),
      ),
  );
});

test("unresolved runtime-profile copy names the target and saved ids", () => {
  assert.match(
    unresolvedTargetProfileMessage({ targetId: "chatgpt-qa-pilot", platform: "browser" }, []),
    /No saved runtime profile for target browser:chatgpt-qa-pilot/u,
  );
  assert.match(
    unresolvedTargetProfileMessage({ targetId: "grok-com", platform: "browser" }, [
      "browser:grok-com",
      "browser:grok-com-1280x800-339a5a430a41",
    ]),
    /browser:grok-com-1280x800-339a5a430a41/u,
  );
});

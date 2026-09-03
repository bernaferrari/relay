import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppMap,
  AppMapCombine,
  AppMapCombineCellRuntimeProfile,
  AppMapScenarioTest,
  AppMapVariable,
} from "@relay/protocol";
import type { PersistedRun } from "./api-types";
import {
  deriveFirstOperatorRunState,
  parseFirstOperatorRunPreference,
  shouldShowFirstOperatorRun,
} from "./first-operator-run";
import { firstTestTargetStatus } from "./onboarding";

function readyTarget() {
  return firstTestTargetStatus({
    online: true,
    target: { serial: "pixel", name: "Pixel 9", platform: "android", booted: true },
    readiness: { kind: "ready" },
    hasControl: true,
  });
}

function testDoc(): AppMapScenarioTest {
  return {
    id: "settings-tour",
    organizationId: "local",
    projectId: "default",
    appMapId: "map-1",
    name: "Settings tour",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function variable(
  id: string,
  name: string,
  optionIds: string[],
  kind: AppMapVariable["kind"] = "custom",
): AppMapVariable {
  return {
    id,
    organizationId: "local",
    projectId: "default",
    appMapId: "map-1",
    name,
    kind,
    apply: { kind: "list" },
    options: optionIds.map((optionId) => ({ id: optionId, label: optionId })),
    createdAt: 1,
    updatedAt: 1,
  };
}

function combine(
  bindings: AppMapCombine["cellRuntimeProfiles"] = [],
  extra: Partial<AppMapCombine> = {},
): AppMapCombine {
  return {
    id: "locales",
    organizationId: "local",
    projectId: "default",
    appMapId: "map-1",
    name: "Language × Settings tour",
    variableIds: ["language"],
    testIds: ["settings-tour"],
    selected: { language: ["en", "it"] },
    cellRuntimeProfiles: bindings,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function map(
  overrides: Partial<AppMap> = {},
): Pick<AppMap, "id" | "tests" | "variables" | "combines"> {
  return {
    id: "map-1",
    tests: { "settings-tour": testDoc() },
    variables: { language: variable("language", "Language", ["en", "it"], "language") },
    combines: { locales: combine() },
    ...overrides,
  };
}

test("honest device state blocks bind and run", () => {
  const state = deriveFirstOperatorRunState({
    target: firstTestTargetStatus({
      online: true,
      target: undefined,
      readiness: { kind: "choose-device" },
      hasControl: false,
    }),
    map: map(),
  });
  assert.equal(state.stage, "device");
  assert.equal(state.action, "device");
  assert.match(state.detail, /Pick a connected device or browser/u);
});

test("unbound Combine cells ask for an explicit profile without inventing one", () => {
  const state = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: map(),
  });
  assert.equal(state.stage, "bind");
  assert.equal(state.action, "combine");
  assert.equal(state.combineId, "locales");
  assert.match(state.detail, /no runtime profile/u);
});

test("a bound Combine with no report asks to run one cell", () => {
  const state = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: map({
      combines: {
        locales: combine([
          { testId: "settings-tour", values: { language: "en" }, targetProfileId: "pixel-en" },
          { testId: "settings-tour", values: { language: "it" }, targetProfileId: "pixel-it" },
        ]),
      },
    }),
  });
  assert.equal(state.stage, "run");
  assert.equal(state.action, "combine");
});

function binding(
  values: Record<string, string>,
  targetProfileId: string,
): AppMapCombineCellRuntimeProfile {
  return { testId: "settings-tour", values, targetProfileId };
}

test("a zip Combine is bound by its diagonal, not the cartesian product", () => {
  const languages = Array.from({ length: 15 }, (_, index) => `l${String(index).padStart(2, "0")}`);
  const themes = Array.from({ length: 15 }, (_, index) => `t${String(index).padStart(2, "0")}`);
  const zip = combine(
    languages.map((language, index) =>
      binding({ language, theme: themes[index]! }, `profile-${index}`),
    ),
    {
      id: "zip",
      name: "Language × Theme",
      variableIds: ["language", "theme"],
      selected: { language: languages, theme: themes },
      strategy: "zip",
    },
  );
  const state = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: map({
      variables: {
        language: variable("language", "Language", languages, "language"),
        theme: variable("theme", "Theme", themes, "theme"),
      },
      combines: { zip },
    }),
  });
  assert.equal(state.stage, "run", "zip bindings must not be scored against a cartesian product");
});

test("a fully bound 3-variable cartesian is not stuck on bind", () => {
  const languages = ["en", "de", "fr", "it", "pt"];
  const themes = ["dark", "light", "system", "high", "low"];
  const accounts = ["a", "b"];
  const worlds = languages.flatMap((language) =>
    themes.flatMap((theme) => accounts.map((account) => ({ language, theme, account }))),
  );
  const state = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: map({
      variables: {
        language: variable("language", "Language", languages, "language"),
        theme: variable("theme", "Theme", themes, "theme"),
        account: variable("account", "Account", accounts, "account"),
      },
      combines: {
        locales: combine(
          worlds.map((values, index) => binding(values, `profile-${index}`)),
          {
            variableIds: ["language", "theme", "account"],
            selected: { language: languages, theme: themes, account: accounts },
            strategy: "cartesian",
          },
        ),
      },
    }),
  });
  assert.equal(worlds.length, 50);
  assert.equal(state.stage, "run");
});

function run(input: {
  id: string;
  action?: string;
  status?: string;
  artifacts?: PersistedRun["artifacts"];
}): PersistedRun {
  return {
    id: input.id,
    action: input.action ?? "option-run-batch-1",
    status: input.status ?? "ok",
    attempts: 1,
    dir: ".relay/runs/test",
    frames: [],
    steps: [],
    logs: [],
    writtenAt: 1,
    artifacts: input.artifacts ?? [],
  };
}

test("completion requires this map's Combine or Test artifact, never a combine action string", () => {
  const bound = map({
    combines: {
      locales: combine([
        binding({ language: "en" }, "pixel-en"),
        binding({ language: "it" }, "pixel-it"),
      ]),
    },
  });
  const foreign = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: bound,
    runs: [
      run({
        id: "other-map",
        action: "job.combine.start",
        artifacts: [
          {
            kind: "frozen-inputs",
            capturedAt: 1,
            data: { appMapId: "other-map", combineId: "locales" },
          },
        ],
      }),
    ],
  });
  assert.equal(foreign.stage, "run");

  const titled = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: bound,
    runs: [run({ id: "titled", action: "job.combine.start" })],
  });
  assert.equal(titled.stage, "run");

  const optionRun = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: bound,
    runs: [
      run({
        id: "this-map",
        action: "option-run-batch-1",
        artifacts: [
          {
            kind: "frozen-inputs",
            capturedAt: 1,
            data: { appMapId: "map-1", combineId: "locales", optionRunBatchId: "batch-1" },
          },
        ],
      }),
    ],
  });
  assert.equal(optionRun.stage, "complete");
});

test("pixels-only inspection is not titled ready", () => {
  const state = deriveFirstOperatorRunState({
    target: readyTarget(),
    device: { name: "Pixel 9", serial: "pixel", platform: "android" },
    inspection: { inspectable: false, source: "pixels-only", nodeCount: 0 },
    map: map({
      combines: {
        locales: combine([
          binding({ language: "en" }, "pixel-en"),
          binding({ language: "it" }, "pixel-it"),
        ]),
      },
    }),
  });
  assert.equal(/is ready/iu.test(state.deviceLabel), false);
  assert.match(state.deviceLabel, /picture|pixels/iu);
  assert.equal(state.stage, "run");
});

test("the operator card stays hidden while first-test is up or the map has no work", () => {
  const bind = deriveFirstOperatorRunState({ target: readyTarget(), map: map() });
  assert.equal(shouldShowFirstOperatorRun({ version: 1 }, bind, true), false);
  const empty = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: { id: "blank", tests: {}, variables: {}, combines: {} },
  });
  assert.equal(empty.hasWork, false);
  assert.equal(shouldShowFirstOperatorRun({ version: 1 }, empty, false), false);
  assert.equal(parseFirstOperatorRunPreference('{"version":1,"dismissedAt":9}').dismissedAt, 9);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, AppMapScenarioTestStep } from "@relay/protocol";
import {
  applyIntentDocumentToScenarioTest,
  intentDocumentFromScenarioTest,
} from "./intent-document-scenario.js";
import { formatIntentDocumentYaml, parseIntentDocumentYaml } from "./intent-document.js";

function fixture(): { map: AppMap; test: AppMapScenarioTest } {
  const scope = { organizationId: "acme", projectId: "mobile", appMapId: "settings" };
  const map: AppMap = {
    schemaVersion: 1,
    id: "settings",
    organizationId: "acme",
    projectId: "mobile",
    name: "Settings",
    revision: 7,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
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
    createdAt: 1,
    updatedAt: 1,
  };
  map.connections.open = {
    ...scope,
    id: "open",
    label: "Open Settings",
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "settings" },
    state: "ready",
    actions: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const scenario: AppMapScenarioTest = {
    ...scope,
    id: "settings-check",
    name: "Settings check",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "instruction",
        id: "open-settings",
        intent: "Open Settings",
        capture: true,
        binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  map.tests[scenario.id] = scenario;
  return { map, test: scenario };
}

function fixtureForStep(kind: "instruction" | "module" | "validation"): {
  map: AppMap;
  test: AppMapScenarioTest;
} {
  const result = fixture();
  if (kind === "module") {
    result.map.routines.setup = {
      organizationId: "acme",
      projectId: "mobile",
      appMapId: "settings",
      id: "setup",
      name: "Setup",
      parameters: [],
      actions: [],
      createdAt: 1,
      updatedAt: 1,
    };
    result.test.steps = [
      {
        kind: "module",
        id: "setup-step",
        intent: "Prepare the app",
        binding: { status: "resolved", kind: "routine", routineId: "setup" },
      },
    ];
  } else if (kind === "validation") {
    result.test.steps = [
      {
        kind: "validation",
        id: "check-settings",
        intent: "Settings are visible",
        binding: {
          status: "resolved",
          kind: "recipe-step",
          step: { kind: "expect", target: { identifier: "settings" }, condition: "visible" },
        },
      },
    ];
  }
  result.map.tests[result.test.id] = result.test;
  return result;
}

test("golden path and checkpoint round-trip through thin YAML", () => {
  const { map, test: scenario } = fixture();
  scenario.capture = { mode: "final-screen" };
  scenario.surfaceBindings = [
    {
      screenId: "settings",
      variantId: "settings-default",
      captureMode: "viewport",
      reason: "Keep the reviewed viewport",
      compare: "visual-and-semantic",
      repair: "propose-recapture",
    },
  ];
  const source = formatIntentDocumentYaml(intentDocumentFromScenarioTest(map, scenario));
  assert.match(source, /path:\n\s+- open\n\s+checkpoint: settings/u);
  const applied = applyIntentDocumentToScenarioTest({
    map,
    current: scenario,
    document: parseIntentDocumentYaml(source.replace("Open Settings", "Open app settings")),
  });
  assert.equal(applied.steps[0]?.intent, "Open app settings");
  assert.deepEqual(applied.steps[0], {
    kind: "instruction",
    id: "open-settings",
    intent: "Open app settings",
    capture: true,
    binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
  });
  assert.deepEqual(applied.capture, scenario.capture);
  assert.deepEqual(applied.surfaceBindings, scenario.surfaceBindings);
});

test("projection and apply fail closed for every unrepresented optional step semantic", () => {
  const disabled = {
    status: "disabled" as const,
    reason: "Temporarily excluded after review",
    repairTargetId: "repair-1",
    decidedBy: "human:reviewer",
    decidedAt: 10,
  };
  const cases: Array<{
    label: string;
    kind: "instruction" | "module" | "validation";
    mutate: (step: AppMapScenarioTestStep) => void;
    expected: RegExp;
  }> = [
    ...(["instruction", "module", "validation"] as const).flatMap((kind) => [
      {
        label: `${kind} note`,
        kind,
        mutate: (step: AppMapScenarioTestStep) => {
          step.note = "Reviewer context";
        },
        expected: /notes are not represented/u,
      },
      {
        label: `${kind} execution`,
        kind,
        mutate: (step: AppMapScenarioTestStep) => {
          step.execution = disabled;
        },
        expected: /disabled execution decisions are not represented/u,
      },
    ]),
    {
      label: "instruction cleanup",
      kind: "instruction",
      mutate: (step) => {
        if (step.kind !== "instruction") throw new Error("fixture mismatch");
        step.cleanup = {
          kind: "routine",
          routineId: "cleanup",
          terminalScreenId: "home",
          onCancel: "skip",
        };
      },
      expected: /cleanup is not represented/u,
    },
    {
      label: "explicit instruction capture false",
      kind: "instruction",
      mutate: (step) => {
        step.capture = false;
      },
      expected: /explicit capture: false is not represented/u,
    },
    {
      label: "module capture",
      kind: "module",
      mutate: (step) => {
        step.capture = true;
      },
      expected: /step capture is not represented/u,
    },
    {
      label: "validation capture",
      kind: "validation",
      mutate: (step) => {
        step.capture = true;
      },
      expected: /step capture is not represented/u,
    },
  ];

  for (const item of cases) {
    const { map, test: scenario } = fixtureForStep(item.kind);
    const document = intentDocumentFromScenarioTest(map, scenario);
    item.mutate(scenario.steps[0]!);
    assert.throws(
      () => intentDocumentFromScenarioTest(map, scenario),
      item.expected,
      `${item.label} projection`,
    );
    assert.throws(
      () => applyIntentDocumentToScenarioTest({ map, current: scenario, document }),
      item.expected,
      `${item.label} apply`,
    );
  }
});

test("source import fails closed when a checkpoint is detached from its reviewed path", () => {
  const { map, test: scenario } = fixture();
  const document = intentDocumentFromScenarioTest(map, scenario);
  const path = document.steps[0];
  assert.ok(path?.kind === "path");
  path.checkpointScreenId = "home";
  assert.throws(
    () => applyIntentDocumentToScenarioTest({ map, current: scenario, document }),
    /is not the destination/u,
  );
});

test("source import fails closed instead of discarding unsupported semantic fields", () => {
  const { map, test: scenario } = fixture();
  const document = intentDocumentFromScenarioTest(map, scenario);

  assert.throws(
    () =>
      applyIntentDocumentToScenarioTest({
        map,
        current: scenario,
        document: { ...document, description: "A description that the canonical Test cannot own" },
      }),
    /description is not supported by the canonical Test source adapter/u,
  );

  assert.throws(
    () =>
      applyIntentDocumentToScenarioTest({
        map,
        current: scenario,
        document: {
          ...document,
          repeat: {
            dimensions: [{ variableId: "language", values: ["en", "pt-BR"] }],
          },
        },
      }),
    /repeat is not supported by the thin Test source adapter/u,
  );
});

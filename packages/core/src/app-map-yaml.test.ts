import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_INPUT_DATA_SET_VALUE_LENGTH,
  summarizeAppMapOperationResult,
  type AppMap,
} from "@relay/protocol";
import { formatAppMapYaml, parseAppMapYaml } from "./app-map-yaml.js";

function emptyMap(): AppMap {
  return {
    schemaVersion: 1,
    id: "checkout",
    organizationId: "source-org",
    projectId: "source-project",
    name: "Checkout",
    description: "A portable checkout map",
    revision: 0,
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
    createdAt: 100,
    updatedAt: 100,
  };
}

test("App Map YAML round-trips deterministically and can move between projects", () => {
  const yaml = formatAppMapYaml(emptyMap());
  assert.match(
    yaml,
    /^schemaVersion: 1\nid: checkout\norganizationId: source-org\nprojectId: source-project\nname: Checkout\ndescription:/u,
  );
  assert.equal(formatAppMapYaml(parseAppMapYaml(yaml)), yaml);
  const moved = parseAppMapYaml(yaml, {
    organizationId: "destination-org",
    projectId: "destination-project",
    appMapId: "checkout-copy",
  });
  assert.equal(moved.id, "checkout-copy");
  assert.equal(moved.organizationId, "destination-org");
  assert.equal(moved.projectId, "destination-project");
  assert.equal(moved.description, "A portable checkout map");
});

test("App Map YAML without variables still loads as an empty record", () => {
  const yaml = formatAppMapYaml(emptyMap()).replace(/\nvariables:\n \[\]\n/u, "\n");
  const parsed = parseAppMapYaml(yaml.replace(/\nvariables: \[\]\n/u, "\n"));
  assert.deepEqual(parsed.variables ?? {}, {});
});

test("input Data set YAML preserves stable row IDs, explicit Project reference, and bounded payloads", () => {
  const map = emptyMap();
  map.variables.questions = {
    id: "questions",
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
    name: "Questions",
    kind: "custom",
    apply: { kind: "input", inputId: "prompt-data" },
    options: [{ id: "q1", label: "Tides", value: "Explain ocean tides" }],
    createdAt: 100,
    updatedAt: 100,
  };
  const yaml = formatAppMapYaml(map);
  const parsed = parseAppMapYaml(yaml);
  assert.deepEqual(parsed.variables.questions, map.variables.questions);
  assert.equal(formatAppMapYaml(parsed), yaml);
  const summary = summarizeAppMapOperationResult("app-map.get", { appMap: parsed });
  assert.ok(JSON.stringify(summary).includes('"inputId":"prompt-data"'));
  assert.ok(JSON.stringify(summary).includes('"value":"Explain ocean tides"'));
  map.variables.questions.options[0]!.value = "x".repeat(MAX_INPUT_DATA_SET_VALUE_LENGTH);
  assert.equal(
    parseAppMapYaml(formatAppMapYaml(map)).variables.questions!.options[0]!.value?.length,
    MAX_INPUT_DATA_SET_VALUE_LENGTH,
  );
  map.variables.questions.options[0]!.value += "x";
  assert.throws(() => formatAppMapYaml(map), /20000 characters/);
});

test("App Map YAML rejects aliases, duplicate ids, and unknown root fields", () => {
  assert.throws(
    () => parseAppMapYaml("schemaVersion: 1\nid: &id checkout\nname: *id\n"),
    /anchors and aliases/iu,
  );
  const duplicate = formatAppMapYaml({
    ...emptyMap(),
    screens: {
      welcome: {
        id: "welcome",
        organizationId: "source-org",
        projectId: "source-project",
        appMapId: "checkout",
        title: "Welcome",
        variantIds: [],
        createdAt: 100,
        updatedAt: 100,
      },
    },
  }).replace("screens:\n", "screens:\n");
  const screenBlock = duplicate.match(/screens:\n([\s\S]*?)screenVariants:/u)?.[1];
  assert.ok(screenBlock);
  const duplicatedScreens = duplicate.replace(
    `screens:\n${screenBlock}screenVariants:`,
    `screens:\n${screenBlock}${screenBlock}screenVariants:`,
  );
  assert.throws(() => parseAppMapYaml(duplicatedScreens), /duplicate id/iu);
  assert.throws(
    () => parseAppMapYaml(`${formatAppMapYaml(emptyMap())}surprise: true\n`),
    /unknown/iu,
  );
});

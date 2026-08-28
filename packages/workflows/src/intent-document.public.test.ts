import assert from "node:assert/strict";
import test from "node:test";
import {
  formatIntentDocumentYaml,
  intentDocumentReferences,
  intentDocumentYamlFilename,
  parseIntentDocumentYaml,
  type IntentDocument,
} from "./intent-document.js";

const intent: IntentDocument = {
  schemaVersion: 1,
  kind: "bound-test",
  name: "Data Controls localization",
  description: "One reviewed path, repeated across supported languages.",
  appMapId: "settings",
  testId: "data-controls-localization",
  steps: [
    {
      kind: "path",
      id: "reach-settings",
      intent: "Reach Settings",
      connectionIds: ["open-settings"],
    },
    {
      kind: "module",
      id: "open-data-controls",
      intent: "Open Data Controls",
      moduleId: "open-data-controls",
      bindings: { account: "test-user", app: "com.example.app" },
    },
    {
      kind: "checkpoint",
      id: "capture-data-controls",
      intent: "Capture Data Controls",
      screenId: "data-controls",
    },
    {
      kind: "check",
      id: "check-no-clipping",
      intent: "Check no clipping",
      testStepId: "no-clipping",
    },
  ],
  repeat: {
    strategy: "cartesian",
    pilot: { mode: "specified", case: { language: "en", theme: "dark" } },
    resume: "untouched",
    dimensions: [
      { id: "language", values: "all" },
      { id: "theme", values: ["light", "dark"] },
    ],
  },
};

test("IntentDocument YAML preserves ordered semantic steps and Repeat intent", () => {
  const yaml = formatIntentDocumentYaml(intent);

  assert.match(yaml, /^schemaVersion: 1\nkind: bound-test\n/u);
  assert.ok(yaml.indexOf("use: open-data-controls") < yaml.indexOf("checkpoint: data-controls"));
  assert.ok(yaml.indexOf("checkpoint: data-controls") < yaml.indexOf("check: no-clipping"));
  assert.deepEqual(parseIntentDocumentYaml(yaml), intent);
});

test("IntentDocument contains bindings, never an executable App Map or evidence", () => {
  const yaml = formatIntentDocumentYaml(intent);
  const references = intentDocumentReferences(intent);

  assert.deepEqual(references, {
    appMapId: "settings",
    testId: "data-controls-localization",
    connectionIds: ["open-settings"],
    moduleIds: ["open-data-controls"],
    screenIds: ["data-controls"],
    testStepIds: ["reach-settings", "open-data-controls", "capture-data-controls", "no-clipping"],
    variableIds: ["language", "theme"],
  });
  assert.doesNotMatch(yaml, /selectors|evidence|screens:|connections:|runs:/u);
  assert.equal(
    intentDocumentYamlFilename(intent.testId),
    "data-controls-localization.relay.test.yaml",
  );
});

test("IntentDocument imports fail closed on unknown or ambiguous fields", () => {
  const valid = formatIntentDocumentYaml(intent);

  assert.throws(
    () => parseIntentDocumentYaml(`${valid}evidence: []\n`),
    /unknown Relay intent field: evidence/u,
  );
  assert.throws(
    () =>
      parseIntentDocumentYaml(
        valid.replace("use: open-data-controls", "use: open-data-controls\n    selector: Settings"),
      ),
    /unknown steps\[1\] field: selector/u,
  );
  assert.throws(
    () =>
      parseIntentDocumentYaml(
        valid.replace("use: open-data-controls", "use: open-data-controls\n    check: no-crash"),
      ),
    /exactly one of use, path, checkpoint, or check/u,
  );
  assert.throws(
    () => parseIntentDocumentYaml(valid.replace("kind: bound-test", "kind: app-map")),
    /kind must be bound-test/u,
  );
});

test("IntentDocument migrates the former test-intent discriminator without changing meaning", () => {
  const legacy = formatIntentDocumentYaml(intent).replace("kind: bound-test", "kind: test-intent");
  const migrated = parseIntentDocumentYaml(legacy);

  assert.equal(migrated.kind, "bound-test");
  assert.match(formatIntentDocumentYaml(migrated), /^schemaVersion: 1\nkind: bound-test\n/u);
});

test("IntentDocument imports reject aliases, duplicate ids, and duplicate Repeat dimensions", () => {
  assert.throws(
    () =>
      parseIntentDocumentYaml(`schemaVersion: 1
kind: bound-test
name: Anchored
appMap: settings
test: anchored
steps:
  - &shared
    id: one
    intent: Open settings
    use: open-settings
  - *shared
`),
    /anchors and aliases are not supported/u,
  );

  const duplicateStep = structuredClone(intent);
  duplicateStep.steps[1]!.id = duplicateStep.steps[0]!.id;
  assert.throws(() => formatIntentDocumentYaml(duplicateStep), /duplicate step id/u);

  const duplicateVariable = structuredClone(intent);
  duplicateVariable.repeat!.dimensions[1]!.id = "language";
  assert.throws(() => formatIntentDocumentYaml(duplicateVariable), /duplicate repeat variable/u);
});

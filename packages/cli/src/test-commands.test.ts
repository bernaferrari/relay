import assert from "node:assert/strict";
import test from "node:test";
import { graphTestCommandDescriptors, graphTestListPath } from "./test-commands.js";
import { renderHelp } from "./help.js";

test("first-read help leads from discovery to explicit offline compilation", () => {
  const everyday = renderHelp();
  assert.ok(everyday.indexOf("relay tests [<app>]") > everyday.indexOf("relay run <test>"));
  assert.match(everyday, /whether each is ready/);
  const root = renderHelp("advanced");
  assert.ok(root.indexOf("relay test list <appId>") < root.indexOf("relay test compile"));
  assert.match(root, /discovery\.status/);
  assert.match(root, /preflight\.summary\.blockers/);
  assert.match(root, /map export <appId> --json/);
  const family = renderHelp("test");
  assert.match(family, /recorded platforms/);
  assert.match(family, /not live execution readiness/);
});

test("runtime prompt inputs and recording edit discovery are available in help", () => {
  assert.match(renderHelp("test"), /Runtime string inputs.*Project Data sets/u);
  const recording = renderHelp("edit-recording");
  assert.match(recording, /expectedVersion.*replace.*interaction JSON/u);
  assert.match(recording, /same --actor/u);
});

test("schedule help explains native Test prerequisites and the create payload", () => {
  const schedule = renderHelp("schedule");
  for (const field of [
    "recipeId",
    "combineId",
    "appMapId",
    "targetKind",
    "targetId",
    "platform",
    "intervalMinutes",
    "hour",
    "timezone",
    "repetitions",
    "enabled",
    "profileTargets",
  ]) {
    assert.match(schedule, new RegExp(`\\b${field}\\b`, "u"));
  }
  assert.match(schedule, /choose this or combineId/u);
  assert.match(schedule, /Required with combineId/u);
  assert.match(schedule, /1\.\.43200/u);
  assert.match(schedule, /Run Across/u);
  assert.match(schedule, /Selected input Data set rows freeze approved Project values/u);
  assert.match(schedule, /changing schedule seed does not rotate its prompts/u);
  assert.match(schedule, /not a testId or per-schedule runtime variables/u);
  assert.match(schedule, /"combineId":"chat-prompts"/u);
  assert.match(schedule, /"intervalMinutes":30/u);
  assert.match(schedule, /"enabled":false/u);
});

test("input Data set help keeps stable row IDs separate from approved prompt payloads", () => {
  const variable = renderHelp("variable");
  assert.match(variable, /"apply":\{"kind":"input","inputId":"chat-prompt-data"\}/u);
  assert.match(
    variable,
    /"id":"value-1","label":"Tides","value":"Explain ocean tides in three sentences"/u,
  );
  assert.match(variable, /shared, non-sensitive list\/static values/u);
  assert.match(variable, /retained during resume/u);
  assert.match(renderHelp("combine"), /zip to pair equally sized prompt lists in order/u);
});

test("graph Test commands expose one canonical scenario-only workflow", () => {
  assert.equal(graphTestListPath.command, "test list");
  assert.deepEqual(
    graphTestCommandDescriptors.map(({ operationId }) => operationId),
    [
      "app-map.test.save",
      "app-map.test.edit",
      "app-map.test.undo",
      "app-map.test.redo",
      "app-map.test.propose",
      "app-map.test.compile",
      "app-map.test.from-intent",
      "app-map.test.run",
      "app-map.test.remove",
    ],
  );
  assert.deepEqual(
    graphTestCommandDescriptors.flatMap(({ paths }) => paths.map(({ command }) => command)),
    [
      "test save",
      "test edit",
      "test undo",
      "test redo",
      "test propose",
      "test compile",
      "test from-intent",
      "test run",
      "test remove",
    ],
  );
});

test("Test help makes checkpoint startup and retry behavior explicit", () => {
  const compile = graphTestCommandDescriptors.find(
    ({ operationId }) => operationId === "app-map.test.compile",
  )!;
  const run = graphTestCommandDescriptors.find(
    ({ operationId }) => operationId === "app-map.test.run",
  )!;
  assert.match(
    compile.paths[0]?.inputHelp?.[0]?.description ?? "",
    /stops for review instead of relaunching/u,
  );
  assert.match(
    run.paths[0]?.inputHelp?.find(({ name }) => name === "startup")?.description ?? "",
    /never falls back to a cold relaunch/u,
  );
  assert.match(run.paths[0]?.note ?? "", /paused job resumes its existing plan/u);
  assert.ok(
    compile.paths[0]?.examples?.some((example) => example.includes("entryCheckpointScreenId")),
  );
  assert.match(
    compile.paths[0]?.inputHelp?.find(({ name }) => name === "targetProfileId")?.description ?? "",
    /ios.*android.*companion/u,
  );
  assert.match(compile.paths[0]?.summary ?? "", /offline Test plan.*--full/u);
  assert.match(compile.paths[0]?.note ?? "", /does not contact a target/u);
  assert.match(compile.paths[0]?.note ?? "", /--json and --ndjson retain the complete result/u);
  assert.ok(run.paths[0]?.examples?.some((example) => example.includes("verified-checkpoint")));
});

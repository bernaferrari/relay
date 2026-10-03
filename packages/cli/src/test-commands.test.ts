import assert from "node:assert/strict";
import test from "node:test";
import { graphTestCommandDescriptors, graphTestListPath } from "./test-commands.js";
import { renderHelp } from "./help.js";

test("first-read help leads from discovery to explicit offline compilation", () => {
  const root = renderHelp();
  assert.ok(root.indexOf("relay test list <appId>") < root.indexOf("Run a saved Test"));
  assert.match(root, /discovery\.status/);
  assert.match(root, /preflight\.summary\.blockers/);
  assert.match(root, /map export <appId> --json/);
  const family = renderHelp("test");
  assert.match(family, /recorded platforms/);
  assert.match(family, /not live execution readiness/);
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
  assert.ok(run.paths[0]?.examples?.some((example) => example.includes("verified-checkpoint")));
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrowserCaptureWorkflow,
  type BrowserCapturePlan,
} from "./browser-capture-workflow.js";
import { createScriptedRelayClient } from "./testing.js";

const plan: BrowserCapturePlan = {
  appMapId: "plans",
  id: "capture",
  name: "Plans",
  expectedRevision: 3,
  language: {
    apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Language" } }] },
    options: [
      { id: "en", label: "English" },
      { id: "fr", label: "Français" },
    ],
  },
  views: [
    { id: "individual", name: "Individual", steps: [] },
    { id: "business", name: "Business", steps: [{ kind: "tap", target: { label: "Business" } }] },
  ],
};
function result(revision: number) {
  return { appMap: { id: "plans", organizationId: "local", projectId: "default", revision } };
}

test("capture plan authors one shared data set and Test with two explicit captures", async () => {
  const scripted = createScriptedRelayClient([
    { id: "app-map.get", output: result(3) },
    { id: "app-map.variable.save", output: result(4) },
    {
      id: "app-map.routine.save",
      output: result(5),
      checkInput(input) {
        const actions = (
          input as { routine: { actions: Array<{ steps: Array<{ kind: string }> }> } }
        ).routine.actions;
        assert.deepEqual(
          actions.map((a) => a.steps.map((s) => s.kind)),
          [["screenshot"], ["tap", "screenshot"]],
        );
      },
    },
    {
      id: "app-map.test.save",
      output: result(6),
      checkInput(input) {
        const value = input as { expectedRevision: number; test: Record<string, unknown> };
        assert.equal(value.expectedRevision, 5);
        assert.equal(value.test.kind, "scenario");
        assert.equal(value.test.createdAt, undefined);
      },
    },
  ]);
  const saved = await createBrowserCaptureWorkflow(scripted.client).save(plan);
  assert.equal(saved.variableId, "capture-language");
  assert.equal(scripted.remaining(), 0);
});
test("invalid actions and stale map revisions produce no partial writes", async () => {
  for (const invalid of [
    { ...plan, expectedRevision: 2 },
    { ...plan, views: [{ id: "bad", name: "Bad", steps: [{ kind: "not-a-step" } as never] }] },
  ]) {
    const scripted = createScriptedRelayClient([{ id: "app-map.get", output: result(3) }]);
    await assert.rejects(createBrowserCaptureWorkflow(scripted.client).save(invalid));
    assert.equal(scripted.invocations.length, 1);
  }
});

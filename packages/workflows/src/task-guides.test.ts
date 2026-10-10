import assert from "node:assert/strict";
import test from "node:test";
import { validateRecipeSteps } from "@relay/core/recipes";
import { operationDefinition, type AuthoringInteraction } from "@relay/protocol";
import { formatRelayTaskGuide, relayTaskGuide } from "./task-guides.js";

function guide(topic: string) {
  const value = relayTaskGuide(topic);
  assert.ok(value, `${topic} is a bundled guide`);
  return value;
}

function input(example: readonly string[]): Record<string, unknown> {
  const index = example.indexOf("--input");
  assert.ok(index >= 0);
  return JSON.parse(example[index + 1]!);
}

test("the first recording example starts without a pre-existing App Map", () => {
  const record = guide("record");
  const start = record.examples.find(([command]) => command === "record");
  assert.ok(start);
  assert.ok(start.includes("--device"));
  assert.ok(start.includes("--confirm"));
  assert.ok(start.includes("--json"));
  assert.ok(!start.includes("--map"));
  assert.match(record.markdown, /With no App Maps, Relay creates one; with one, it reuses it/u);
  assert.match(record.markdown, /With several, choose the intended App using --map <app-id>/u);
});

test("recording examples reach a saved Test and inspectable Run through public commands", () => {
  const examples = guide("record").examples;
  const index = (command: string, action?: string) =>
    examples.findIndex(([verb, next]) => verb === command && (!action || next === action));
  assert.ok(index("record") < index("recording", "interact"));
  assert.ok(index("recording", "interact") < index("recording", "stop"));
  assert.ok(index("recording", "stop") < index("recording", "get"));
  assert.ok(index("recording", "get") < index("recording", "commit"));
  assert.ok(index("recording", "commit") < index("test", "list"));
  assert.ok(index("test", "list") < index("map", "connection"));
  assert.ok(index("map", "connection") < index("run"));
  assert.ok(index("run") < index("inspect"));
  assert.ok(index("inspect") < index("export"));
  assert.ok(index("export") < index("review"));

  const commit = examples.find(([verb, action]) => verb === "recording" && action === "commit")!;
  const parsed = operationDefinition("authoring.session.commit").input.parse({
    sessionId: commit[2],
    ...input(commit),
  });
  assert.equal(parsed.createTest, true, "saving must create the Test that the next command runs");
  const text = formatRelayTaskGuide(guide("record"));
  assert.match(text, /session\.committedTestId/u);
  assert.match(text, /session\.committedConnectionId/u);
  assert.match(text, /relay_approve_recording/u);
  assert.match(text, /numeric expectedVersion/u);
});

test("documented recording checks validate as executable conditions with bounded waits", () => {
  for (const topic of ["record", "waits"]) {
    const interactions = guide(topic)
      .examples.filter(([verb, action]) => verb === "recording" && action === "interact")
      .map((example) => {
        const parsed = operationDefinition("authoring.session.interact").input.parse({
          sessionId: example[2],
          ...input(example),
        });
        return parsed.interaction as AuthoringInteraction;
      });
    const check = interactions.find((interaction) => interaction.kind === "steps");
    assert.ok(check?.kind === "steps", `${topic} gives an executable check`);
    const steps = validateRecipeSteps(check.steps);
    assert.ok(steps.some((step) => step.kind === "wait-for"));
    for (const step of steps) {
      assert.ok(step.kind === "wait-for" || step.kind === "expect");
      assert.ok(typeof step.timeoutMs === "number" && step.timeoutMs > 0);
      assert.ok(step.target.label);
    }
  }
});

test("the run guide teaches names and the real exit codes, not engine jargon", () => {
  const run = guide("run");
  assert.ok(
    run.examples.some(
      (example) =>
        example[0] === "run" && example.includes("--app") && example.includes("--device"),
    ),
  );
  assert.ok(
    run.examples.every((example) => !example.includes("--map") && !example.includes("--lane")),
  );
  assert.match(run.markdown, /1 a Test failed/u);
  assert.doesNotMatch(run.markdown, /\b9 means\b|\bLane\b|Run Across/u);
  const start = guide("start");
  assert.deepEqual(
    start.examples.map(([verb]) => verb),
    ["new", "run", "ci"],
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapScenarioTestStep } from "./test-intent.js";
import { scenarioTestRunsEntirelyFromText } from "./test-step-readiness.js";

function textStep(kind: "instruction" | "validation", id: string = kind): AppMapScenarioTestStep {
  return {
    id,
    intent: `${kind} in words`,
    kind,
    binding: { status: "unresolved", reason: "No recording", fromText: true },
  } as AppMapScenarioTestStep;
}

test("every instruction and validation running from text runs entirely from text", () => {
  assert.equal(
    scenarioTestRunsEntirelyFromText({ steps: [textStep("instruction"), textStep("validation")] }),
    true,
  );
});

test("an empty Test never runs entirely from text", () => {
  assert.equal(scenarioTestRunsEntirelyFromText({ steps: [] }), false);
});

test("a recorded binding stops the Test from running entirely from text", () => {
  const recorded: AppMapScenarioTestStep = {
    id: "recorded",
    intent: "Open the recorded route",
    kind: "instruction",
    binding: { status: "resolved", kind: "connections", connectionIds: ["connection-1"] },
  };
  assert.equal(
    scenarioTestRunsEntirelyFromText({ steps: [textStep("instruction"), recorded] }),
    false,
  );
});

test("an unresolved binding without fromText stops the Test from running entirely from text", () => {
  const undecided: AppMapScenarioTestStep = {
    id: "undecided",
    intent: "Open the undecided route",
    kind: "instruction",
    binding: { status: "unresolved", reason: "No reviewed route" },
  };
  assert.equal(scenarioTestRunsEntirelyFromText({ steps: [undecided] }), false);
});

test("module, script, manual, extraction, decision, and loop steps never run entirely from text", () => {
  const kinds = [
    {
      id: "module",
      intent: "Run the module",
      kind: "module",
      binding: { status: "unresolved", reason: "No routine", fromText: true },
    },
    {
      id: "script",
      intent: "Run the script",
      kind: "script",
      binding: { status: "resolved", kind: "script", source: "return 1;" },
    },
    {
      id: "manual",
      intent: "Pause for a human",
      kind: "manual",
      binding: { status: "unresolved", reason: "No pause", fromText: true },
    },
    {
      id: "extraction",
      intent: "Extract the reply",
      kind: "extraction",
      binding: { status: "unresolved", reason: "No target", fromText: true },
    },
    {
      id: "decision",
      intent: "Branch on input",
      kind: "decision",
      binding: { status: "unresolved", reason: "No condition", fromText: true },
      thenSteps: [textStep("instruction", "then-instruction")],
    },
    {
      id: "loop",
      intent: "Repeat the steps",
      kind: "loop",
      binding: { status: "unresolved", reason: "No repeat", fromText: true },
      steps: [textStep("instruction", "loop-instruction")],
    },
  ] as AppMapScenarioTestStep[];
  for (const step of kinds) {
    assert.equal(
      scenarioTestRunsEntirelyFromText({ steps: [textStep("instruction"), step] }),
      false,
      step.id,
    );
  }
});

test("a disabled text step stops the Test from running entirely from text", () => {
  const disabled = {
    ...textStep("instruction", "disabled"),
    execution: {
      status: "disabled",
      reason: "Covered elsewhere",
      repairTargetId: "disabled",
      decidedBy: "human:qa",
      decidedAt: 1,
    },
  } as AppMapScenarioTestStep;
  assert.equal(
    scenarioTestRunsEntirelyFromText({ steps: [textStep("validation"), disabled] }),
    false,
  );
});

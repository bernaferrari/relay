import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDraftLine,
  draftStepsFromLines,
  draftTestName,
  draftTestSteps,
  registerTestStepDrafter,
} from "./test-step-drafting.js";

test("verification phrasing becomes a Check, everything else an Action", () => {
  assert.deepEqual(classifyDraftLine("Open Settings"), {
    kind: "instruction",
    intent: "Open Settings",
  });
  assert.deepEqual(classifyDraftLine("verify the API key is visible"), {
    kind: "validation",
    intent: "Verify the API key is visible",
  });
  assert.deepEqual(classifyDraftLine("The new key is shown"), {
    kind: "validation",
    intent: "The new key is shown",
  });
  assert.deepEqual(classifyDraftLine("- Assert: Total is $10"), {
    kind: "validation",
    intent: "Total is $10",
  });
  assert.deepEqual(classifyDraftLine("2. Act: verify email"), {
    kind: "instruction",
    intent: "Verify email",
  });
  assert.equal(classifyDraftLine("  - "), undefined);
});

test("one sentence splits on sentence ends and 'then'", () => {
  assert.deepEqual(
    draftStepsFromLines("Open the cart, then tap Checkout. Make sure the total is visible"),
    [
      { kind: "instruction", intent: "Open the cart" },
      { kind: "instruction", intent: "Tap Checkout" },
      { kind: "validation", intent: "Make sure the total is visible" },
    ],
  );
});

test("names come from the first line", () => {
  assert.equal(
    draftTestName("Checkout works with a test card.\nmore"),
    "Checkout works with a test card",
  );
  assert.equal(draftTestName("   "), "New test");
});

test("a model drafts single-sentence goals and sees known screens", async () => {
  let seen: string[] = [];
  const unregister = registerTestStepDrafter(async ({ knownScreens }) => {
    seen = knownScreens;
    return {
      name: "Create an API key",
      steps: [
        { kind: "instruction", intent: "Open API Keys" },
        { kind: "validation", intent: "The new key is listed" },
      ],
    };
  });
  try {
    const drafted = await draftTestSteps({
      goal: "Creating an API key works",
      appMap: { screens: { s1: { title: "Settings" } } } as never,
    });
    assert.equal(drafted.source, "model");
    assert.equal(drafted.steps.length, 2);
    assert.deepEqual(seen, ["Settings"]);
  } finally {
    unregister();
  }
});

test("a written list is kept as-is and model failures fall back to lines", async () => {
  const unregister = registerTestStepDrafter(async () => {
    throw new Error("offline");
  });
  try {
    const list = await draftTestSteps({ goal: "Open Settings\nCheck the title says Settings" });
    assert.equal(list.source, "lines");
    assert.deepEqual(
      list.steps.map((step) => step.kind),
      ["instruction", "validation"],
    );
    const sentence = await draftTestSteps({ goal: "Search for shoes" });
    assert.equal(sentence.source, "lines");
    assert.deepEqual(sentence.steps, [{ kind: "instruction", intent: "Search for shoes" }]);
  } finally {
    unregister();
  }
  await assert.rejects(() => draftTestSteps({ goal: " " }), /Describe what should work/);
});

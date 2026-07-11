import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planTestPrompt } from "./natural-language-plan";

describe("planTestPrompt", () => {
  it("turns a common flow into editable steps", () => {
    const result = planTestPrompt(
      'Tap "Sign in" then type "qa@example.com" then check "Welcome" is visible',
    );
    assert.deepEqual(
      result.map((item) => item.step),
      [
        { kind: "tap", target: { label: "Sign in" } },
        { kind: "type", text: "qa@example.com" },
        { kind: "expect", target: { label: "Welcome" }, condition: "visible" },
      ],
    );
  });

  it("supports device, app, and timing actions", () => {
    const result = planTestPrompt("lock the screen; unlock device; app switcher; wait 2 seconds");
    assert.deepEqual(
      result.map((item) => item.step),
      [
        { kind: "device", action: "lock" },
        { kind: "device", action: "unlock" },
        { kind: "app", action: "switcher" },
        { kind: "sleep", ms: 2000 },
      ],
    );
  });

  it("keeps ambiguous instructions as explicit manual checkpoints", () => {
    assert.deepEqual(planTestPrompt("Confirm the animation feels smooth")[0]?.step, {
      kind: "pause",
      message: "Confirm the animation feels smooth",
      note: "Generated from a natural-language instruction",
    });
  });
});

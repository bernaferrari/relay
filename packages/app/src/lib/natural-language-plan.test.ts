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

  it("accepts ordinary comma-separated language", () => {
    const result = planTestPrompt("Open settings, tap Profile, then check Account is visible");
    assert.deepEqual(
      result.map((item) => item.step),
      [
        { kind: "tap", target: { label: "settings" } },
        { kind: "tap", target: { label: "Profile" } },
        { kind: "expect", target: { label: "Account" }, condition: "visible" },
      ],
    );
  });

  it("turns subjective checks into deferred review instead of blocking the run", () => {
    assert.deepEqual(planTestPrompt("Confirm the animation feels smooth")[0]?.step, {
      kind: "review",
      capability: "Human verification",
      reason: "Confirm the animation feels smooth",
      note: "Generated as a deferred check from a natural-language instruction",
    });
  });
});

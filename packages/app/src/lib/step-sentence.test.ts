import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sentenceForStep, stepIssue, stepValid } from "./step-sentence";

describe("sentenceForStep", () => {
  it("formats tap with label", () => {
    assert.equal(sentenceForStep({ kind: "tap", target: { label: "Sign in" } }), 'Tap "Sign in"');
  });
  it("keeps frozen reusable-test identities out of ordinary action copy", () => {
    const step = {
      kind: "module" as const,
      recipeId: "app-map:avd-acceptance:tests:launcher-proof@10",
    };
    assert.equal(sentenceForStep(step), "Run saved Test");
    assert.equal(
      sentenceForStep(step, [
        {
          id: "app-map:avd-acceptance:tests:launcher-proof@10",
          title: "Launcher checkpoint proof",
        },
      ]),
      "Run Launcher checkpoint proof",
    );
  });
  it("describes multi-tap and hold gestures without changing the target", () => {
    assert.equal(
      sentenceForStep({
        kind: "tap",
        gesture: "multi",
        tapCount: 4,
        target: { label: "Like" },
      }),
      '4 taps "Like"',
    );
    assert.equal(
      sentenceForStep({ kind: "tap", gesture: "hold", target: { label: "Message" } }),
      'Hold "Message"',
    );
  });
  it("hides a recorded element ref behind its accessibility name", () => {
    assert.equal(
      sentenceForStep({
        kind: "tap",
        target: { ref: "@e94", point: { x: 181, y: 1450 } },
        evidence: {
          id: "evidence-1",
          recordedAt: 1,
          node: { ref: "@e94", label: "Ask anything" },
        },
      }),
      'Tap "Ask anything"',
    );
  });
  it("avoids raw coordinates when an element has no accessibility name", () => {
    assert.equal(
      sentenceForStep({
        kind: "tap",
        target: { ref: "@e53", point: { x: 489, y: 1053 } },
        evidence: { id: "evidence-2", recordedAt: 1, node: { ref: "@e53" } },
      }),
      "Tap the recorded control",
    );
  });
  it("uses a nearby evidence label even when the target is only a point", () => {
    assert.equal(
      sentenceForStep({
        kind: "tap",
        target: { point: { x: 359, y: 586 } },
        evidence: {
          id: "evidence-point",
          recordedAt: 1,
          node: { label: "Storage" },
        },
      }),
      'Tap "Storage"',
    );
  });
  it("describes swipe direction instead of raw coordinates", () => {
    assert.equal(
      sentenceForStep({
        kind: "swipe",
        from: { x: 100, y: 800 },
        to: { x: 100, y: 200 },
      }),
      "Swipe up",
    );
  });
  it("uses the selected parent accessibility name instead of the captured child", () => {
    assert.equal(
      sentenceForStep({
        kind: "tap",
        target: { ref: "@parent", point: { x: 50, y: 100 } },
        evidence: {
          id: "evidence-3",
          recordedAt: 1,
          node: { ref: "@child", label: "Child" },
          ancestors: [{ ref: "@parent", label: "Account row" }],
        },
      }),
      'Tap "Account row"',
    );
  });
  it("formats empty type", () => {
    assert.equal(sentenceForStep({ kind: "type", text: "" }), "Type text");
  });
  it("formats type with text", () => {
    assert.equal(sentenceForStep({ kind: "type", text: "hello" }), 'Type "hello"');
  });
  it("formats expect gone", () => {
    assert.equal(
      sentenceForStep({ kind: "expect", target: { text: "Loading" }, condition: "gone" }),
      'Check "Loading" is gone',
    );
  });
  it("formats sleep ms and s", () => {
    assert.equal(sentenceForStep({ kind: "sleep", ms: 500 }), "Wait 500ms");
    assert.equal(sentenceForStep({ kind: "sleep", ms: 2000 }), "Wait 2s");
  });
  it("formats key and scroll", () => {
    assert.equal(sentenceForStep({ kind: "key", key: "back" }), "Press Back");
    assert.equal(sentenceForStep({ kind: "scroll", direction: "down" }), "Scroll Down");
    assert.equal(
      sentenceForStep({ kind: "scroll", direction: "up", amount: 1 }),
      "Scroll Up · full screen",
    );
  });
  it("formats a compiled tour", () => {
    assert.equal(sentenceForStep({ kind: "tour" }), "Tour visible rows");
    assert.equal(sentenceForStep({ kind: "tour", depth: 1 }), "Tour visible rows depth 1");
    assert.equal(sentenceForStep({ kind: "tour", originTitle: "Settings" }), "Tour Settings rows");
  });
  it("formats screenshot with caption", () => {
    assert.equal(sentenceForStep({ kind: "screenshot", caption: "home" }), "Screenshot · home");
  });
  it("formats flow with titleize fallback", () => {
    assert.equal(sentenceForStep({ kind: "flow", flow: "play-store-open" }), "Play store open");
  });
  it("never surfaces raw coordinates or element refs", () => {
    assert.equal(
      sentenceForStep({ kind: "wait-for", target: { point: { x: 359, y: 586 } } }),
      "Wait until the screen appears",
    );
    assert.equal(
      sentenceForStep({ kind: "expect", target: { ref: "@e12" }, condition: "visible" }),
      "Check the recorded element is visible",
    );
    assert.equal(
      sentenceForStep({
        kind: "extract",
        target: { ref: "@e1", point: { x: 10, y: 20 } },
        as: "${pageTitle}",
      }),
      "Extract the recorded control as page title",
    );
  });
  it("humanizes assert-content variable inputs", () => {
    assert.equal(
      sentenceForStep({
        kind: "assert-content",
        input: "${lastResponse.statusCode}",
        match: "exact",
        expected: "200",
      }),
      'Check last response status code exact "200"',
    );
  });
});

describe("stepValid / stepIssue", () => {
  it("requires target for tap", () => {
    assert.equal(stepValid({ kind: "tap", target: {} }), false);
    assert.match(stepIssue({ kind: "tap", target: {} }) ?? "", /target/i);
  });
  it("accepts labeled tap", () => {
    assert.equal(stepValid({ kind: "tap", target: { label: "OK" } }), true);
    assert.equal(stepIssue({ kind: "tap", target: { label: "OK" } }), null);
  });
  it("requires text for type", () => {
    assert.equal(stepValid({ kind: "type", text: "  " }), false);
    assert.match(stepIssue({ kind: "type", text: "" }) ?? "", /text/i);
  });
  it("screenshot always valid", () => {
    assert.equal(stepValid({ kind: "screenshot" }), true);
  });
});

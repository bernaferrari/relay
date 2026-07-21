import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sentenceForStep, stepIssue, stepValid } from "./step-sentence";

describe("sentenceForStep", () => {
  it("formats tap with label", () => {
    assert.equal(sentenceForStep({ kind: "tap", target: { label: "Sign in" } }), 'Tap "Sign in"');
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
  it("uses the recorded position when an element has no accessibility name", () => {
    assert.equal(
      sentenceForStep({
        kind: "tap",
        target: { ref: "@e53", point: { x: 489, y: 1053 } },
        evidence: { id: "evidence-2", recordedAt: 1, node: { ref: "@e53" } },
      }),
      "Tap at 489, 1053",
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
  });
  it("formats screenshot with caption", () => {
    assert.equal(sentenceForStep({ kind: "screenshot", caption: "home" }), "Screenshot · home");
  });
  it("formats flow with titleize fallback", () => {
    assert.equal(sentenceForStep({ kind: "flow", flow: "play-store-open" }), "Play store open");
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

import { describe, expect, it } from "vitest";
import { VALIDATION_KIND_GROUPS, validationBindingFromDraft } from "./test-editor-assertion";

describe("test editor assertions", () => {
  it("groups Check, Wait, Comparison settings, and Advanced identity", () => {
    expect(VALIDATION_KIND_GROUPS.map((group) => group.label)).toEqual([
      "Check",
      "Wait",
      "Comparison settings",
      "Advanced identity",
    ]);
    expect(
      VALIDATION_KIND_GROUPS.flatMap((group) => group.kinds.map((kind) => kind.value)),
    ).toEqual(["screen", "content", "wait-response", "semantic", "visual", "identity-ignore"]);
  });

  it("compiles a semantic judge and a reply wait without YAML", () => {
    expect(
      validationBindingFromDraft({
        kind: "semantic",
        input: "reply",
        criteria: "Reply must mention a location",
      }),
    ).toEqual({
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "semantic",
        input: "reply",
        criteria: ["Reply must mention a location"],
      },
    });
    expect(
      validationBindingFromDraft({
        kind: "wait-response",
        label: "Ask anything",
        maxMs: "1000",
      }),
    ).toEqual({
      status: "resolved",
      kind: "recipe-step",
      step: { kind: "wait-response", target: { label: "Ask anything" }, maxMs: 1000 },
    });
    expect(
      validationBindingFromDraft({
        kind: "visual",
        criteria: "Composer is visible",
        region: "80,200,900,1400",
      }),
    ).toEqual({
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "visual",
        criteria: ["Composer is visible"],
        region: { x: 80, y: 200, width: 900, height: 1400 },
      },
    });
    expect(
      validationBindingFromDraft({
        kind: "identity-ignore",
        name: "reply body",
        region: "80,200,900,1400",
      }),
    ).toEqual({
      status: "resolved",
      kind: "recipe-step",
      step: {
        kind: "identity-ignore",
        region: { x: 80, y: 200, width: 900, height: 1400 },
        name: "reply body",
      },
    });
  });
});

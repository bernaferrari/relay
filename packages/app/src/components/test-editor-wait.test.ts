import { describe, expect, it } from "vitest";
import {
  isValidationDraftReady,
  sameValidationDraft,
  validationBindingFromDraft,
  validationDraft,
} from "./test-editor-assertion-model";

describe("condition waits", () => {
  it("saves a bounded generation wait in seconds and reopens it for editing", () => {
    const draft = {
      kind: "wait-for",
      label: "Download",
      condition: "visible",
      seconds: "60",
    } as const;
    const binding = validationBindingFromDraft(draft);
    expect(binding).toEqual({
      status: "resolved",
      kind: "recipe-step",
      step: {
        kind: "expect",
        target: { label: "Download" },
        condition: "visible",
        timeoutMs: 60000,
      },
    });
    expect(
      validationDraft({ id: "generation", kind: "validation", intent: "Video is ready", binding }),
    ).toMatchObject(draft);
    expect(
      sameValidationDraft(
        draft,
        validationDraft({
          id: "generation",
          kind: "validation",
          intent: "Video is ready",
          binding,
        }),
      ),
    ).toBe(true);
  });
  it("preserves recorded selector details when editing an assertion wait", () => {
    const binding = {
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "target",
        target: { label: "Generating", identifier: "generation-progress" },
        condition: "gone",
        timeoutMs: 30000,
      },
    } as const;
    const draft = validationDraft({
      id: "done",
      kind: "validation",
      intent: "Generation finished",
      binding,
    });
    expect(draft?.kind).toBe("wait-for");
    if (draft?.kind !== "wait-for") throw new Error("Missing wait editor");
    expect(validationBindingFromDraft({ ...draft, label: "Download" })).toMatchObject({
      assertion: { target: { label: "Download" } },
    });
    expect(validationBindingFromDraft({ ...draft, seconds: "120" })).toEqual({
      ...binding,
      assertion: { ...binding.assertion, timeoutMs: 120000 },
    });
  });
  it.each(["", "0", "-1", "30seconds", "Infinity", "901"])("rejects invalid wait %s", (seconds) => {
    const draft = { kind: "wait-for", label: "Generating", condition: "gone", seconds } as const;
    expect(isValidationDraftReady(draft)).toBe(false);
    expect(() => validationBindingFromDraft(draft)).toThrow();
  });
});

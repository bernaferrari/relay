import { describe, expect, it } from "vitest";
import type { AppMapScenarioTestStep, RecipeStep } from "@relay/protocol";
import {
  isValidationDraftReady,
  validationBindingFromDraft,
  validationDraft,
} from "./test-editor-assertion-model";

const response = {
  kind: "wait-response",
  id: "response-wait",
  target: { identifier: "assistant-message", ref: "@answer", role: "text" },
  busyTarget: { label: "Stop message", identifier: "response.stop" },
  idleTarget: { identifier: "response.done" },
  timeoutMs: 300_000,
  stableForMs: 1_500,
  maxMs: 120_000,
} satisfies Extract<RecipeStep, { kind: "wait-response" }>;

function draftFor(step: Extract<RecipeStep, { kind: "wait-response" }> = response) {
  const checkpoint = {
    id: "checkpoint",
    kind: "validation",
    intent: "Current reply is ready",
    binding: { status: "resolved", kind: "recipe-step", step },
  } satisfies AppMapScenarioTestStep;
  const draft = validationDraft(checkpoint);
  if (draft?.kind !== "wait-response") throw new Error("Missing response wait editor");
  return draft;
}

describe("response completion editor", () => {
  it("round-trips exact selectors and completion signals before any edit", () => {
    const draft = draftFor();
    expect(draft.label).toBe("assistant-message");
    expect(validationBindingFromDraft(draft)).toEqual({
      status: "resolved",
      kind: "recipe-step",
      step: response,
    });
  });

  it("changes only maximum duration while retaining busy/idle, timeout and stability", () => {
    expect(validationBindingFromDraft({ ...draftFor(), maxMs: "240000" })).toEqual({
      status: "resolved",
      kind: "recipe-step",
      step: { ...response, maxMs: 240_000 },
    });
    const { maxMs: _maxMs, ...withoutMax } = response;
    expect(validationBindingFromDraft({ ...draftFor(), maxMs: "" })).toEqual({
      status: "resolved",
      kind: "recipe-step",
      step: withoutMax,
    });
    expect(response.maxMs).toBe(120_000);
  });

  it("replaces only the selector when the person changes the reply control", () => {
    expect(validationBindingFromDraft({ ...draftFor(), label: "Current answer" })).toEqual({
      status: "resolved",
      kind: "recipe-step",
      step: { ...response, target: { label: "Current answer" } },
    });
    const target = { ref: "@answer" };
    expect(validationBindingFromDraft(draftFor({ ...response, target }))).toMatchObject({
      step: { target },
    });
    const decorated = { label: " Current answer ", identifier: "assistant-message" };
    expect(validationBindingFromDraft(draftFor({ ...response, target: decorated }))).toMatchObject({
      step: { target: decorated },
    });
  });

  it.each(["0", "-1", "900001", "1.5", "10seconds", "Infinity"])(
    "rejects an invalid maximum duration %s without rounding or weakening the source",
    (maxMs) => {
      const draft = { ...draftFor(), maxMs };
      expect(isValidationDraftReady(draft)).toBe(false);
      expect(() => validationBindingFromDraft(draft)).toThrow();
    },
  );
});

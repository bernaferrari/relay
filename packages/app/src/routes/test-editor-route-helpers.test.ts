import { describe, expect, it } from "vitest";
import type { AppMapScenarioTestStep } from "@relay/protocol";
import { insertPendingCheckpoint } from "./test-editor-route-helpers";

const pending: AppMapScenarioTestStep = {
  id: "step-pending",
  kind: "validation",
  intent: "Prove the result",
  capture: true,
  binding: {
    status: "unresolved",
    reason: "Choose what Relay should prove after this step.",
  },
};

describe("insertPendingCheckpoint", () => {
  it("inserts a local checkpoint without mutating the saved siblings", () => {
    const saved: AppMapScenarioTestStep[] = [
      {
        id: "step-cart",
        kind: "instruction",
        intent: "Open the cart",
        binding: { status: "resolved", kind: "connections", connectionIds: ["cart"] },
      },
    ];
    const next = insertPendingCheckpoint(saved, { step: pending, index: 1 });
    expect(saved).toHaveLength(1);
    expect(next.map((step) => step.id)).toEqual(["step-cart", "step-pending"]);
  });

  it("does not duplicate a checkpoint that already landed on the saved test", () => {
    const saved: AppMapScenarioTestStep[] = [
      {
        id: "step-cart",
        kind: "instruction",
        intent: "Open the cart",
        binding: { status: "resolved", kind: "connections", connectionIds: ["cart"] },
      },
      pending,
    ];
    expect(
      insertPendingCheckpoint(saved, { step: pending, index: 2 }).map((step) => step.id),
    ).toEqual(["step-cart", "step-pending"]);
  });
});

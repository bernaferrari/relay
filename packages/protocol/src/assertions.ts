import type { StepTarget } from "./recipes.js";

export type AssertionSpec =
  | { kind: "screen"; screenId: string }
  | { kind: "target"; target: StepTarget; condition: "visible" | "gone"; timeoutMs?: number }
  | {
      /** Compare two live semantic elements using their observed bounds. */
      kind: "layout";
      relation: "non-overlap";
      first: StepTarget;
      second: StepTarget;
      timeoutMs?: number;
    }
  | {
      kind: "content";
      input: string;
      expected: string;
      match: "exact" | "contains" | "not-contains";
    };

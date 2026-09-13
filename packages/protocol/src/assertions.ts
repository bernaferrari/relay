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
      match: "exact" | "equals" | "contains" | "not-contains" | "number-equals" | "field";
      field?: string;
    }
  | {
      kind: "visual";
      criteria: string[];
      region?: { x: number; y: number; width: number; height: number };
    }
  | {
      kind: "semantic";
      input: string;
      criteria: string[];
      requireAgreement?: boolean;
    };

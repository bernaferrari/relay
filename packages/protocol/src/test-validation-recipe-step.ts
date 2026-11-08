import type { RecipeStep } from "./recipes.js";

export type AppMapValidationRecipeStep = Extract<
  RecipeStep,
  {
    kind:
      | "expect"
      | "expect-set"
      | "assert-content"
      | "assert-layout"
      | "wait-response"
      | "extract"
      | "identity-ignore"
      | "upload"
      | "download"
      | "media-check"
      | "audio-record"
      | "screenshot"
      | "evaluate-semantic"
      | "evaluate-visual";
  }
>;

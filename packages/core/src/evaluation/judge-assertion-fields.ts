import type { AssertionSpec, RecipeStep } from "@relay/protocol";

export const DEFAULT_JUDGE_PROVIDER = "openrouter";
export const DEFAULT_INDEPENDENT_JUDGE_MODEL = "google/gemini-2.5-flash";

type JudgeAssertion = Extract<AssertionSpec, { kind: "visual" | "semantic" }>;
type JudgeFields = Pick<
  Extract<RecipeStep, { kind: "evaluate-visual" }>,
  "requireAgreement" | "provider" | "model" | "secondProvider" | "secondModel"
>;

export function compiledJudgeFields(assertion: JudgeAssertion): JudgeFields {
  const provider = assertion.provider?.trim();
  const model = assertion.model?.trim();
  const secondProvider = assertion.secondProvider?.trim();
  const secondModel = assertion.secondModel?.trim();
  if (!assertion.requireAgreement) {
    return {
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(secondProvider ? { secondProvider } : {}),
      ...(secondModel ? { secondModel } : {}),
    };
  }
  return {
    requireAgreement: true,
    provider: provider || DEFAULT_JUDGE_PROVIDER,
    ...(model ? { model } : {}),
    secondProvider: secondProvider || DEFAULT_JUDGE_PROVIDER,
    secondModel: secondModel || DEFAULT_INDEPENDENT_JUDGE_MODEL,
  };
}

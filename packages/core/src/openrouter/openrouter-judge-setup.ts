/**
 * Model provider presence for Settings and Morning review.
 * Never returns a key. Missing configuration is Infra, never a silent pass.
 */
import { resolveRelayModelProvider, type RelayModelResolution } from "../model/model-provider.js";
import { readSavedModelKey, type SavedModelKey } from "../model/model-key.js";

export type ModelJudgeSetup = {
  status: "ready" | "needs-attention";
  configured: boolean;
  provider?: string;
  detail: string;
};

export type OpenRouterJudgeSetup = ModelJudgeSetup;

export const MODEL_JUDGE_NOT_CONFIGURED =
  "Add a model provider key in Settings › Advanced so Relay can run plain-English steps and check screenshots. Until then, those steps say they couldn’t run instead of passing.";

export const OPENROUTER_JUDGE_NOT_CONFIGURED = MODEL_JUDGE_NOT_CONFIGURED;

function usable(resolution: RelayModelResolution): boolean {
  if (!resolution.provider) return false;
  if (resolution.provider === "openai-compatible") return Boolean(resolution.baseURL);
  return Boolean(resolution.apiKey);
}

function configuredDetail(provider: string): string {
  return `Model provider found (${provider}). Relay can run plain-English steps and judge screenshots.`;
}

/** Presence-only. Empty, whitespace, and unset values are all not configured. */
export function inspectModelJudgeSetup(
  env: NodeJS.Dict<string | undefined> = process.env,
  savedKey: SavedModelKey | null | undefined = readSavedModelKey(),
): ModelJudgeSetup {
  const resolution = resolveRelayModelProvider(env, savedKey);
  if (!usable(resolution)) {
    return {
      status: "needs-attention",
      configured: false,
      detail: MODEL_JUDGE_NOT_CONFIGURED,
    };
  }
  const provider = resolution.provider!;
  return {
    status: "ready",
    configured: true,
    provider,
    detail: configuredDetail(provider),
  };
}

/** Backwards-compatible name for the original OpenRouter-only probe. */
export function inspectOpenRouterJudgeSetup(
  env: NodeJS.Dict<string | undefined> = process.env,
): OpenRouterJudgeSetup {
  return inspectModelJudgeSetup(env);
}

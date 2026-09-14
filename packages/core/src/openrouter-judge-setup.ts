/**
 * Judge provider presence for Settings and Morning review.
 * Never returns the key. A missing key is Infra, never a silent pass.
 */

export type OpenRouterJudgeSetup = {
  status: "ready" | "needs-attention";
  configured: boolean;
  detail: string;
};

export const OPENROUTER_JUDGE_NOT_CONFIGURED =
  "Visual and semantic judges fail closed without OPENROUTER_API_KEY. That is Infra, never a silent pass.";

const OPENROUTER_JUDGE_CONFIGURED =
  "OPENROUTER_API_KEY is set. Visual and semantic judges can run.";

/** Presence-only. Empty, whitespace, and unset are all not configured. */
export function inspectOpenRouterJudgeSetup(
  env: NodeJS.Dict<string | undefined> = process.env,
): OpenRouterJudgeSetup {
  const configured = Boolean(env.OPENROUTER_API_KEY?.trim());
  if (!configured) {
    return {
      status: "needs-attention",
      configured: false,
      detail: OPENROUTER_JUDGE_NOT_CONFIGURED,
    };
  }
  return { status: "ready", configured: true, detail: OPENROUTER_JUDGE_CONFIGURED };
}

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
  "Add an OpenRouter key (OPENROUTER_API_KEY) so Relay can judge screenshots and on-screen text. Until then, those checks say they couldn’t run — they never pass silently.";

const OPENROUTER_JUDGE_CONFIGURED =
  "OpenRouter key found. Relay can judge screenshots and on-screen text.";

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

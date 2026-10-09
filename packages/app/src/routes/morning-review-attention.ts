import { judgeProviderChecks, labServerChecks, operatorBuildChecks } from "./settings-support";

export type MorningAttentionItem = {
  id: string;
  href: "/settings/advanced" | "/suites" | "/accounts";
  label: string;
  detail: string;
};

const JUDGE_FALLBACK =
  "Visual and semantic judges fail closed without OPENROUTER_API_KEY. That is Infra, never a silent pass. Plan Grok.com logged-out judged chrome (grok-web-judged, --lane grok-daily) is those eight judged Tests. Today it fail-closes as Infra. It is not grok-web-daily and not a judged pass.";

const NATIVE_GROK =
  "Native Grok columns need recorded Android and iOS routes. A live phone or iPad pack owns the glass — do not Recover-kill or dump. The emulator cannot install Grok. iOS lock and airplane stay Blocked / UNRECORDED: unlock still needs a person, and airplane is an iOS Settings handoff, not settings airplane on the Grok runner. Do not fake a lock run.";

/** Fail closed to the lab-Mac copy when setup payloads are missing. */
export function morningAttentionItems(input: { apple?: unknown }): MorningAttentionItem[] {
  const signed = operatorBuildChecks(input.apple)[0];
  const lab = labServerChecks(input.apple)[0];
  const judge = judgeProviderChecks(input.apple)[0];
  const items: MorningAttentionItem[] = [];
  if (!signed || signed.status !== "ready") {
    items.push({
      id: "signed-desktop",
      href: "/settings/advanced",
      label: "Signed desktop build",
      detail:
        signed?.detail?.trim() ||
        "stays Needs attention without Developer ID Application. Apple Development is not enough. Review stays on this Vite UI.",
    });
  }
  if (!judge || judge.status !== "ready") {
    items.push({
      id: "judge",
      href: "/suites",
      label: "Grok.com logged-out judged chrome",
      detail: judge?.detail?.trim()
        ? `${judge.detail} plan grok-web-judged (--lane grok-daily) is not grok-web-daily and not a judged pass.`
        : JUDGE_FALLBACK,
    });
  }
  items.push({
    id: "weekly",
    href: "/suites",
    label: "Grok.com weekly manual",
    detail:
      "Weekly pauses stay off daily. Continue with X, dictation, and camera need a phone. Do not schedule them daily.",
  });
  items.push({
    id: "accounts",
    href: "/accounts",
    label: "Accounts health",
    detail:
      "Check live health before the next unattended plan. Expired or signed-out accounts fail closed as Infra. One SuperGrok fixture is not a 3-account pack.",
  });
  items.push({
    id: "native",
    href: "/settings/advanced",
    label: "Native Grok",
    detail: NATIVE_GROK,
  });
  if (!lab || lab.status !== "ready") {
    items.push({
      id: "lab-server",
      href: "/settings/advanced",
      label: "Lab Mac server",
      detail:
        lab?.detail?.trim() ||
        "Lab Mac launchd stays unloaded. Job dev.relay.lab-server is not loaded. Do not load that job during a live plan — it restarts :8787.",
    });
  }
  return items;
}

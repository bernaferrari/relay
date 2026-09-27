import type { ProductRunSummary } from "@relay/product/catalog";
import type { ProductBrowserAccount } from "../data/app-resources-product-service";
import { accountHealthState, probedAccountIdentity } from "./sign-ins-health";

/**
 * How an account is described to people. Saved logins are stored as browser
 * authentication fixtures; none of that vocabulary (fixture, lane, reference)
 * belongs in the product. People see a name, a website, and whether it still
 * works.
 */

export type AccountStatus = "signed-in" | "needs-sign-in" | "unchecked-error" | "revoked";

export function accountStatus(account: ProductBrowserAccount): AccountStatus {
  const state = accountHealthState(account.fixture);
  if (state === "ready") return "signed-in";
  if (state === "revoked") return "revoked";
  if (state === "error") return "unchecked-error";
  return "needs-sign-in";
}

export function accountStatusLabel(status: AccountStatus): string {
  switch (status) {
    case "signed-in":
      return "Signed in";
    case "needs-sign-in":
      return "Needs sign-in";
    case "unchecked-error":
      return "Couldn’t check";
    case "revoked":
      return "Revoked";
  }
}

/** The name people recognise: who it signs in as, else the name it was saved under. */
export function accountDisplayName(account: ProductBrowserAccount): string {
  return probedAccountIdentity(account.fixture) ?? account.fixture.name ?? account.target.name;
}

const PROVIDERS: readonly { label: string; hosts: RegExp; name: RegExp }[] = [
  {
    label: "Google",
    hosts: /(^|\.)(accounts\.google\.com|google\.com)$/iu,
    name: /\b(google|gmail)\b/iu,
  },
  {
    label: "X",
    hosts: /(^|\.)(x\.com|twitter\.com)$/iu,
    name: /(^|[\s_-])(x|twitter)($|[\s_-])/iu,
  },
  { label: "Apple", hosts: /(^|\.)(appleid\.apple\.com|apple\.com)$/iu, name: /\bapple\b/iu },
  { label: "GitHub", hosts: /(^|\.)github\.com$/iu, name: /\bgithub\b/iu },
  {
    label: "Microsoft",
    hosts: /(^|\.)(login\.microsoftonline\.com|live\.com|microsoft\.com)$/iu,
    name: /\b(microsoft|outlook)\b/iu,
  },
  { label: "Email", hosts: /$^/u, name: /\b(e-?mail|password)\b/iu },
];

function bareHost(value: string): string | undefined {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.host.replace(/^www\./u, "").toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The website this account signs into. The browser's start page is the
 * clearest answer; otherwise the first saved cookie origin that is not an
 * identity provider.
 */
export function accountSiteUrl(account: ProductBrowserAccount): string | undefined {
  if (account.target.startUrl) return account.target.startUrl;
  const origins = account.fixture.origins ?? [];
  const site =
    origins.find((origin) => {
      const host = bareHost(origin);
      return host && !PROVIDERS.some((provider) => provider.hosts.test(host));
    }) ?? origins[0];
  if (!site) return undefined;
  return site.includes("://") ? site : `https://${site}`;
}

export function accountSiteHost(account: ProductBrowserAccount): string | undefined {
  const url = accountSiteUrl(account);
  return url ? bareHost(url) : undefined;
}

/**
 * Sign-in method, only when the saved data says so: an identity provider's
 * cookies were captured, or the name people gave it names one. Otherwise
 * nothing — never a guess dressed up as a fact.
 */
export function accountProvider(account: ProductBrowserAccount): string | undefined {
  const site = accountSiteHost(account);
  for (const origin of account.fixture.origins ?? []) {
    const host = bareHost(origin);
    if (!host || host === site) continue;
    const match = PROVIDERS.find((provider) => provider.hosts.test(host));
    if (match) return match.label;
  }
  const name = account.fixture.name ?? "";
  return PROVIDERS.find((provider) => provider.name.test(name))?.label;
}

/** Whether a run was made as this account. Runs record either the id or the reference. */
export function runUsesAccount(
  run: Pick<ProductRunSummary, "executionIdentity">,
  account: Pick<ProductBrowserAccount["fixture"], "id" | "reference">,
): boolean {
  const used = run.executionIdentity?.accountId;
  return Boolean(used && (used === account.id || used === account.reference));
}

export function accountLastUsedAt(
  account: ProductBrowserAccount,
  runs: readonly Pick<
    ProductRunSummary,
    "executionIdentity" | "queuedAt" | "startedAt" | "finishedAt"
  >[],
): number | undefined {
  let latest: number | undefined;
  for (const run of runs) {
    if (!runUsesAccount(run, account.fixture)) continue;
    const at = run.finishedAt ?? run.startedAt ?? run.queuedAt;
    if (latest === undefined || at > latest) latest = at;
  }
  return latest;
}

/** "today", "yesterday", "3 days ago", "2 months ago". */
export function relativeDay(timestamp: number, now = Date.now()): string {
  const days = Math.round((startOfDay(timestamp) - startOfDay(now)) / 86_400_000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(days) < 30) return format.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return format.format(months, "month");
  return format.format(Math.round(days / 365), "year");
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** One line of facts under the account name. */
export function accountFacts(
  account: ProductBrowserAccount,
  lastUsedAt: number | undefined,
): string[] {
  const facts: string[] = [];
  const identity = probedAccountIdentity(account.fixture);
  if (identity && identity !== account.fixture.name) facts.push(`Saved as ${account.fixture.name}`);
  const provider = accountProvider(account);
  if (provider) facts.push(provider === "Email" ? "Email sign-in" : `Signs in with ${provider}`);
  if (lastUsedAt !== undefined) facts.push(`Used ${relativeDay(lastUsedAt)}`);
  const checkedAt = account.fixture.health?.checkedAt;
  if (checkedAt !== undefined) facts.push(`Checked ${relativeDay(checkedAt)}`);
  else facts.push(`Saved ${relativeDay(account.fixture.createdAt)}`);
  return facts;
}

/** Accounts for a browser, friendliest first, for account pickers. */
export function accountsForBrowser(
  accounts: readonly ProductBrowserAccount[],
  targetId: string,
): readonly ProductBrowserAccount[] {
  return accounts.filter(
    (account) => account.target.id === targetId && accountStatus(account) !== "revoked",
  );
}

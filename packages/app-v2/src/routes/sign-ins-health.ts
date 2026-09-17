import type {
  ProductAccountLane,
  ProductBrowserAccount,
} from "../data/app-resources-product-service";

export type SignInHealthState = "ready" | "needs-relogin" | "expired" | "revoked" | "error";

export function accountHealthState(fixture: ProductBrowserAccount["fixture"]): SignInHealthState {
  if (fixture.revokedAt !== undefined) return "revoked";
  if (fixture.health?.status === "needs-relogin") return "needs-relogin";
  if (fixture.health?.status === "expired") return "expired";
  if (fixture.health?.status === "revoked") return "revoked";
  if (fixture.health?.status === "error") return "error";
  if (fixture.expiresAt !== undefined && fixture.expiresAt <= Date.now()) return "expired";
  return "ready";
}

export function signInStatusLabel(status: string): string {
  return status.replace(/-/gu, " ").replace(/^./u, (letter) => letter.toLocaleUpperCase());
}

export function liveSignIns(
  accounts: readonly ProductBrowserAccount[],
): readonly ProductBrowserAccount[] {
  return accounts.filter((account) => accountHealthState(account.fixture) !== "revoked");
}

/** Ready fixtures only. Needs-relogin / expired are visible, not live SuperGrok. */
export function readySignIns(
  accounts: readonly ProductBrowserAccount[],
): readonly ProductBrowserAccount[] {
  return accounts.filter((account) => accountHealthState(account.fixture) === "ready");
}

export function probedAccountIdentity(
  fixture: ProductBrowserAccount["fixture"],
): string | undefined {
  const identity = fixture.health?.identity?.trim();
  return identity || undefined;
}

export function revokedSignIns(
  accounts: readonly ProductBrowserAccount[],
): readonly ProductBrowserAccount[] {
  return accounts.filter((account) => accountHealthState(account.fixture) === "revoked");
}

export function concurrentAccountCopy(liveCount: number): string {
  if (liveCount >= 3) {
    return `${liveCount} live accounts can run the same Test concurrently. Preflight still quotes observed serial until a measured N-account pack exists.`;
  }
  if (liveCount === 2) {
    return "Two live accounts can run concurrently. A 3-account Plan needs a third saved sign-in.";
  }
  if (liveCount === 1) {
    return "One live account. Concurrent N-account Plans need another saved sign-in. Signed-out remains a separate lane.";
  }
  return "No live accounts. Signed-out remains a separate lane. Save a sign-in before a fixture Lane.";
}

export function lanesForAccount(
  account: ProductBrowserAccount,
  lanes: readonly ProductAccountLane[],
): readonly ProductAccountLane[] {
  return lanes.filter(
    (lane) =>
      lane.targetId === account.target.id &&
      lane.kind === "fixture" &&
      lane.reference === account.fixture.reference,
  );
}

export function healthCheckedAt(fixture: ProductBrowserAccount["fixture"]): number | undefined {
  return fixture.health?.checkedAt;
}

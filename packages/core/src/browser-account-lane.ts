import type { BrowserCaseProfile, ExecutionTargetRef } from "@relay/protocol";

/**
 * Scheduler and mutation-admission identity for one browser account.
 *
 * Physical phones stay one exclusive lane. Browser accounts on the same
 * managed target must not serialize behind that target id: each fixture (or
 * attested signed-out) is its own lane, bounded later by the browser host
 * ceiling.
 */
export function browserAccountSchedulingKey(
  targetId: string,
  authenticationFixtureId?: string,
): string {
  const identity = targetId.trim();
  const fixture = authenticationFixtureId?.trim();
  return fixture ? `${identity}#${fixture}` : `${identity}#signed-out`;
}

/** Managed browser id encoded in a fixture or signed-out scheduling lane. */
export function managedBrowserTargetIdFromSchedulingKey(key: string): string | undefined {
  const identity = key.trim();
  const sep = identity.indexOf("#");
  if (sep <= 0) return undefined;
  const suffix = identity.slice(sep + 1);
  if (suffix !== "signed-out" && !suffix.startsWith("authfx:")) return undefined;
  return identity.slice(0, sep);
}

export function controlTargetIdForBrowserLane(key: string): string {
  return managedBrowserTargetIdFromSchedulingKey(key) ?? key.trim();
}

export function jobSchedulingTargetId(input: {
  executionTarget: ExecutionTargetRef;
  browserCaseProfile?: Pick<BrowserCaseProfile, "authenticationFixtureId">;
}): string {
  const targetId = input.executionTarget.identity.value;
  if (input.executionTarget.kind !== "local-browser") {
    return targetId;
  }
  return browserAccountSchedulingKey(targetId, input.browserCaseProfile?.authenticationFixtureId);
}

export const DEFAULT_BROWSER_HOST_CAPACITY = 8;

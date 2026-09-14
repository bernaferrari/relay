import type { BrowserCaseProfile, ExecutionTargetRef } from "@relay/protocol";

/**
 * Scheduler and mutation-admission identity for one browser account.
 *
 * Physical phones stay one exclusive lane. Browser accounts on the same
 * managed target must not serialize behind that target id: each fixture (or
 * attested signed-out Lane) is its own lane, bounded later by the browser host
 * ceiling. Two unsigned Lanes therefore overlap; two jobs on the same unsigned
 * Lane still serialize.
 */
export function unsignedBrowserLaneId(input: {
  laneId?: string;
  authenticationFixtureId?: string;
  accountKind?: string;
}): string | undefined {
  if (input.authenticationFixtureId?.trim()) return undefined;
  if (input.accountKind === "fixture") return undefined;
  const laneId = input.laneId?.trim();
  return laneId || undefined;
}

/** Combine/Plan start identity that matches job unsignedLaneId. Fixture
 * accounts stay combine-wide so same-lane Repeat still 409s. */
export function combineStartAdmissionLaneId(input: {
  laneId?: string;
  profileTargets?: Array<{ account?: { kind?: string } }>;
}): string | undefined {
  return unsignedBrowserLaneId({
    laneId: input.laneId,
    accountKind: input.profileTargets?.some((target) => target.account?.kind === "fixture")
      ? "fixture"
      : undefined,
  });
}

export function browserAccountSchedulingKey(
  targetId: string,
  authenticationFixtureId?: string,
  unsignedLaneId?: string,
): string {
  const identity = targetId.trim();
  const fixture = authenticationFixtureId?.trim();
  if (fixture) return `${identity}#${fixture}`;
  const lane = unsignedLaneId?.trim();
  return lane ? `${identity}#signed-out:${lane}` : `${identity}#signed-out`;
}

/** Managed browser id encoded in a fixture or signed-out scheduling lane. */
export function managedBrowserTargetIdFromSchedulingKey(key: string): string | undefined {
  const identity = key.trim();
  const sep = identity.indexOf("#");
  if (sep <= 0) return undefined;
  const suffix = identity.slice(sep + 1);
  if (
    suffix !== "signed-out" &&
    !suffix.startsWith("signed-out:") &&
    !suffix.startsWith("authfx:")
  ) {
    return undefined;
  }
  return identity.slice(0, sep);
}

export function controlTargetIdForBrowserLane(key: string): string {
  return managedBrowserTargetIdFromSchedulingKey(key) ?? key.trim();
}

export function jobSchedulingTargetId(input: {
  executionTarget: ExecutionTargetRef;
  browserCaseProfile?: Pick<BrowserCaseProfile, "authenticationFixtureId">;
  unsignedLaneId?: string;
}): string {
  const targetId = input.executionTarget.identity.value;
  if (input.executionTarget.kind !== "local-browser") {
    return targetId;
  }
  return browserAccountSchedulingKey(
    targetId,
    input.browserCaseProfile?.authenticationFixtureId,
    input.unsignedLaneId,
  );
}

export const DEFAULT_BROWSER_HOST_CAPACITY = 8;

import type {
  AppMapCombineObservedDuration,
  BrowserAccountPackQuote,
  CombineProfileTargetInput,
} from "@relay/protocol";
import { browserAccountSchedulingKey } from "./browser-account-lane.js";
import { preflightLocalCampaignCapacity } from "./local-campaign-capacity-preflight.js";

function browserAccountLaneId(target: CombineProfileTargetInput): string | undefined {
  const targetId = target.target.browserTargetId?.trim() || target.target.serial?.trim();
  if (!targetId) return undefined;
  const browser =
    Boolean(target.target.browserTargetId) ||
    target.target.platform === "browser" ||
    target.target.targetKind === "browser";
  if (!browser) return undefined;
  const fixture =
    target.account?.kind === "fixture"
      ? target.account.reference?.trim() ||
        `authfx:${target.account.accountId}:${target.account.accountRevision}`
      : undefined;
  return browserAccountSchedulingKey(targetId, fixture);
}

/** Distinct signed-in fixtures asked for on a Plan. Unsigned / auth Lanes are not members. */
export function requestedFixtureReferences(
  profileTargets: readonly CombineProfileTargetInput[],
): string[] {
  const refs = new Set<string>();
  for (const target of profileTargets) {
    if (target.account?.kind !== "fixture") continue;
    const reference =
      target.account.reference?.trim() ||
      `authfx:${target.account.accountId}:${target.account.accountRevision}`;
    if (reference) refs.add(reference);
  }
  return [...refs];
}

function liveRequestedFixtureReferences(
  requested: readonly string[],
  liveFixtureReferences: readonly string[] | undefined,
): string[] {
  const live = new Set((liveFixtureReferences ?? []).map((ref) => ref.trim()).filter(Boolean));
  return requested.filter((ref) => live.has(ref));
}

/**
 * Concurrent SuperGrok duration stays blocked unless every requested fixture
 * is live. One SuperGrok fixture cannot produce a 3-account SuperGrok quote.
 * Distinct unsigned / auth Lanes are isolation, not SuperGrok members.
 */
export function quoteSuperGrokAccountPackDuration(input: {
  checks: number;
  profileTargets: readonly CombineProfileTargetInput[];
  observed?: AppMapCombineObservedDuration;
  liveFixtureReferences: readonly string[];
}): BrowserAccountPackQuote | undefined {
  const requested = requestedFixtureReferences(input.profileTargets);
  if (requested.length < 2) return undefined;
  const liveRequested = liveRequestedFixtureReferences(requested, input.liveFixtureReferences);
  if (liveRequested.length < requested.length) return undefined;
  return quoteBrowserAccountPackDuration({
    checks: input.checks,
    profileTargets: input.profileTargets,
    observed: input.observed,
    liveFixtureReferences: input.liveFixtureReferences,
  });
}

export function quoteBrowserAccountPackDuration(input: {
  checks: number;
  profileTargets: readonly CombineProfileTargetInput[];
  observed?: AppMapCombineObservedDuration;
  liveFixtureReferences?: readonly string[];
}): BrowserAccountPackQuote | undefined {
  if (!input.observed || input.checks <= 0 || !input.profileTargets.length) return undefined;
  if (input.observed.workItemCount <= 0 || input.observed.durationMs <= 0) return undefined;
  const requested = requestedFixtureReferences(input.profileTargets);
  if (requested.length >= 2) {
    const liveRequested = liveRequestedFixtureReferences(requested, input.liveFixtureReferences);
    if (liveRequested.length < requested.length) return undefined;
  }
  if (input.profileTargets.some((target) => !browserAccountLaneId(target))) return undefined;
  const lanes = [
    ...new Set(
      input.profileTargets
        .map(browserAccountLaneId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (!lanes.length) return undefined;
  const workItems = input.checks * input.profileTargets.length;
  const workItemDurationMs = Math.ceil(input.observed.durationMs / input.observed.workItemCount);
  const preflight = preflightLocalCampaignCapacity({
    targets: lanes.map((targetId) => ({ targetId, platform: "browser" })),
    workItems,
    workItemsByPlatform: { browser: workItems },
    duration: { workItemDurationMs, provenance: "supplied" },
    deadlineMs: 3_600_000,
    devices: [],
    leases: [],
    workers: [],
    at: 1,
  });
  const estimatedParallelDurationMs = preflight.deadline.estimatedParallelDurationMs;
  if (typeof estimatedParallelDurationMs !== "number") return undefined;
  return {
    estimatedParallelDurationMs,
    laneCount: lanes.length,
    workItems,
    workItemDurationMs,
    observedDurationMs: input.observed.durationMs,
    observedWorkItemCount: input.observed.workItemCount,
  };
}

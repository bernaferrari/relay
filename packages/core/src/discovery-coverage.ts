import { createHash } from "node:crypto";
import type {
  DiscoveryCoverageItem,
  DiscoveryCoverageReport,
  DiscoverySession,
  TargetProfile,
} from "@relay/protocol";
import {
  buildDiscoveryJourney,
  discoveryExploreOutcome,
  inferDiscoveryBlockedReasons,
} from "./discovery-journey.js";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

type WorkingItem = {
  id: string;
  label: string;
  profiles: Set<string>;
  sessions: Set<string>;
};

function finalized(items: Iterable<WorkingItem>, profileIds: string[]): DiscoveryCoverageItem[] {
  return [...items]
    .map((item) => ({
      id: item.id,
      label: item.label,
      observedProfileIds: [...item.profiles].sort(),
      missingProfileIds: profileIds.filter((id) => !item.profiles.has(id)),
      sessionIds: [...item.sessions].sort(),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * Sessions intentionally share a name to describe one product map observed on
 * different frozen targets. Screen identity remains semantic; screenshots are
 * preserved as per-profile evidence rather than being compared as pixels.
 */
export function buildDiscoveryCoverage(
  anchor: DiscoverySession,
  sessions: DiscoverySession[],
  at = Date.now(),
): DiscoveryCoverageReport {
  const related = sessions.filter((session) => session.name === anchor.name);
  const profiles = new Map<string, TargetProfile>();
  for (const session of related) {
    if (session.targetProfile) profiles.set(session.targetProfile.id, session.targetProfile);
  }
  const profileIds = [...profiles.keys()].sort();
  const screens = new Map<string, WorkingItem>();
  const transitions = new Map<string, WorkingItem>();
  for (const session of related) {
    const profileId = session.targetProfile?.id;
    for (const screen of session.screens) {
      const item = screens.get(screen.fingerprint) ?? {
        id: screen.fingerprint,
        label: screen.title ?? "Observed screen",
        profiles: new Set<string>(),
        sessions: new Set<string>(),
      };
      if (profileId) item.profiles.add(profileId);
      item.sessions.add(session.id);
      screens.set(screen.fingerprint, item);
    }
    const byId = new Map(session.screens.map((screen) => [screen.id, screen]));
    for (const transition of session.transitions) {
      const from = byId.get(transition.fromScreenId);
      if (!from) continue;
      const to = transition.toScreenId ? byId.get(transition.toScreenId) : undefined;
      const label = `${from.title ?? "Screen"} → ${to?.title ?? "same screen"} · ${transition.label ?? transition.kind}`;
      const id = digest(
        JSON.stringify({
          from: from.fingerprint,
          to: to?.fingerprint ?? from.fingerprint,
          kind: transition.kind,
          label: transition.label ?? "",
        }),
      );
      const item = transitions.get(id) ?? {
        id,
        label,
        profiles: new Set<string>(),
        sessions: new Set<string>(),
      };
      if (profileId) item.profiles.add(profileId);
      item.sessions.add(session.id);
      transitions.set(id, item);
    }
  }
  const blockedReasons = inferDiscoveryBlockedReasons(anchor);
  return {
    mapName: anchor.name,
    generatedAt: at,
    sessionIds: related.map((session) => session.id).sort(),
    profiles: [...profiles.values()].sort((left, right) => left.name.localeCompare(right.name)),
    unprofiledSessionIds: related
      .filter((session) => !session.targetProfile)
      .map((session) => session.id)
      .sort(),
    screens: finalized(screens.values(), profileIds),
    transitions: finalized(transitions.values(), profileIds),
    journey: buildDiscoveryJourney(anchor, at),
    blockedReasons,
    exploreOutcome: discoveryExploreOutcome(anchor, blockedReasons),
  };
}

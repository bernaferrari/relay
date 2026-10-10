import type { AppMap, AppMapScenarioTest, AppMapScenarioTestStep } from "@relay/protocol";
import { stepNeedsSetup, stepRunsFromText } from "@relay/protocol";
import { unrecordedProductName } from "@relay/protocol";
import { frozenRawAccessibilityTargetProfiles } from "@relay/core";
import {
  PLAN_PLATFORMS,
  recordedPlanPlatformsFromAppMap,
  recordedRoutePlatformBlocker,
  testRoutePlatformStatuses,
  type PlanPlatform,
} from "@relay/product/test-route-platforms";
import { scenarioTestOriginMissingEvidence } from "@relay/product/test-origin-readiness";

type DiscoveryStatus =
  | "recorded"
  | "needs-recording"
  | "needs-binding"
  | "needs-evidence"
  | "blocked";
type Discovery = {
  status: DiscoveryStatus;
  platforms: Record<PlanPlatform, "reviewed" | "unrecorded" | "linked" | "blocked">;
  reason?: string;
  platformBlockers?: Partial<Record<PlanPlatform, string>>;
  linkedTests?: Array<{ platform: PlanPlatform; appMapId: string; testId: string }>;
  /** Every step runs from its plain-English words; no recording is needed. */
  runsFromText?: true;
};

function runsFromWords(test: AppMapScenarioTest): boolean {
  return (
    test.steps.length > 0 &&
    test.steps.some(stepRunsFromText) &&
    test.steps.every((step) => stepRunsFromText(step) || step.binding.status !== "unresolved")
  );
}

function firstUnbound(steps: readonly AppMapScenarioTestStep[]): string | undefined {
  for (const step of steps) {
    if (step.binding.status === "unresolved" && stepNeedsSetup(step))
      return step.binding.reason || "Record or bind the action.";
    if (step.kind === "decision") {
      const reason = firstUnbound(step.thenSteps) ?? firstUnbound(step.elseSteps ?? []);
      if (reason) return reason;
    } else if (step.kind === "loop") {
      const reason = firstUnbound(step.steps);
      if (reason) return reason;
    }
  }
  return undefined;
}

export function discoveryForTest(map: AppMap, test: AppMapScenarioTest): Discovery {
  const recordedPlatforms = recordedPlanPlatformsFromAppMap(map, test);
  const platformBlockers = Object.fromEntries(
    PLAN_PLATFORMS.flatMap((platform) => {
      const reason = recordedRoutePlatformBlocker(test, map, platform);
      return reason ? [[platform, reason]] : [];
    }),
  ) as Partial<Record<PlanPlatform, string>>;
  const routes = testRoutePlatformStatuses(test, { recordedPlatforms, platformBlockers });
  const platforms = Object.fromEntries(
    routes.map((route) => [route.platform, route.status]),
  ) as Discovery["platforms"];
  const linkedTests = routes.flatMap((route) =>
    route.companion ? [{ platform: route.platform, ...route.companion }] : [],
  );
  const context = {
    platforms,
    ...(Object.keys(platformBlockers).length ? { platformBlockers } : {}),
    ...(linkedTests.length ? { linkedTests } : {}),
  };
  if (unrecordedProductName(test.name) || !test.steps.length) {
    return {
      ...context,
      status: "needs-recording",
      reason: "This saved Test is an unrecorded draft.",
    };
  }
  const unbound = firstUnbound(test.steps);
  if (unbound) return { ...context, status: "needs-binding", reason: unbound };
  const origin = scenarioTestOriginMissingEvidence(map, test);
  if (origin)
    return {
      ...context,
      status: "needs-evidence",
      reason: `Capture the starting screen “${origin.title}” before running.`,
    };
  if (routes.some((route) => route.status === "reviewed"))
    return { ...context, status: "recorded" };
  if (routes.some((route) => route.status === "blocked")) return { ...context, status: "blocked" };
  if (runsFromWords(test)) return { ...context, status: "needs-recording", runsFromText: true };
  return {
    ...context,
    status: "needs-recording",
    reason: linkedTests.length
      ? "Choose a linked Test for its recorded native route."
      : "Record this Test on a target before running.",
  };
}

/** CLI-only, read-only discovery metadata. Keep the protocol summary and every
 * existing row field; saved recording context is not live execution readiness. */
export function summarizeTestDiscovery(
  operationId: string,
  result: unknown,
  summary: unknown,
  commandPath?: string,
): unknown {
  if (operationId !== "app-map.get" || commandPath !== "test list") return summary;
  const map = (result as { appMap?: AppMap } | undefined)?.appMap;
  const presented = summary as { tests?: Array<{ id: string }> } | undefined;
  if (!map?.tests || !map.screens || !map.screenVariants || !map.connections || !presented?.tests)
    return summary;
  const discoveries = new Map<string, Discovery>();
  const tests = presented.tests.map((entry) => {
    const saved = map.tests[entry.id];
    if (!saved || saved.kind !== "scenario") return entry;
    const discovery = discoveryForTest(map, saved);
    discoveries.set(entry.id, discovery);
    return { ...entry, discovery };
  });
  const counts = Object.fromEntries(
    ["recorded", "needs-recording", "needs-binding", "needs-evidence", "blocked"].map((status) => [
      status,
      [...discoveries.values()].filter((entry) => entry.status === status).length,
    ]),
  );
  const savedTargetProfiles = frozenRawAccessibilityTargetProfiles(map).map((profile) => ({
    id: profile.id,
    platform: profile.platform,
    targetId: profile.targetId,
  }));
  return {
    ...presented,
    tests,
    discovery: {
      scope: "saved-recordings",
      appMapId: map.id,
      revision: map.revision,
      liveTargetChecked: false,
      counts,
      savedTargetProfiles,
      nextStep:
        "Compile the chosen Test with a saved targetProfileId to inspect offline blockers; choose a connected target before running.",
    },
  };
}

/** Whether `relay ci` should run this Test, in the words `relay tests` shows. */
export function testReadiness(
  map: AppMap,
  test: AppMapScenarioTest,
): { ready: boolean; label: string; reason?: string } {
  return readinessFromDiscovery(discoveryForTest(map, test));
}

export function readinessFromDiscovery(discovery: {
  status?: unknown;
  reason?: unknown;
  runsFromText?: unknown;
}): { ready: boolean; label: string; reason?: string } {
  const reason = typeof discovery.reason === "string" ? discovery.reason : undefined;
  if (discovery.status === "recorded") return { ready: true, label: "ready" };
  if (discovery.runsFromText === true) return { ready: true, label: "ready (plain English)" };
  const label =
    discovery.status === "needs-binding"
      ? "needs setup"
      : discovery.status === "needs-evidence"
        ? "needs start screen"
        : discovery.status === "blocked"
          ? "blocked"
          : "needs recording";
  return { ready: false, label, ...(reason ? { reason } : {}) };
}

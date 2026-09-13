import type {
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  TargetProfile,
} from "@relay/protocol";

export const PLAN_PLATFORMS = ["browser", "android", "ios"] as const;

export type PlanPlatform = (typeof PLAN_PLATFORMS)[number];

export type TestRoutePlatformStatus = {
  readonly platform: PlanPlatform;
  readonly label: string;
  readonly status: "reviewed" | "unrecorded";
  readonly variantId?: string;
  readonly reason?: string;
};

const PLATFORM_LABEL: Record<PlanPlatform, string> = {
  browser: "Web",
  android: "Android",
  ios: "iOS",
};

function implicitRecordedPlatform(origin?: string): PlanPlatform | undefined {
  if (!origin?.trim()) return undefined;
  if (/^https?:\/\//iu.test(origin)) return "browser";
  return undefined;
}

function unrecordedReason(platform: PlanPlatform): string {
  return `No recorded ${PLATFORM_LABEL[platform]} route. Do not invent Grok Settings navigation.`;
}

function connectionIdsFromSteps(steps: readonly AppMapScenarioTestStep[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if (step.binding.status === "resolved" && step.binding.kind === "connections") {
      ids.push(...step.binding.connectionIds);
    }
    if (step.kind === "decision") {
      ids.push(...connectionIdsFromSteps(step.thenSteps));
      if (step.elseSteps) ids.push(...connectionIdsFromSteps(step.elseSteps));
    }
    if (step.kind === "loop") ids.push(...connectionIdsFromSteps(step.steps));
  }
  return ids;
}

/** Surfaces already recorded on the App Map. Origin URLs count as Web. */
export function recordedPlanPlatformsFromAppMap(
  map: Pick<AppMap, "screens" | "screenVariants" | "connections">,
  test: Pick<AppMapScenarioTest, "originApplication" | "steps">,
): PlanPlatform[] {
  const platforms = new Set<PlanPlatform>();
  const origin = implicitRecordedPlatform(test.originApplication);
  if (origin) platforms.add(origin);
  for (const connectionId of connectionIdsFromSteps(test.steps)) {
    const connection = map.connections[connectionId];
    if (!connection) continue;
    const destinationScreenId =
      connection.destination.kind === "screen" ? connection.destination.screenId : undefined;
    for (const screenId of [connection.fromScreenId, destinationScreenId]) {
      if (!screenId) continue;
      const screen = map.screens[screenId];
      if (!screen) continue;
      for (const variantId of screen.variantIds) {
        const platform = map.screenVariants[variantId]?.targetProfile?.platform;
        if (platform === "android" || platform === "ios" || platform === "browser") {
          platforms.add(platform);
        }
      }
    }
  }
  return PLAN_PLATFORMS.filter((platform) => platforms.has(platform));
}

/** One Test intent, three platform rows. Unrecorded native routes stay visible. */
export function testRoutePlatformStatuses(
  test: Pick<AppMapScenarioTest, "family" | "originApplication">,
  options?: { recordedPlatforms?: readonly PlanPlatform[] },
): TestRoutePlatformStatus[] {
  const variants = test.family?.routeVariants ?? [];
  const implicit = test.family ? undefined : implicitRecordedPlatform(test.originApplication);
  return PLAN_PLATFORMS.map((platform) => {
    const match = variants.find((variant) => {
      const platforms = variant.predicate.platforms as TargetProfile["platform"][] | undefined;
      return !platforms || platforms.includes(platform);
    });
    if (match) {
      return {
        platform,
        label: PLATFORM_LABEL[platform],
        status: "reviewed" as const,
        variantId: match.id,
      };
    }
    if (!test.family && (implicit === platform || options?.recordedPlatforms?.includes(platform))) {
      return {
        platform,
        label: PLATFORM_LABEL[platform],
        status: "reviewed" as const,
      };
    }
    return {
      platform,
      label: PLATFORM_LABEL[platform],
      status: "unrecorded" as const,
      reason: unrecordedReason(platform),
    };
  });
}

/** Step-list copy when Android/iOS are unrecorded. Web steps stay enabled. */
export function unrecordedNativeEditorNotice(
  statuses: readonly TestRoutePlatformStatus[],
): string | undefined {
  const missing = statuses.filter((item) => item.status === "unrecorded");
  if (!missing.length) return undefined;
  const names = missing.map((item) => item.label).join(" and ");
  return `${names} steps stay disabled until a native route is recorded. Do not invent Grok Settings navigation.`;
}

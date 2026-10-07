import type {
  AppMap,
  BrowserAuthenticationFixture,
  DeviceSummary,
  OperationOutput,
  TargetDefinition,
  TargetPreflight,
} from "@relay/protocol";
import {
  PLAN_PLATFORMS,
  recordedPlanPlatformsFromAppMap,
  testRoutePlatformStatuses,
} from "@relay/product/test-route-platforms";
import type { ProductClientContext } from "./product-client";
import type {
  ProductAuthenticationFixture,
  ProductBuildOption,
  ProductEnvironmentProfile,
} from "./suite-profile-product-service";
import { projectDevices } from "./device-product-service";

export type ProductEnvironmentScope = { appMapId: string; combineId?: string };
export type ProductNativeReadiness = { state: "proven" | "unproven" | "blocked"; message: string };
type BuildDto = OperationOutput<"build.list">["builds"][number];
type Client = ProductClientContext["client"];
const name = (value: string | undefined, fallback: string) => value?.trim() || fallback;

function projectBuild(build: BuildDto): ProductBuildOption {
  return {
    id: build.id,
    name: build.name,
    platform: build.platform,
    status: build.status,
    ...(build.applicationId ? { applicationId: build.applicationId } : {}),
    ...(build.sourceSha ? { sourceSha: build.sourceSha } : {}),
    updatedAt: build.updatedAt,
  };
}
function projectFixture(fixture: BrowserAuthenticationFixture): ProductAuthenticationFixture {
  return {
    id: fixture.id,
    reference: fixture.reference,
    revision: fixture.revision,
    targetId: fixture.targetId,
    name: fixture.name,
    origins: [...fixture.origins],
    cookieCount: fixture.cookieCount,
    createdAt: fixture.createdAt,
    ...(fixture.expiresAt === undefined ? {} : { expiresAt: fixture.expiresAt }),
    ...(fixture.revokedAt === undefined ? {} : { revokedAt: fixture.revokedAt }),
  };
}

/** Existing managed resources remain metadata; no execution profile is created. */
export function projectProductEnvironmentProfiles(input: {
  targets: readonly TargetDefinition[];
  builds?: readonly BuildDto[];
  fixtures?: readonly BrowserAuthenticationFixture[];
}): readonly ProductEnvironmentProfile[] {
  const builds = (input.builds ?? []).map(projectBuild);
  return input.targets
    .map((target) => ({
      id: target.id,
      name: name(target.name, target.id),
      targetId: target.id,
      source: { kind: "managed-target" as const, id: target.id },
      target: {
        id: target.id,
        name: name(target.name, target.id),
        kind: target.kind,
        ...(target.browser ? { browser: structuredClone(target.browser) } : {}),
      },
      platform: target.kind,
      ...(target.browser?.environment
        ? { browserEnvironment: structuredClone(target.browser.environment) }
        : {}),
      authenticationOptions: (input.fixtures ?? [])
        .filter((fixture) => fixture.targetId === target.id)
        .map(projectFixture),
      buildOptions: builds.filter((build) =>
        target.kind === "browser" ? build.platform === "web" : build.platform === target.kind,
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

/** Only local reviewed routes constrain choices. Unknown legacy routes remain
 * unknown; a linked companion never establishes a route in this App. */
function platformsForPlan(map: AppMap, combineId?: string) {
  const testIds = combineId
    ? (map.combines?.[combineId]?.testIds ?? [])
    : Object.keys(map.tests ?? {});
  let platforms = [...PLAN_PLATFORMS];
  const appPlatforms = new Set<(typeof PLAN_PLATFORMS)[number]>();
  for (const testId of testIds) {
    const test = map.tests[testId];
    if (!test) continue;
    const statuses = testRoutePlatformStatuses(test, {
      recordedPlatforms: recordedPlanPlatformsFromAppMap(map, test),
    });
    const recorded = statuses
      .filter((status) => status.status === "reviewed" || status.status === "blocked")
      .map((status) => status.platform);
    for (const platform of recorded) appPlatforms.add(platform);
    if (combineId && (recorded.length || test.family))
      platforms = platforms.filter((platform) => recorded.includes(platform));
  }
  return !combineId && appPlatforms.size
    ? platforms.filter((platform) => appPlatforms.has(platform))
    : platforms;
}

function nativeReadiness(device: DeviceSummary | undefined): ProductNativeReadiness {
  if (!device)
    return {
      state: "blocked",
      message: "The saved device is not connected. Connect it and refresh the target list.",
    };
  const projected = projectDevices([device])[0]!;
  if (!projected.runnable)
    return { state: "blocked", message: projected.recovery ?? "Check the device before running." };
  const runtime = device.readiness;
  const proven =
    runtime &&
    [runtime.previewPixels, runtime.semanticControl, runtime.evidenceCapture].every(
      (channel) => channel.state === "proven" && channel.freshness === "current",
    );
  return proven
    ? {
        state: "proven",
        message: "The device observation is current. Relay checks each input when it runs.",
      }
    : { state: "unproven", message: "Device readiness will be checked when you run." };
}

/** Keep the exact saved setup id. Serial/name/viewport never construct an id
 * or establish compatibility; canonical Combine preflight/admission does that. */
function savedNativeProfiles(map: AppMap, combineId?: string) {
  const combine = combineId ? map.combines?.[combineId] : undefined;
  const bound = new Set(
    (combine?.cellRuntimeProfiles ?? [])
      .filter((binding) => combine!.testIds.includes(binding.testId))
      .map((binding) => binding.targetProfileId),
  );
  const platforms = platformsForPlan(map, combineId);
  const profiles = new Map<
    string,
    NonNullable<AppMap["screenVariants"][string]["targetProfile"]>
  >();
  for (const variant of Object.values(map.screenVariants ?? {})) {
    const profile = variant.targetProfile;
    if (
      (profile.platform === "ios" || profile.platform === "android") &&
      platforms.includes(profile.platform) &&
      (!bound.size || bound.has(profile.id))
    ) {
      const existing = profiles.get(profile.id);
      if (
        existing &&
        (existing.targetId !== profile.targetId || existing.platform !== profile.platform)
      )
        throw new TypeError(
          "The saved device setup is ambiguous. Open the Plan’s Test and review its recorded setup.",
        );
      profiles.set(profile.id, profile);
    }
  }
  return [...profiles.values()];
}

export async function discoverPlanEnvironmentProfiles(
  client: Client,
  scope?: ProductEnvironmentScope,
  suppliedMap?: AppMap,
): Promise<readonly ProductEnvironmentProfile[]> {
  const appMap = scope
    ? (suppliedMap ?? (await client.invoke("app-map.get", { appMapId: scope.appMapId })).appMap)
    : undefined;
  const platforms = appMap ? platformsForPlan(appMap, scope?.combineId) : [...PLAN_PLATFORMS];
  const saved = appMap ? savedNativeProfiles(appMap, scope?.combineId) : [];
  const [{ targets }, { builds }, { devices }] = await Promise.all([
    platforms.includes("browser") || !scope
      ? client.invoke("target.list", {})
      : Promise.resolve({ targets: [] }),
    client.invoke("build.list", {}),
    saved.length
      ? client.invoke("target.devices.list", { targetKind: "device" })
      : Promise.resolve({ devices: [] }),
  ]);
  const managed = targets.filter(
    (target) => platforms.includes(target.kind) && (target.kind === "browser" || !saved.length),
  );
  const fixtures = (
    await Promise.all(
      managed
        .filter((target) => target.kind === "browser")
        .map((target) => client.invoke("target.browser-auth.list", { targetId: target.id })),
    )
  ).flatMap((result) => result.fixtures);
  const native: ProductEnvironmentProfile[] = saved.map((profile) => {
    const matching = devices.filter(
      (device) =>
        (device.serial || device.id) === profile.targetId && device.platform === profile.platform,
    );
    const device = matching.length === 1 ? matching[0] : undefined;
    const candidateName = device?.name || profile.name;
    const label =
      candidateName && candidateName !== profile.targetId && candidateName !== profile.id
        ? candidateName
        : profile.platform === "ios"
          ? "iOS device"
          : "Android device";
    return {
      id: profile.id,
      targetProfileId: profile.id,
      name: label,
      targetId: profile.targetId,
      source: { kind: "saved-native-profile", id: profile.id },
      target: { id: profile.targetId, name: label, kind: profile.platform },
      platform: profile.platform,
      nativeReadiness: nativeReadiness(device),
      authenticationOptions: [],
      buildOptions: builds.filter((build) => build.platform === profile.platform).map(projectBuild),
    };
  });
  return [
    ...projectProductEnvironmentProfiles({ targets: managed, builds, fixtures }),
    ...native,
  ].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

/** Browser preflight operates on the managed registry. Native readiness here
 * is passive metadata and never launches, reconnects, captures or acquires control. */
export async function preflightPlanEnvironment(
  client: Client,
  profile: ProductEnvironmentProfile,
): Promise<{ preflight: TargetPreflight }> {
  if (profile.platform === "browser")
    return client.invoke("target.preflight", { targetId: profile.target.id });
  const readiness = profile.nativeReadiness ?? {
    state: "unproven",
    message: "Device readiness will be checked when you run.",
  };
  return {
    preflight: {
      targetId: profile.targetId,
      ok: readiness.state !== "blocked",
      checkedAt: Date.now(),
      capabilities: [],
      checks: [
        {
          id: "native-readiness",
          label: "Device observation",
          status:
            readiness.state === "blocked"
              ? "fail"
              : readiness.state === "proven"
                ? "pass"
                : "warning",
          message: readiness.message,
        },
      ],
    },
  };
}

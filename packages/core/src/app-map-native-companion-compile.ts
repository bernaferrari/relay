import type {
  AppMap,
  AppMapCompiledRuntimeTargetProfile,
  AppMapNativeCompanionCompile,
  AppMapNativeRouteCompanion,
  AppMapScenarioTest,
} from "@relay/protocol";
import { frozenRawAccessibilityTargetProfiles } from "./app-map-test-raw-accessibility.js";
import type { AppMapTestCompileOptions } from "./app-map-test-compiler.js";
import { grokWebNativeRouteCompanions } from "./grok-native-route-companions.js";
import { compileAppMapTest } from "./map-work.js";

export type AppMapTargetProfileErrorCode =
  | "TARGET_PROFILE_NOT_SAVED"
  | "TARGET_PROFILE_AMBIGUOUS"
  | "COMPANION_MAP_MISSING"
  | "COMPANION_TEST_MISSING";

export class AppMapTargetProfileError extends Error {
  constructor(
    readonly code: AppMapTargetProfileErrorCode,
    message: string,
    readonly targetProfileId?: string,
  ) {
    super(message);
    this.name = "AppMapTargetProfileError";
  }
}

export type CompiledAppMapTestForProfile = ReturnType<typeof compileAppMapTest> & {
  nativeCompanion?: AppMapNativeCompanionCompile;
};

export type ResolvedAppMapTestForProfile = {
  map: AppMap;
  test: AppMapScenarioTest;
  runtimeTargetProfile?: AppMapCompiledRuntimeTargetProfile;
  nativeCompanion?: AppMapNativeCompanionCompile;
};

export function nativePlatformProfileAlias(profileId: string): "android" | "ios" | undefined {
  if (profileId === "android" || profileId === "ios") return profileId;
  return undefined;
}

function localRuntimeTargetProfiles(
  map: AppMap,
  targetProfileId: string,
): AppMapCompiledRuntimeTargetProfile[] {
  return frozenRawAccessibilityTargetProfiles(map).filter(
    (profile) => profile.id === targetProfileId,
  );
}

function companionsFor(
  map: AppMap,
  test: AppMapScenarioTest,
): readonly AppMapNativeRouteCompanion[] {
  if (test.nativeRouteCompanions?.length) return test.nativeRouteCompanions;
  if (map.id === "grok-web") return grokWebNativeRouteCompanions(test.id) ?? [];
  return [];
}

function companionForPlatform(
  map: AppMap,
  test: AppMapScenarioTest,
  platform: "android" | "ios",
): AppMapNativeRouteCompanion | undefined {
  return companionsFor(map, test).find((item) => item.platform === platform);
}

function syntheticUnrecordedProfile(
  platform: "android" | "ios",
): AppMapCompiledRuntimeTargetProfile {
  return { id: platform, targetId: platform, platform };
}

function resolveCompanionRuntimeProfile(input: {
  companionMap: AppMap;
  companion: AppMapNativeRouteCompanion;
  requestedProfileId: string;
}): AppMapCompiledRuntimeTargetProfile {
  const profiles = frozenRawAccessibilityTargetProfiles(input.companionMap).filter(
    (profile) => profile.platform === input.companion.platform,
  );
  const alias = nativePlatformProfileAlias(input.requestedProfileId);
  if (alias && alias !== input.companion.platform) {
    throw new AppMapTargetProfileError(
      "TARGET_PROFILE_NOT_SAVED",
      `Target profile ${input.requestedProfileId} is not saved in App Map ${input.companionMap.id}`,
      input.requestedProfileId,
    );
  }
  if (alias === input.companion.platform) {
    if (!profiles.length) {
      throw new AppMapTargetProfileError(
        "TARGET_PROFILE_NOT_SAVED",
        `Target profile ${input.requestedProfileId} is not saved in App Map ${input.companionMap.id}. Capture a screen on this target first.`,
        input.requestedProfileId,
      );
    }
    const targetIds = new Set(profiles.map((profile) => profile.targetId));
    if (profiles.length === 1 || targetIds.size === 1) {
      return structuredClone(profiles[0]!);
    }
    throw new AppMapTargetProfileError(
      "TARGET_PROFILE_AMBIGUOUS",
      `Target profile ${input.requestedProfileId} is ambiguous on App Map ${input.companionMap.id}: ${profiles
        .map((profile) => profile.id)
        .sort()
        .join(", ")}. Bind an explicit targetProfileId.`,
      input.requestedProfileId,
    );
  }
  const matches = profiles.filter((profile) => profile.id === input.requestedProfileId);
  if (matches.length === 1) return structuredClone(matches[0]!);
  if (matches.length > 1) {
    throw new AppMapTargetProfileError(
      "TARGET_PROFILE_AMBIGUOUS",
      `Target profile ${input.requestedProfileId} has conflicting identities`,
      input.requestedProfileId,
    );
  }
  throw new AppMapTargetProfileError(
    "TARGET_PROFILE_NOT_SAVED",
    `Target profile ${input.requestedProfileId} is not saved in App Map ${input.companionMap.id}`,
    input.requestedProfileId,
  );
}

async function loadCompanionMap(
  readAppMap: (appMapId: string) => Promise<AppMap | null>,
  companion: AppMapNativeRouteCompanion,
): Promise<AppMap> {
  const companionMap = await readAppMap(companion.appMapId);
  if (!companionMap) {
    throw new AppMapTargetProfileError(
      "COMPANION_MAP_MISSING",
      `Companion App Map ${companion.appMapId} is not saved`,
    );
  }
  return companionMap;
}

function companionTest(map: AppMap, companion: AppMapNativeRouteCompanion): AppMapScenarioTest {
  const test = map.tests[companion.testId];
  if (!test) {
    throw new AppMapTargetProfileError(
      "COMPANION_TEST_MISSING",
      `Companion Test ${companion.testId} is not on App Map ${map.id}`,
    );
  }
  return test;
}

async function compileOptionsFor(
  subject: { map: AppMap; test: AppMapScenarioTest },
  compileOptions:
    | Omit<AppMapTestCompileOptions, "runtimeTargetProfile">
    | ((subject: {
        map: AppMap;
        test: AppMapScenarioTest;
      }) =>
        | Omit<AppMapTestCompileOptions, "runtimeTargetProfile">
        | Promise<Omit<AppMapTestCompileOptions, "runtimeTargetProfile">>)
    | undefined,
): Promise<Omit<AppMapTestCompileOptions, "runtimeTargetProfile">> {
  if (!compileOptions) return {};
  return typeof compileOptions === "function" ? await compileOptions(subject) : compileOptions;
}

/** Resolve a Test against a saved profile, a native platform alias (`ios` /
 * `android`), or a linked companion Test on grok-ios / grok-android.
 * Compile still disables unrecorded aliases; run refuses them. */
export async function resolveAppMapTestForTargetProfile(input: {
  map: AppMap;
  test: AppMapScenarioTest;
  targetProfileId?: string;
  readAppMap: (appMapId: string) => Promise<AppMap | null>;
}): Promise<ResolvedAppMapTestForProfile> {
  const targetProfileId = input.targetProfileId?.trim() || undefined;
  if (!targetProfileId) return { map: input.map, test: input.test };

  const local = localRuntimeTargetProfiles(input.map, targetProfileId);
  if (local.length > 1) {
    throw new AppMapTargetProfileError(
      "TARGET_PROFILE_AMBIGUOUS",
      `Target profile ${targetProfileId} has conflicting identities`,
      targetProfileId,
    );
  }
  if (local.length === 1) {
    return { map: input.map, test: input.test, runtimeTargetProfile: local[0] };
  }

  const alias = nativePlatformProfileAlias(targetProfileId);
  if (alias) {
    const companion = companionForPlatform(input.map, input.test, alias);
    if (!companion) {
      return {
        map: input.map,
        test: input.test,
        runtimeTargetProfile: syntheticUnrecordedProfile(alias),
      };
    }
    const companionMap = await loadCompanionMap(input.readAppMap, companion);
    return {
      map: companionMap,
      test: companionTest(companionMap, companion),
      runtimeTargetProfile: resolveCompanionRuntimeProfile({
        companionMap,
        companion,
        requestedProfileId: targetProfileId,
      }),
      nativeCompanion: {
        platform: companion.platform,
        appMapId: companion.appMapId,
        testId: companion.testId,
        requestedFrom: { appMapId: input.map.id, testId: input.test.id },
      },
    };
  }

  const companions = companionsFor(input.map, input.test);
  if (!companions.length) {
    throw new AppMapTargetProfileError(
      "TARGET_PROFILE_NOT_SAVED",
      `Target profile ${targetProfileId} is not saved in this App Map`,
      targetProfileId,
    );
  }

  const matches: Array<{
    companion: AppMapNativeRouteCompanion;
    companionMap: AppMap;
    profile: AppMapCompiledRuntimeTargetProfile;
  }> = [];
  for (const companion of companions) {
    const companionMap = await input.readAppMap(companion.appMapId);
    if (!companionMap) continue;
    try {
      matches.push({
        companion,
        companionMap,
        profile: resolveCompanionRuntimeProfile({
          companionMap,
          companion,
          requestedProfileId: targetProfileId,
        }),
      });
    } catch (error) {
      if (error instanceof AppMapTargetProfileError && error.code === "TARGET_PROFILE_NOT_SAVED") {
        continue;
      }
      throw error;
    }
  }
  if (matches.length === 1) {
    const match = matches[0]!;
    return {
      map: match.companionMap,
      test: companionTest(match.companionMap, match.companion),
      runtimeTargetProfile: match.profile,
      nativeCompanion: {
        platform: match.companion.platform,
        appMapId: match.companion.appMapId,
        testId: match.companion.testId,
        requestedFrom: { appMapId: input.map.id, testId: input.test.id },
      },
    };
  }
  if (matches.length > 1) {
    throw new AppMapTargetProfileError(
      "TARGET_PROFILE_AMBIGUOUS",
      `Target profile ${targetProfileId} has conflicting identities`,
      targetProfileId,
    );
  }
  throw new AppMapTargetProfileError(
    "TARGET_PROFILE_NOT_SAVED",
    `Target profile ${targetProfileId} is not saved in this App Map`,
    targetProfileId,
  );
}

/** Compile a Test against a saved profile, a native platform alias (`ios` /
 * `android`), or a linked companion Test on grok-ios / grok-android.
 * Companions are live compiles of the other map — not disabled Web steps. */
export async function compileAppMapTestForTargetProfile(input: {
  map: AppMap;
  test: AppMapScenarioTest;
  targetProfileId?: string;
  readAppMap: (appMapId: string) => Promise<AppMap | null>;
  compileOptions?:
    | Omit<AppMapTestCompileOptions, "runtimeTargetProfile">
    | ((subject: {
        map: AppMap;
        test: AppMapScenarioTest;
      }) =>
        | Omit<AppMapTestCompileOptions, "runtimeTargetProfile">
        | Promise<Omit<AppMapTestCompileOptions, "runtimeTargetProfile">>);
}): Promise<CompiledAppMapTestForProfile> {
  const resolved = await resolveAppMapTestForTargetProfile(input);
  const options = await compileOptionsFor(
    { map: resolved.map, test: resolved.test },
    input.compileOptions,
  );
  const compiled = compileAppMapTest(resolved.map, resolved.test, {
    ...options,
    ...(resolved.runtimeTargetProfile
      ? { runtimeTargetProfile: resolved.runtimeTargetProfile }
      : {}),
  });
  return resolved.nativeCompanion
    ? { ...compiled, nativeCompanion: resolved.nativeCompanion }
    : compiled;
}

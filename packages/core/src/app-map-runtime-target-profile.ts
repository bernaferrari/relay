import {
  parseBrowserCaseProfile,
  type AppMapCompiledRuntimeTargetProfile,
  type TargetProfile,
} from "@relay/protocol";

type SavedTargetProfile = Pick<
  TargetProfile,
  "id" | "targetId" | "platform" | "androidAvdName" | "viewport" | "browserCaseProfile"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validViewport(value: unknown): value is { width: number; height: number } {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === "width" || key === "height") &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.height > 0
  );
}

function sameViewport(
  left: { width: number; height: number } | undefined,
  right: { width: number; height: number } | undefined,
): boolean {
  return (
    (left === undefined && right === undefined) ||
    (left !== undefined &&
      right !== undefined &&
      left.width === right.width &&
      left.height === right.height)
  );
}

/** Project one saved profile into the complete immutable identity used by a
 * compiled App Map execution. Conflicting duplicated viewport facts fail
 * rather than being silently reconciled. */
export function appMapRuntimeTargetProfileFromSaved(
  profile: SavedTargetProfile,
): AppMapCompiledRuntimeTargetProfile {
  const browserCaseProfile = profile.browserCaseProfile
    ? parseBrowserCaseProfile(profile.browserCaseProfile)
    : undefined;
  if (browserCaseProfile && profile.platform !== "browser") {
    throw new Error("A browser case profile can only belong to a browser runtime profile");
  }
  if (profile.androidAvdName && profile.platform !== "android") {
    throw new Error("An Android AVD name can only belong to an Android runtime profile");
  }
  if (
    browserCaseProfile &&
    profile.viewport &&
    !sameViewport(profile.viewport, browserCaseProfile.viewport)
  ) {
    throw new Error("Saved target viewport conflicts with its frozen browser case profile");
  }
  const viewport = browserCaseProfile?.viewport ?? profile.viewport;
  return {
    id: profile.id,
    targetId: profile.targetId,
    platform: profile.platform,
    ...(profile.androidAvdName ? { androidAvdName: profile.androidAvdName } : {}),
    ...(viewport ? { viewport: structuredClone(viewport) } : {}),
    ...(browserCaseProfile ? { browserCaseProfile } : {}),
  };
}

/** Parse the strict persisted representation while accepting historical
 * mobile profiles and historical browser profiles only long enough for their
 * callers to produce an explicit review-required result. */
export function parseAppMapRuntimeTargetProfile(
  value: unknown,
): AppMapCompiledRuntimeTargetProfile | undefined {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((key) =>
      ["id", "targetId", "platform", "androidAvdName", "viewport", "browserCaseProfile"].includes(
        key,
      ),
    ) ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.targetId !== "string" ||
    !value.targetId.trim() ||
    (value.platform !== "android" && value.platform !== "ios" && value.platform !== "browser") ||
    (value.androidAvdName !== undefined &&
      (typeof value.androidAvdName !== "string" || !value.androidAvdName.trim())) ||
    (value.viewport !== undefined && !validViewport(value.viewport))
  ) {
    return undefined;
  }
  let browserCaseProfile;
  try {
    browserCaseProfile =
      value.browserCaseProfile === undefined
        ? undefined
        : parseBrowserCaseProfile(value.browserCaseProfile);
  } catch {
    return undefined;
  }
  if (browserCaseProfile && value.platform !== "browser") return undefined;
  if (value.androidAvdName !== undefined && value.platform !== "android") return undefined;
  if (
    browserCaseProfile &&
    value.viewport !== undefined &&
    !sameViewport(value.viewport, browserCaseProfile.viewport)
  ) {
    return undefined;
  }
  return appMapRuntimeTargetProfileFromSaved({
    id: value.id,
    targetId: value.targetId,
    platform: value.platform,
    ...(value.androidAvdName === undefined ? {} : { androidAvdName: value.androidAvdName }),
    ...(value.viewport === undefined ? {} : { viewport: value.viewport }),
    ...(browserCaseProfile ? { browserCaseProfile } : {}),
  });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

export function appMapRuntimeTargetProfileKey(profile: AppMapCompiledRuntimeTargetProfile): string {
  return JSON.stringify(canonical(appMapRuntimeTargetProfileFromSaved(profile)));
}

export function sameAppMapRuntimeTargetProfile(
  left: AppMapCompiledRuntimeTargetProfile,
  right: AppMapCompiledRuntimeTargetProfile,
): boolean {
  return appMapRuntimeTargetProfileKey(left) === appMapRuntimeTargetProfileKey(right);
}

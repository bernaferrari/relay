import type { AppMapCompiledRuntimeTargetProfile } from "@relay/protocol";

export function unrecordedNativeRuntimeProfileId(target: {
  targetId: string;
  platform: "android" | "ios";
}): string {
  return `unrecorded:${target.platform}:${target.targetId}`;
}

/** Synthetic id for Android/iOS columns that have no saved App Map surface. */
export function unrecordedNativeRuntimeProfileIdIfMissing(input: {
  savedIds: readonly string[];
  platform: string;
  targetId: string;
}): string | undefined {
  if (input.savedIds.length) return undefined;
  if (input.platform !== "android" && input.platform !== "ios") return undefined;
  return unrecordedNativeRuntimeProfileId({
    targetId: input.targetId,
    platform: input.platform,
  });
}

export function parseUnrecordedNativeRuntimeProfile(
  profileId: string,
  target: { targetId: string; platform: string },
): AppMapCompiledRuntimeTargetProfile | undefined {
  if (target.platform !== "android" && target.platform !== "ios") return undefined;
  const expected = unrecordedNativeRuntimeProfileId({
    targetId: target.targetId,
    platform: target.platform,
  });
  if (profileId !== expected) return undefined;
  return {
    id: profileId,
    targetId: target.targetId,
    platform: target.platform,
  };
}

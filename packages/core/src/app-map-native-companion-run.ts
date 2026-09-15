import type {
  AppMapCompiledRuntimeTargetProfile,
  AppMapNativeCompanionCompile,
  AuthoringTarget,
} from "@relay/protocol";
import {
  AppMapTargetProfileError,
  nativePlatformProfileAlias,
} from "./app-map-native-companion-compile.js";

/** Companion runs control the saved native device, not the grok-web browser. */
export function companionExecutionTarget(input: {
  requested: AuthoringTarget;
  profile?: AppMapCompiledRuntimeTargetProfile;
  nativeCompanion?: AppMapNativeCompanionCompile;
}): AuthoringTarget {
  if (!input.nativeCompanion || !input.profile) return input.requested;
  const platform = input.profile.platform;
  if (platform === "browser") {
    return { kind: "browser", platform: "browser", targetId: input.profile.targetId };
  }
  return { kind: "device", platform, targetId: input.profile.targetId };
}

/** Compile may disable an unrecorded alias. Run must not invent that route. */
export function assertRecordedCompanionForRun(input: {
  testId: string;
  targetProfileId?: string;
  nativeCompanion?: AppMapNativeCompanionCompile;
}): void {
  const alias = input.targetProfileId
    ? nativePlatformProfileAlias(input.targetProfileId)
    : undefined;
  if (!alias || input.nativeCompanion) return;
  throw new AppMapTargetProfileError(
    "COMPANION_TEST_MISSING",
    `No recorded ${alias} companion for ${input.testId}. Do not invent Grok Settings navigation.`,
    alias,
  );
}

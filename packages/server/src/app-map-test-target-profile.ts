import type {
  AppMap,
  AppMapCompiledRuntimeTargetProfile,
  OperationInput,
  TargetProfile,
} from "@relay/protocol";
import { HttpError } from "./http.js";

/** Resolve a run's profile from the saved App Map before it can touch a
 * target. A profile ID is an evidence identity, not a display-label hint: all
 * matching saved copies must bind to this exact target/platform. */
export function frozenTestRunTargetProfile(input: {
  map: AppMap;
  targetProfileId: string;
  target: Pick<OperationInput<"app-map.test.run">["target"], "targetId" | "platform">;
}): AppMapCompiledRuntimeTargetProfile {
  const targetProfileId = input.targetProfileId.trim();
  const profiles = Object.values(input.map.screenVariants)
    .map((variant) => variant.targetProfile)
    .filter((profile) => profile.id === targetProfileId);
  if (!profiles.length) {
    throw new HttpError(409, `Target profile ${targetProfileId} is not saved in this App Map`, {
      code: "TARGET_PROFILE_NOT_SAVED",
      targetProfileId,
      recovery:
        "Choose a saved evidence profile for this App Map before running the Test on a target.",
    });
  }
  const mismatched = profiles.filter(
    (profile) =>
      profile.targetId !== input.target.targetId || profile.platform !== input.target.platform,
  );
  if (mismatched.length) {
    const candidates = [
      ...new Set(profiles.map((profile) => `${profile.platform}:${profile.targetId}`)),
    ]
      .sort()
      .join(", ");
    throw new HttpError(
      409,
      `Target profile ${targetProfileId} does not bind to ${input.target.platform}:${input.target.targetId}`,
      {
        code: "TARGET_PROFILE_TARGET_MISMATCH",
        targetProfileId,
        target: { targetId: input.target.targetId, platform: input.target.platform },
        savedTargets: candidates,
        recovery:
          "Choose the target recorded by this evidence profile, or choose a profile captured for the selected target.",
      },
    );
  }
  const identity = (profile: (typeof profiles)[number]) =>
    [
      profile.id,
      profile.targetId,
      profile.platform,
      profile.viewport ? `${profile.viewport.width}x${profile.viewport.height}` : "",
    ].join("\u0000");
  if (new Set(profiles.map(identity)).size !== 1) {
    throw new HttpError(409, `Target profile ${targetProfileId} has conflicting saved identities`, {
      code: "TARGET_PROFILE_AMBIGUOUS",
      targetProfileId,
      recovery:
        "Repair or recapture the conflicting saved evidence profile before using it to scope a Test run.",
    });
  }
  const profile = profiles[0]!;
  return {
    id: profile.id,
    targetId: profile.targetId,
    platform: profile.platform,
    ...(profile.viewport ? { viewport: structuredClone(profile.viewport) } : {}),
  };
}

/** The job must carry the exact saved evidence-profile identity, not the
 * generic profile reconstructed from a connected device. In particular a
 * viewport-suffixed Android profile is a distinct frozen-origin namespace. */
export function queuedAppMapTestTargetProfile(input: {
  runtimeTargetProfile: AppMapCompiledRuntimeTargetProfile | undefined;
  observedTargetProfile: TargetProfile | undefined;
  target: Pick<OperationInput<"app-map.test.run">["target"], "kind" | "targetId" | "platform">;
}): TargetProfile | undefined {
  const saved = input.runtimeTargetProfile;
  if (!saved) return input.observedTargetProfile;
  if (saved.targetId !== input.target.targetId || saved.platform !== input.target.platform) {
    throw new HttpError(
      409,
      `Saved runtime profile ${saved.id} does not bind to ${input.target.platform}:${input.target.targetId}`,
      {
        code: "TARGET_PROFILE_TARGET_MISMATCH",
        targetProfileId: saved.id,
        target: { targetId: input.target.targetId, platform: input.target.platform },
      },
    );
  }
  const observed = input.observedTargetProfile;
  if (observed && (observed.targetId !== saved.targetId || observed.platform !== saved.platform)) {
    throw new HttpError(
      409,
      `Observed target profile does not match saved runtime profile ${saved.id}`,
      {
        code: "TARGET_PROFILE_TARGET_MISMATCH",
        targetProfileId: saved.id,
        observedTarget: { targetId: observed.targetId, platform: observed.platform },
      },
    );
  }
  return {
    id: saved.id,
    targetId: saved.targetId,
    platform: saved.platform,
    source: input.target.kind,
    name: observed?.name ?? saved.targetId,
    ...(observed?.model ? { model: observed.model } : {}),
    ...(observed?.osVersion ? { osVersion: observed.osVersion } : {}),
    ...(saved.viewport ? { viewport: structuredClone(saved.viewport) } : {}),
    capabilities: observed ? [...observed.capabilities] : [],
    observedAt: observed?.observedAt ?? Date.now(),
  };
}

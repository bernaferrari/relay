import type {
  AppMap,
  AppMapCompiledRuntimeTargetProfile,
  OperationInput,
  TargetProfile,
} from "@relay/protocol";
import {
  appMapRuntimeTargetProfileFromSaved,
  appMapRuntimeTargetProfileKey,
  sameAppMapRuntimeTargetProfileIgnoringAccount,
  unsupportedBrowserCaseProfileFields,
} from "@relay/core";
import { HttpError } from "./http.js";

/** Resolve a run's profile from the saved App Map before it can touch a
 * target. A profile ID is an evidence identity, not a display-label hint: all
 * matching saved copies must bind to this exact target/platform. */
export function frozenTestRunTargetProfile(input: {
  map: AppMap;
  targetProfileId: string;
  target: Pick<NonNullable<OperationInput<"app-map.test.run">["target"]>, "targetId" | "platform">;
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
    appMapRuntimeTargetProfileKey(appMapRuntimeTargetProfileFromSaved(profile));
  if (new Set(profiles.map(identity)).size !== 1) {
    throw new HttpError(409, `Target profile ${targetProfileId} has conflicting saved identities`, {
      code: "TARGET_PROFILE_AMBIGUOUS",
      targetProfileId,
      recovery:
        "Repair or recapture the conflicting saved evidence profile before using it to scope a Test run.",
    });
  }
  const frozen = appMapRuntimeTargetProfileFromSaved(profiles[0]!);
  if (frozen.platform === "browser" && !frozen.browserCaseProfile) {
    throw new HttpError(
      409,
      `Saved runtime profile ${frozen.id} has no frozen browser environment`,
      {
        code: "FROZEN_BROWSER_PROFILE_REQUIRED",
        targetProfileId: frozen.id,
        recovery:
          "Recapture this browser target profile and compile the Test again before controlling the browser.",
      },
    );
  }
  return frozen;
}

/** The job must carry the exact saved evidence-profile identity, not the
 * generic profile reconstructed from a connected device. In particular a
 * viewport-suffixed Android profile is a distinct frozen-origin namespace. */
export function queuedAppMapTestTargetProfile(input: {
  runtimeTargetProfile: AppMapCompiledRuntimeTargetProfile | undefined;
  observedTargetProfile: TargetProfile | undefined;
  target: Pick<
    NonNullable<OperationInput<"app-map.test.run">["target"]>,
    "kind" | "targetId" | "platform"
  >;
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
  if (saved.androidAvdName && observed?.androidAvdName !== saved.androidAvdName) {
    throw new HttpError(
      409,
      `Android emulator ${saved.targetId} no longer matches frozen AVD ${saved.androidAvdName}`,
      {
        code: "TARGET_PROFILE_TARGET_MISMATCH",
        targetProfileId: saved.id,
        recovery:
          "Boot and select the exact saved Android AVD, or capture and review a profile for the current emulator.",
      },
    );
  }
  if (
    saved.platform !== "browser" &&
    ((saved.model !== undefined && saved.model !== "device" && observed?.model !== saved.model) ||
      (saved.osVersion !== undefined && observed?.osVersion !== saved.osVersion) ||
      (saved.viewport !== undefined &&
        observed?.viewport !== undefined &&
        (saved.viewport.width !== observed.viewport.width ||
          saved.viewport.height !== observed.viewport.height)) ||
      (saved.capabilities !== undefined &&
        saved.capabilities.some((capability) => !observed?.capabilities.includes(capability))))
  ) {
    throw new HttpError(
      409,
      `Managed device ${saved.targetId} no longer matches frozen profile ${saved.id}`,
      {
        code: "TARGET_PROFILE_TARGET_MISMATCH",
        targetProfileId: saved.id,
        recovery:
          "Restore the saved device runtime, or capture and review a profile for the current OS and capabilities.",
      },
    );
  }
  const savedBrowser = saved.browserCaseProfile;
  if (saved.platform === "browser" && !savedBrowser) {
    throw new HttpError(
      409,
      `Saved runtime profile ${saved.id} has no frozen browser environment`,
      {
        code: "FROZEN_BROWSER_PROFILE_REQUIRED",
        targetProfileId: saved.id,
        recovery:
          "Recapture this browser target profile and compile the Test again before controlling the browser.",
      },
    );
  }
  if (saved.platform === "browser") {
    const frozenBrowser = savedBrowser!;
    const unsupported = unsupportedBrowserCaseProfileFields(frozenBrowser);
    if (unsupported.length) {
      throw new HttpError(
        409,
        `Saved browser profile ${saved.id} requires unavailable host resolvers: ${unsupported.join(", ")}`,
        {
          code: "BROWSER_PROFILE_UNSUPPORTED",
          targetProfileId: saved.id,
          unsupported,
          recovery:
            "Remove unsupported fixture references or install their host resolvers before running this Test.",
        },
      );
    }
    const observedBrowser = observed?.browserCaseProfile;
    if (!observedBrowser) {
      throw new HttpError(409, `Managed browser target ${saved.targetId} is unavailable`, {
        code: "TARGET_PROFILE_TARGET_MISMATCH",
        targetProfileId: saved.id,
        recovery: "Restore the saved managed browser target before running this Test.",
      });
    }
    const observedRuntimeProfile: AppMapCompiledRuntimeTargetProfile = {
      id: saved.id,
      targetId: observed!.targetId,
      platform: "browser",
      viewport: structuredClone(observedBrowser.viewport),
      browserCaseProfile: structuredClone(observedBrowser),
    };
    if (!sameAppMapRuntimeTargetProfileIgnoringAccount(saved, observedRuntimeProfile)) {
      throw new HttpError(
        409,
        `Managed browser target ${saved.targetId} no longer matches frozen profile ${saved.id}`,
        {
          code: "TARGET_PROFILE_TARGET_MISMATCH",
          targetProfileId: saved.id,
          recovery:
            "Restore the complete saved browser environment, or capture and review a profile for the current environment.",
        },
      );
    }
  }
  return {
    id: saved.id,
    targetId: saved.targetId,
    platform: saved.platform,
    source: input.target.kind,
    name: observed?.name ?? saved.targetId,
    ...(saved.model ? { model: saved.model } : {}),
    // Older saved Android profiles predate AVD identity. Preserve the fresh
    // observed identity in the queued job so emulator evidence collectors can
    // still select the exact AVD without weakening the frozen-profile guards.
    ...(saved.androidAvdName
      ? { androidAvdName: saved.androidAvdName }
      : observed?.androidAvdName
        ? { observedAndroidAvdName: observed.androidAvdName }
        : {}),
    ...(saved.osVersion ? { osVersion: saved.osVersion } : {}),
    ...(saved.viewport ? { viewport: structuredClone(saved.viewport) } : {}),
    ...(saved.browserCaseProfile
      ? { browserCaseProfile: structuredClone(saved.browserCaseProfile) }
      : {}),
    capabilities: saved.capabilities
      ? [...saved.capabilities]
      : observed
        ? [...observed.capabilities]
        : [],
    observedAt: observed?.observedAt ?? Date.now(),
  };
}

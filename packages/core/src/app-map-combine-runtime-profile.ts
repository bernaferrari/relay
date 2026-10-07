import type {
  AppMap,
  AppMapCombineCellState,
  AppMapCombinePreflightIssue,
  AppMapCompiledRuntimeTargetProfile,
} from "@relay/protocol";
import {
  appMapRuntimeTargetProfileFromSaved,
  appMapRuntimeTargetProfileKey,
} from "./app-map-runtime-target-profile.js";
import { parseUnrecordedNativeRuntimeProfile } from "./app-map-unrecorded-runtime-profile.js";

function issue(
  code: AppMapCombinePreflightIssue["code"],
  message: string,
  extra: Partial<AppMapCombinePreflightIssue> = {},
): AppMapCombinePreflightIssue {
  return { code, message, ...extra };
}

export class AppMapCombineCellContractError extends Error {
  readonly code = "APP_MAP_COMBINE_CELL_CONTRACT";
  constructor(
    message: string,
    readonly issues: AppMapCombinePreflightIssue[],
    readonly cells: AppMapCombineCellState[],
  ) {
    super(message);
    this.name = "AppMapCombineCellContractError";
  }
}

/** Deduped saved runtime-profile ids that bind to one concrete target, in
 * stable message order. These are the only ids a failed binding can accept,
 * so every recovery message lists them instead of hiding them in raw map data. */
export function savedAppMapTargetProfileIdsForTarget(
  map: AppMap,
  target: { targetId: string; platform: string },
): string[] {
  const ids = new Set(
    Object.values(map.screenVariants ?? {})
      .map((variant) => variant.targetProfile)
      .filter(
        (profile) =>
          profile.id &&
          profile.targetId === target.targetId &&
          profile.platform === target.platform,
      )
      .map((profile) => profile.id),
  );
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export function targetProfileLabel(target: { targetId: string; platform: string }): string {
  return `${target.platform}:${target.targetId}`;
}

export function unresolvedTargetProfileMessage(
  target: { targetId: string; platform: string },
  candidates: string[],
): string {
  return candidates.length
    ? `Multiple saved runtime profiles bind to ${targetProfileLabel(target)}: ${candidates.join(", ")}. Bind an explicit targetProfileId.`
    : `No saved runtime profile for target ${targetProfileLabel(target)} — capture a screen on this target first.`;
}

function savedTargetProfileHint(
  map: AppMap,
  target: { targetId: string; platform: string },
): string {
  const candidates = savedAppMapTargetProfileIdsForTarget(map, target);
  return candidates.length
    ? ` Saved runtime profiles for ${targetProfileLabel(target)}: ${candidates.join(", ")}.`
    : ` No saved runtime profile for target ${targetProfileLabel(target)} — capture a screen on this target first.`;
}

export function resolveSavedAppMapRuntimeTargetProfile(input: {
  map: AppMap;
  /** Explicit saved profile id. When omitted or blank, the single saved
   * profile that binds to `target` is inherited; ambiguity stays an error. */
  targetProfileId?: string;
  target: { targetId: string; platform: "android" | "ios" | "browser" };
}): AppMapCompiledRuntimeTargetProfile {
  const targetProfileId = input.targetProfileId?.trim() ?? "";
  const unrecorded = parseUnrecordedNativeRuntimeProfile(targetProfileId, input.target);
  if (unrecorded) return unrecorded;
  if (!targetProfileId) {
    const candidates = savedAppMapTargetProfileIdsForTarget(input.map, input.target);
    if (candidates.length !== 1) {
      const message = unresolvedTargetProfileMessage(input.target, candidates);
      throw new AppMapCombineCellContractError(message, [issue("missing-binding", message)], []);
    }
    return resolveSavedAppMapRuntimeTargetProfile({
      map: input.map,
      targetProfileId: candidates[0]!,
      target: input.target,
    });
  }
  const profiles = Object.values(input.map.screenVariants)
    .map((variant) => variant.targetProfile)
    .filter((profile) => profile.id === targetProfileId);
  if (!profiles.length) {
    const message = `Target profile ${targetProfileId} is not saved in this App Map.${savedTargetProfileHint(input.map, input.target)}`;
    throw new AppMapCombineCellContractError(
      message,
      [
        issue("mismatched-binding", message, {
          targetProfileId,
        }),
      ],
      [],
    );
  }
  const mismatched = profiles.filter(
    (profile) =>
      profile.targetId !== input.target.targetId || profile.platform !== input.target.platform,
  );
  if (mismatched.length) {
    const message = `Target profile ${targetProfileId} does not bind to ${input.target.platform}:${input.target.targetId}.${savedTargetProfileHint(input.map, input.target)}`;
    throw new AppMapCombineCellContractError(
      message,
      [
        issue("mismatched-binding", message, {
          targetProfileId,
        }),
      ],
      [],
    );
  }
  const identity = (profile: (typeof profiles)[number]) =>
    appMapRuntimeTargetProfileKey(appMapRuntimeTargetProfileFromSaved(profile));
  if (new Set(profiles.map(identity)).size !== 1) {
    throw new AppMapCombineCellContractError(
      `Target profile ${targetProfileId} has conflicting saved identities`,
      [
        issue(
          "mismatched-binding",
          `Target profile ${targetProfileId} has conflicting saved identities`,
          {
            targetProfileId,
          },
        ),
      ],
      [],
    );
  }
  const frozen = appMapRuntimeTargetProfileFromSaved(profiles[0]!);
  if (frozen.platform === "browser" && !frozen.browserCaseProfile) {
    const message = `Saved runtime profile ${frozen.id} has no frozen browser environment`;
    throw new AppMapCombineCellContractError(
      message,
      [
        issue("mismatched-binding", message, {
          targetProfileId: frozen.id,
        }),
      ],
      [],
    );
  }
  return frozen;
}

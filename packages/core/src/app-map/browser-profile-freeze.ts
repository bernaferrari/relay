import type { TargetProfile } from "@relay/protocol";
import type { AppMap, AppMapMutationContext } from "./model.js";
import { appMapFail } from "./errors.js";
import { mutateAppMap } from "./mutation.js";

/** Attach a frozen browser environment onto variants that were saved without
 * one. Identity ids stay as recorded so inference still matches `browser:id`. */
export function freezeMissingBrowserCaseProfiles(
  map: AppMap,
  frozen: TargetProfile,
  context: AppMapMutationContext,
): AppMap {
  if (frozen.platform !== "browser" || frozen.source !== "browser" || !frozen.browserCaseProfile) {
    appMapFail("invalid-map", "A complete frozen browser case profile is required");
  }
  const missing = Object.values(map.screenVariants).filter(
    (variant) =>
      variant.targetProfile.platform === "browser" &&
      variant.targetProfile.targetId === frozen.targetId &&
      !variant.targetProfile.browserCaseProfile,
  );
  if (!missing.length) return map;
  return mutateAppMap(
    map,
    context,
    {
      eventType: "app-map.updated",
      subject: { kind: "app-map", id: map.id },
      summary: "Froze the browser environment on captured screens",
    },
    (draft) => {
      for (const variant of Object.values(draft.screenVariants)) {
        if (
          variant.targetProfile.platform !== "browser" ||
          variant.targetProfile.targetId !== frozen.targetId ||
          variant.targetProfile.browserCaseProfile
        ) {
          continue;
        }
        variant.targetProfile = {
          ...variant.targetProfile,
          viewport: structuredClone(frozen.browserCaseProfile!.viewport),
          browserCaseProfile: structuredClone(frozen.browserCaseProfile),
          observedAt: context.at,
        };
        variant.updatedAt = context.at;
      }
    },
  );
}

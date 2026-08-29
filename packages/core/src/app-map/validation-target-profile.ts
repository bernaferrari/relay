import { browserCaseProfileSchema, type TargetProfile } from "@relay/protocol";

/** Validate the duplicated browser-only portion of a saved target profile.
 * Absence remains readable for legacy-map diagnosis; execution admission
 * separately requires a complete profile before control. */
export function browserTargetProfileProblem(profile: TargetProfile): string | undefined {
  if (profile.browserCaseProfile === undefined) return undefined;
  const parsed = browserCaseProfileSchema.safeParse(profile.browserCaseProfile);
  if (!parsed.success) return "browserCaseProfile is invalid";
  if (profile.source !== "browser" || profile.platform !== "browser") {
    return "browserCaseProfile requires a browser target";
  }
  if (
    profile.viewport &&
    (profile.viewport.width !== parsed.data.viewport.width ||
      profile.viewport.height !== parsed.data.viewport.height)
  ) {
    return "viewport conflicts with browserCaseProfile.viewport";
  }
  return undefined;
}

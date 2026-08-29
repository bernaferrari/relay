import type { BrowserCaseProfile } from "@relay/protocol";

/**
 * Environment fields whose resolvers have not landed yet must fail before a
 * browser starts. Retaining them in the protocol lets fixtures remain part of
 * the frozen case identity without silently ignoring a requested fixture.
 */
export function unsupportedBrowserCaseProfileFields(
  profile: BrowserCaseProfile,
): readonly string[] {
  return [
    ...(profile.revision ? ["revision"] : []),
    ...(profile.authenticationFixtureId ? ["authenticationFixtureId"] : []),
    ...(profile.featureFlagFixtureId ? ["featureFlagFixtureId"] : []),
    ...(profile.networkProfile ? ["networkProfile"] : []),
  ];
}

export function assertSupportedBrowserCaseProfile(profile: BrowserCaseProfile): void {
  const unsupported = unsupportedBrowserCaseProfileFields(profile);
  if (unsupported.length === 0) return;
  throw new Error(
    `browser case profile requires unavailable host resolvers: ${unsupported.join(", ")}`,
  );
}

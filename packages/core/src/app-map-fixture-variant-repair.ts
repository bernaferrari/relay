import type { AppMap, TargetProfile } from "@relay/protocol";
import { overlayHonestBrowserTargetProfile } from "./app-map-run-history.js";
import { managedBrowserTargetProfileId } from "./browser-case-profile-target.js";

export type FixtureVariantProfileRepair = {
  readonly variantId: string;
  readonly screenId: string;
  readonly fromProfileId: string;
  readonly toProfileId: string;
};

/**
 * A variant that carries an authentication fixture under an unsigned saved
 * profile id is the recorded-shape bug that blocks fixture Lanes: the unsigned
 * id makes lane validation treat the fixture as persisted onto the saved
 * environment (LANE_FIXTURE_PERSIST_ERROR), while runtime matching can never
 * reconcile a fixture-bound replay against the unsigned current environment.
 * The honest identity for a fixture-bound variant is the overlay-honest id
 * derived from its own frozen environment.
 */
export function fixtureVariantsUnderUnsignedProfileIds(
  appMap: Pick<AppMap, "screenVariants">,
): FixtureVariantProfileRepair[] {
  const repairs: FixtureVariantProfileRepair[] = [];
  for (const [variantId, variant] of Object.entries(appMap.screenVariants ?? {})) {
    const profile = variant.targetProfile;
    if (!carriesFixtureUnderUnsignedId(profile)) continue;
    if (profile.id === overlayHonestBrowserTargetProfile(profile).id) continue;
    repairs.push({
      variantId,
      screenId: variant.screenId,
      fromProfileId: profile.id,
      toProfileId: overlayHonestBrowserTargetProfile(profile).id,
    });
  }
  return repairs;
}

export function repairFixtureVariantProfileIds(appMap: AppMap): {
  appMap: AppMap;
  repairs: readonly FixtureVariantProfileRepair[];
} {
  const planned = fixtureVariantsUnderUnsignedProfileIds(appMap);
  if (!planned.length) return { appMap, repairs: [] };
  const byVariantId = new Map(planned.map((repair) => [repair.variantId, repair]));
  const screenVariants = Object.fromEntries(
    Object.entries(appMap.screenVariants ?? {}).map(([variantId, variant]) => {
      const repair = byVariantId.get(variantId);
      if (!repair) return [variantId, variant];
      return [
        variantId,
        { ...variant, targetProfile: overlayHonestBrowserTargetProfile(variant.targetProfile) },
      ];
    }),
  );
  return { appMap: { ...appMap, screenVariants }, repairs: planned };
}

function carriesFixtureUnderUnsignedId(profile: TargetProfile | undefined): boolean {
  if (!profile || profile.platform !== "browser") return false;
  const fixture = profile.browserCaseProfile?.authenticationFixtureId?.trim();
  if (!fixture) return false;
  // The managed default id is unsigned by definition; any other id that a
  // fixture-less sibling variant also uses is equally unsigned. Both shapes
  // mean "the saved environment's id is carrying an execution fixture".
  return profile.id === managedBrowserTargetProfileId(profile.targetId);
}

import type { ProductRunProfileOption } from "@relay/product/run-journey";

/** Display the explicit setup, or the only saved setup for this exact target.
 * Multiple setups remain a choice; an account is never inferred from pixels. */
export function runSetupProfile(
  profiles: readonly ProductRunProfileOption[] | undefined,
  targetId: string,
  savedProfileId?: string,
): ProductRunProfileOption | undefined {
  if (savedProfileId) return profiles?.find((profile) => profile.id === savedProfileId);
  if (!targetId) return undefined;
  const matching = profiles?.filter((profile) => profile.targetId === targetId);
  return matching?.length === 1 ? matching[0] : undefined;
}

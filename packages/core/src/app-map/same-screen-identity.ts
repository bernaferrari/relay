import type { Screen } from "./model.js";

/** Human-approved state equivalence retains every previously accepted fingerprint. */
export function mergeScreenIdentity(target: Screen, sources: readonly Screen[]): void {
  const identities = [target, ...sources].flatMap((screen) =>
    screen.identity ? [screen.identity] : [],
  );
  if (!target.identity && identities[0]) target.identity = structuredClone(identities[0]);
  if (!target.identity) return;
  const aliases = new Set(
    identities.flatMap((identity) => [identity.fingerprint, ...(identity.aliases ?? [])]),
  );
  aliases.delete(target.identity.fingerprint);
  target.identity.aliases = [...aliases].sort();
}

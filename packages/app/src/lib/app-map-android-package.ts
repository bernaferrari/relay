import type { AppMap } from "@relay/protocol";

function packageFromIdentifier(identifier: string | undefined): string | undefined {
  const match = identifier
    ?.trim()
    .match(/^([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)(?=[:/])/);
  return match?.[1]?.toLocaleLowerCase();
}

/**
 * Suggest an Android package only when the map's own captured identifiers
 * corroborate its name. This avoids treating a transient system picker as the
 * mapped app while keeping the common "Grok" → "ai.x.grok" path one-click.
 */
export function suggestedAndroidAppPackage(appMap: AppMap | null | undefined): string | undefined {
  if (!appMap) return undefined;
  const nameTerms = appMap.name
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length >= 3 && !["android", "settings"].includes(term));
  if (!nameTerms.length) return undefined;

  const candidates = new Map<string, { evidence: number; nameMatches: number }>();
  for (const variant of Object.values(appMap.screenVariants)) {
    for (const node of variant.observation?.nodes ?? []) {
      const app = packageFromIdentifier(node.identifier);
      if (!app) continue;
      const previous = candidates.get(app) ?? { evidence: 0, nameMatches: 0 };
      previous.evidence += 1;
      previous.nameMatches = Math.max(
        previous.nameMatches,
        nameTerms.filter((term) => app.includes(term)).length,
      );
      candidates.set(app, previous);
    }
  }

  const best = [...candidates.entries()]
    .filter(([, candidate]) => candidate.nameMatches > 0)
    .sort(
      ([leftApp, left], [rightApp, right]) =>
        right.nameMatches - left.nameMatches ||
        right.evidence - left.evidence ||
        leftApp.localeCompare(rightApp),
    )[0];
  return best?.[0];
}

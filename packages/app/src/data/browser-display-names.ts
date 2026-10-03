import type { TargetDefinition } from "@relay/protocol";

type BrowserIdentity = Pick<TargetDefinition, "id" | "name" | "browser" | "createdAt">;

/** Use the address for auto-named websites; preserve deliberately named profiles.
 * Duplicate numbering follows creation order, so adding a browser does not
 * renumber earlier choices. Exact target IDs remain the execution identity. */
export function browserDisplayNames(
  targets: readonly BrowserIdentity[],
): ReadonlyMap<string, string> {
  const rows = targets
    .filter((target) => target.browser)
    .map((target) => {
      let name = target.name;
      try {
        const url = new URL(target.browser!.startUrl);
        if (name === url.hostname || name === url.host) name = url.host;
      } catch {
        /* Keep the catalog's name when an address cannot be displayed. */
      }
      return { id: target.id, name, createdAt: target.createdAt };
    });
  const totals = new Map<string, number>();
  for (const row of rows)
    totals.set(row.name.toLocaleLowerCase(), (totals.get(row.name.toLocaleLowerCase()) ?? 0) + 1);
  const ordinals = new Map<string, number>();
  return new Map(
    rows
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map((row) => {
        const key = row.name.toLocaleLowerCase();
        const ordinal = (ordinals.get(key) ?? 0) + 1;
        ordinals.set(key, ordinal);
        return [row.id, (totals.get(key) ?? 0) > 1 ? `${row.name} · Browser ${ordinal}` : row.name];
      }),
  );
}

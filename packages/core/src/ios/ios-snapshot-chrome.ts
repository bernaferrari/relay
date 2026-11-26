import type { SnapshotNode } from "../device/device.js";
import type { LiveIosRunnerCommandPost } from "./ios-runner-listener-command.js";
import type { LiveIosRunnerListener } from "./ios-runner-listener.js";

/** Product-owned bounded selector catalog vocabulary. Generic iOS capture ships
 * no application chrome selectors; host extensions register them explicitly. */
export type IosSnapshotCatalogProfile = {
  id: string;
  bundleIds: readonly string[];
  homeChromeIdentifiers: readonly string[];
  sidebarChromeIdentifiers: readonly string[];
  attachMenuIdentifiers: readonly string[];
  homeChromeLabels: readonly string[];
  sidebarChromeLabels: readonly string[];
  /** Identifier whose presence means the sidebar is closed and its chrome is hidden. */
  sidebarOpenerIdentifier: string;
};

const iosSnapshotCatalogProfiles: IosSnapshotCatalogProfile[] = [];

export function registerIosSnapshotCatalogProfile(profile: IosSnapshotCatalogProfile): () => void {
  if (!profile.id.trim()) throw new Error("iOS snapshot catalog profile id must be non-empty");
  if (!profile.bundleIds.length || profile.bundleIds.some((bundleId) => !bundleId.trim())) {
    throw new Error("iOS snapshot catalog profile requires non-empty bundle ids");
  }
  if (!profile.sidebarOpenerIdentifier.trim()) {
    throw new Error("iOS snapshot catalog profile requires a sidebar opener identifier");
  }
  if (iosSnapshotCatalogProfiles.some((existing) => existing.id === profile.id)) {
    throw new Error(`Duplicate iOS snapshot catalog profile: ${profile.id}`);
  }
  const owned = new Set(iosSnapshotCatalogProfiles.flatMap((existing) => existing.bundleIds));
  const overlap = profile.bundleIds.find((bundleId) => owned.has(bundleId));
  if (overlap) throw new Error(`Duplicate iOS snapshot catalog bundle id: ${overlap}`);
  iosSnapshotCatalogProfiles.push(profile);
  return () => {
    const index = iosSnapshotCatalogProfiles.indexOf(profile);
    if (index >= 0) iosSnapshotCatalogProfiles.splice(index, 1);
  };
}

export function iosSnapshotCatalogProfileForBundle(
  bundleId: string,
): IosSnapshotCatalogProfile | undefined {
  return iosSnapshotCatalogProfiles.find((profile) => profile.bundleIds.includes(bundleId));
}

export const IOS_CHROME_QUERY_TIMEOUT_MS = 8_000;

export function chromeValuesToQuery(known: readonly string[], extra?: readonly string[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const value of [...known, ...(extra ?? [])]) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    values.push(trimmed);
  }
  return values;
}

export async function queryIosChromeSelectorsViaListener(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  input: {
    appBundleId?: string;
    selectorKey: "id" | "label";
    values: readonly string[];
    preserveNonlogicalBounds?: boolean;
    catalogValues?: readonly string[];
  },
  timeoutMs: number,
): Promise<SnapshotNode[]> {
  if (input.values.length === 0) return [];
  const nodes: SnapshotNode[] = [];
  const queryTimeout = Math.min(timeoutMs, IOS_CHROME_QUERY_TIMEOUT_MS);
  for (const value of input.values) {
    const result = await post(
      listener,
      {
        command: "querySelector",
        selectorKey: input.selectorKey,
        selectorValue: value,
        ...(input.appBundleId ? { appBundleId: input.appBundleId } : {}),
      },
      queryTimeout,
    );
    if (result.ok === false) continue;
    const found = result.data?.nodes ?? result.nodes ?? [];
    if (input.catalogValues && result.data?.systemSurface)
      throw new Error("Requested entrance inspection returned a system surface");
    for (const node of found) {
      nodes.push({
        ...(input.catalogValues
          ? Object.fromEntries(
              Object.entries(node).filter(([key]) => key !== "recordingSelectorSupplemental"),
            )
          : node),
        // Only this same query census assigns provenance; an incoming tag is ignored.
        ...(input.catalogValues
          ? { recordingSelectorSupplemental: !input.catalogValues.includes(value) }
          : {}),
        ...(input.selectorKey === "id"
          ? { identifier: node.identifier?.trim() || value }
          : { label: node.label?.trim() || value }),
        // This direct query uses the runner's XCUIElement.frame presentation,
        // which this adapter already treats as logical. Recording preserves
        // an explicit producer refusal before omitting Application geometry.
        logicalCoordinates: !input.preserveNonlogicalBounds || node.logicalCoordinates !== false,
      });
    }
  }
  return nodes;
}

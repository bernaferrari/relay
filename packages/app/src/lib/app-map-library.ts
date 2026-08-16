import type { AppMap, DegradedAppMapRef } from "@relay/protocol";

export type MapLibraryItem = Pick<AppMap, "id" | "name" | "updatedAt"> & {
  screenCount: number;
  connectionCount: number;
};

export type DegradedLibraryItem = {
  key: string;
  title: string;
  error: string;
};

/** The library is a projection of the canonical map—not its internal recipe
 * shadow. This keeps screen-only maps visible and correctly classified. */
export function appMapLibraryItem(appMap: AppMap): MapLibraryItem {
  return {
    id: appMap.id,
    name: appMap.name,
    updatedAt: appMap.updatedAt,
    screenCount: Object.keys(appMap.screens).length,
    connectionCount: Object.keys(appMap.connections).length,
  };
}

export function degradedLibraryItem(ref: DegradedAppMapRef): DegradedLibraryItem {
  const fromKey = ref.key.includes(":") ? ref.key.slice(ref.key.lastIndexOf(":") + 1) : ref.key;
  return {
    key: ref.key,
    title: ref.id?.trim() || fromKey || "Unreadable map",
    error: ref.error,
  };
}

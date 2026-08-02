import type { AppMap } from "@relay/protocol";

export type MapLibraryItem = Pick<AppMap, "id" | "name" | "updatedAt"> & {
  screenCount: number;
  connectionCount: number;
};

/** The library is a projection of the canonical map—not its legacy recipe
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

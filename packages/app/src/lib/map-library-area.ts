/** Canonical top-level library areas. Historical URL values normalize to Maps. */
export type MapLibraryArea = "maps" | "runs";

export function normalizeMapLibraryArea(value: string): MapLibraryArea {
  return value === "runs" ? "runs" : "maps";
}

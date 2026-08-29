/** Canonical top-level library areas. Historical URL values normalize to Maps. */
export type MapLibraryArea = "changes" | "maps" | "runs";

export function normalizeMapLibraryArea(value: string): MapLibraryArea {
  return value === "changes" || value === "runs" ? value : "maps";
}

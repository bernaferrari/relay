/** Canonical top-level library areas. Historical URL values normalize to Maps. */
export type MapLibraryArea = "changes" | "maps" | "runs";

export function normalizeMapLibraryArea(value: string): MapLibraryArea {
  return value === "changes" || value === "runs" ? value : "maps";
}

/** Resolve the first product surface from explicit deep-link intent. A Proof
 * owns the Change experience, a Run owns the report experience, and an
 * ordinary repository launch starts with the merge outcome. */
export function initialMapLibraryArea(search: string): MapLibraryArea {
  const params = new URLSearchParams(search);
  if (params.has("proof")) return "changes";
  if (params.has("run")) return "runs";
  return "changes";
}

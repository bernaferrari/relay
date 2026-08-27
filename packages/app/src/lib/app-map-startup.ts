export type AppMapStartupItem = {
  id: string;
  updatedAt: number;
  tests?: Readonly<Record<string, unknown>>;
};

export type AppMapOpeningMode = "map" | "test";

/** The public workflow starts with the outcome-oriented Test view. The map is
 * still available as a generated topology view, but it is never an authoring
 * prerequisite for recording the first Test. */
export function appMapOpeningMode(_map: AppMapStartupItem | undefined): AppMapOpeningMode {
  return "test";
}

export type AppMapStartupDecision =
  | { kind: "wait" }
  | { kind: "keep"; mode: AppMapOpeningMode }
  | { kind: "select"; id: string; mode: AppMapOpeningMode }
  | { kind: "blank" };

/** A project reopens its latest canonical App Map. With no saved map, Relay
 * keeps one local unsaved canvas until the first meaningful edit. */
export function appMapStartupDecision(input: {
  online: boolean;
  loaded: boolean;
  selectedId: string | null;
  maps: readonly AppMapStartupItem[];
}): AppMapStartupDecision {
  if (!input.online || !input.loaded) return { kind: "wait" };
  const selected = input.maps.find((item) => item.id === input.selectedId);
  if (selected) {
    return { kind: "keep", mode: appMapOpeningMode(selected) };
  }
  const latest = input.maps.toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
  return latest
    ? { kind: "select", id: latest.id, mode: appMapOpeningMode(latest) }
    : { kind: "blank" };
}

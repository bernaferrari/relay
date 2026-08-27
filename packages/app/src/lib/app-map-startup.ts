export type AppMapStartupItem = {
  id: string;
  updatedAt: number;
  tests?: Readonly<Record<string, unknown>>;
};

export type AppMapOpeningMode = "map" | "test";

/** Reopen useful saved work at its outcome-oriented Test view. A map without
 * a saved Test still opens on topology because there is no Test to author. */
export function appMapOpeningMode(map: AppMapStartupItem | undefined): AppMapOpeningMode {
  return map && Object.keys(map.tests ?? {}).length > 0 ? "test" : "map";
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

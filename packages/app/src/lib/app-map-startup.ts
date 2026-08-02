export type AppMapStartupItem = {
  id: string;
  updatedAt: number;
};

export type AppMapStartupDecision =
  | { kind: "wait" }
  | { kind: "keep" }
  | { kind: "select"; id: string }
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
  if (input.selectedId && input.maps.some((item) => item.id === input.selectedId)) {
    return { kind: "keep" };
  }
  const latest = input.maps.toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
  return latest ? { kind: "select", id: latest.id } : { kind: "blank" };
}

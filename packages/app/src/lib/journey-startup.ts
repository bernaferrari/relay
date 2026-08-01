export type JourneyStartupItem = {
  id: string;
  source?: string;
  updatedAt?: number;
};

export type JourneyStartupDecision =
  | { kind: "wait" }
  | { kind: "keep" }
  | { kind: "select"; id: string }
  | { kind: "create" };

/** Pure startup policy for the document editor. Creation is allowed only
 * after the server has returned the journey list, preventing the initial
 * empty signal from racing hydration and creating duplicate blank canvases. */
export function journeyStartupDecision(input: {
  online: boolean;
  loaded: boolean;
  selectedId: string | null;
  journeys: readonly JourneyStartupItem[];
}): JourneyStartupDecision {
  if (!input.online || !input.loaded) return { kind: "wait" };
  if (input.selectedId && input.journeys.some((item) => item.id === input.selectedId)) {
    return { kind: "keep" };
  }
  const latest = input.journeys
    .filter((item) => item.source === "custom")
    .toSorted((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0];
  return latest ? { kind: "select", id: latest.id } : { kind: "create" };
}

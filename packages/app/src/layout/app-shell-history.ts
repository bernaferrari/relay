type HistoryAction = "PUSH" | "REPLACE" | "FORWARD" | "BACK" | "GO";

export type HistoryAvailability = {
  index: number;
  furthest: number;
};

export function initialHistoryAvailability(index: number | undefined): HistoryAvailability {
  const safeIndex = validHistoryIndex(index) ? index : 0;
  return { index: safeIndex, furthest: safeIndex };
}

/**
 * Keep forward availability local to the history stack we have observed.
 * A PUSH starts a new branch; BACK, FORWARD, GO, and REPLACE preserve the
 * furthest observed entry so browser/external navigation remains reversible.
 */
export function updateHistoryAvailability(
  current: HistoryAvailability,
  transition: { action: HistoryAction; index: number | undefined },
): HistoryAvailability {
  if (!validHistoryIndex(transition.index)) {
    // A native/external entry may not carry TanStack's index. Fail closed until
    // the next in-app navigation gives us a known position.
    return initialHistoryAvailability(undefined);
  }

  return {
    index: transition.index,
    furthest:
      transition.action === "PUSH"
        ? transition.index
        : Math.max(current.furthest, transition.index),
  };
}

export function historyAvailabilityFlags(position: HistoryAvailability): {
  canGoBack: boolean;
  canGoForward: boolean;
} {
  return {
    canGoBack: position.index > 0,
    canGoForward: position.index < position.furthest,
  };
}

function validHistoryIndex(index: number | undefined): index is number {
  return index !== undefined && Number.isInteger(index) && index >= 0;
}

export type NavigationTransitionStatus = "ready" | "proven" | "drifted" | "blocked";

/**
 * UI-facing projection contract for one shared navigation edge. Relay does not
 * currently transport this DTO; keeping it local makes the missing boundary
 * explicit without deriving proof from check outcomes or logs.
 */
export type NavigationTransitionHealthDto = {
  transitionId: string;
  authoredOrder: number;
  source: { screenId: string; title: string };
  destination: { screenId: string; title: string };
  status: NavigationTransitionStatus;
  dependentCheckIds: string[];
  observedAt: number;
  proof?: {
    tokenId: string;
    runId: string;
    verifiedAt: number;
    destination: { screenId: string; title: string };
  };
  problem?: {
    reason: string;
    observedScreenId?: string;
    observedTitle?: string;
  };
  repair?: {
    targetId: string;
    sourceRunId: string;
    checkId: string;
    title: string;
    summary: string;
  };
};

export type NavigationTransitionHealthRow = NavigationTransitionHealthDto & {
  dependentCount: number;
  lastVerifiedDestination?: string;
};

export type NavigationTransitionRepairEntry = {
  transitionId: string;
  targetId: string;
  title: string;
  summary: string;
  operationId: "run.repair.get";
  fixedInput: { runId: string; checkId: string };
};

export type NavigationTransitionHealthModel = {
  rows: NavigationTransitionHealthRow[];
  counts: Record<NavigationTransitionStatus, number>;
  repair?: NavigationTransitionRepairEntry;
};

const emptyCounts = (): Record<NavigationTransitionStatus, number> => ({
  ready: 0,
  proven: 0,
  drifted: 0,
  blocked: 0,
});

/** Build a calm, authored-order view without upgrading execution evidence. */
export function navigationTransitionHealthModel(
  transitions: readonly NavigationTransitionHealthDto[],
): NavigationTransitionHealthModel {
  const latest = new Map<string, NavigationTransitionHealthDto>();
  for (const transition of transitions) {
    const current = latest.get(transition.transitionId);
    if (!current || transition.observedAt >= current.observedAt) {
      latest.set(transition.transitionId, transition);
    }
  }
  const rows = [...latest.values()]
    .sort(
      (left, right) =>
        left.authoredOrder - right.authoredOrder ||
        left.transitionId.localeCompare(right.transitionId),
    )
    .map((transition) => ({
      ...transition,
      dependentCount: new Set(transition.dependentCheckIds).size,
      ...(transition.proof?.destination.title
        ? { lastVerifiedDestination: transition.proof.destination.title }
        : {}),
    }));
  const counts = rows.reduce(
    (result, row) => ({ ...result, [row.status]: result[row.status] + 1 }),
    emptyCounts(),
  );
  const repairRow = rows.find(
    (row) => (row.status === "drifted" || row.status === "blocked") && row.repair,
  );
  const repair = repairRow?.repair
    ? {
        transitionId: repairRow.transitionId,
        targetId: repairRow.repair.targetId,
        title: repairRow.repair.title,
        summary: repairRow.repair.summary,
        operationId: "run.repair.get" as const,
        fixedInput: {
          runId: repairRow.repair.sourceRunId,
          checkId: repairRow.repair.checkId,
        },
      }
    : undefined;
  return { rows, counts, ...(repair ? { repair } : {}) };
}

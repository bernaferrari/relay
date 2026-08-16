import type { JobInfo } from "./api-types";

export type NavigationTransitionStatus = "ready" | "proven" | "drifted" | "blocked";

export type NavigationTransitionEndpoint =
  | { kind: "screen"; screenId: string; title: string }
  | { kind: "end"; title: string };

/** UI-facing projection of Relay's durable campaign transition artifacts. */
export type NavigationTransitionHealthDto = {
  transitionId: string;
  authoredOrder: number;
  source: { screenId: string; title: string };
  destination: NavigationTransitionEndpoint;
  status: NavigationTransitionStatus;
  dependentCheckIds: string[];
  observedAt: number;
  proof?: {
    tokenId: string;
    runId: string;
    verifiedAt: number;
    destination: NavigationTransitionEndpoint;
  };
  problem?: { reason: string };
  repair?: {
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

function endpointTitle(endpoint: NavigationTransitionEndpoint): string {
  return endpoint.kind === "end" ? endpoint.title : endpoint.title || endpoint.screenId;
}

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
      ...(transition.proof
        ? { lastVerifiedDestination: endpointTitle(transition.proof.destination) }
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

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function destination(value: unknown): NavigationTransitionEndpoint | undefined {
  const item = object(value);
  if (item?.kind === "end") return { kind: "end", title: "End" };
  const screenId = item?.kind === "screen" ? nonEmptyText(item.screenId) : undefined;
  return screenId ? { kind: "screen", screenId, title: screenId } : undefined;
}

type CollectedTransition = {
  transitionId: string;
  authoredOrder: number;
  source: { screenId: string; title: string };
  destination: NavigationTransitionEndpoint;
  dependentCheckIds: Set<string>;
  observedAt: number;
};

type TransitionState = {
  status: NavigationTransitionStatus;
  observedAt: number;
  sequence: number;
  problem?: NavigationTransitionHealthDto["problem"];
  checkId?: string;
};

type TransitionProof = NonNullable<NavigationTransitionHealthDto["proof"]> & {
  observedAt: number;
};

/**
 * Project only serialized check dependencies, proof tokens, and circuit events.
 * A passing check alone never becomes navigation proof.
 */
export function navigationTransitionHealthFromJob(job: JobInfo): NavigationTransitionHealthModel {
  const transitions = new Map<string, CollectedTransition>();
  const states = new Map<string, TransitionState>();
  const proofs = new Map<string, TransitionProof>();
  let authoredOrder = 0;

  for (const [sequence, artifact] of (job.artifacts ?? []).entries()) {
    const data = object(artifact.data);
    if (!data) continue;

    if (artifact.kind === "campaign-check-result" || artifact.kind === "campaign-check-deferred") {
      const checkId = nonEmptyText(data.id);
      if (!checkId || !Array.isArray(data.transitionDependencies)) continue;
      for (const value of data.transitionDependencies) {
        const dependency = object(value);
        const transitionId = nonEmptyText(dependency?.connectionId);
        const originScreenId = nonEmptyText(dependency?.originScreenId);
        const target = destination(dependency?.destination);
        if (!transitionId || !originScreenId || !target) continue;
        const existing = transitions.get(transitionId);
        if (existing) {
          existing.dependentCheckIds.add(checkId);
          existing.observedAt = Math.max(existing.observedAt, artifact.capturedAt);
        } else {
          transitions.set(transitionId, {
            transitionId,
            authoredOrder: authoredOrder++,
            source: { screenId: originScreenId, title: originScreenId },
            destination: target,
            dependentCheckIds: new Set([checkId]),
            observedAt: artifact.capturedAt,
          });
        }
      }
      continue;
    }

    if (artifact.kind === "campaign-transition-proof") {
      const transitionId = nonEmptyText(data.connectionId);
      const originScreenId = nonEmptyText(data.originScreenId);
      const target = destination(data.destination);
      const tokenId = nonEmptyText(data.tokenId);
      const checkId = nonEmptyText(data.checkId);
      const verifiedAt = typeof data.verifiedAt === "number" ? data.verifiedAt : undefined;
      if (
        data.schemaVersion !== 1 ||
        data.status !== "verified" ||
        !transitionId ||
        !originScreenId ||
        !target ||
        !tokenId ||
        !checkId ||
        verifiedAt === undefined
      ) {
        continue;
      }
      if (!transitions.has(transitionId)) {
        transitions.set(transitionId, {
          transitionId,
          authoredOrder: authoredOrder++,
          source: { screenId: originScreenId, title: originScreenId },
          destination: target,
          dependentCheckIds: new Set([checkId]),
          observedAt: artifact.capturedAt,
        });
      }
      const currentProof = proofs.get(transitionId);
      if (!currentProof || artifact.capturedAt >= currentProof.observedAt) {
        proofs.set(transitionId, {
          tokenId,
          runId: job.id,
          verifiedAt,
          destination: target,
          observedAt: artifact.capturedAt,
        });
      }
      setLatestState(states, transitionId, {
        status: "proven",
        observedAt: artifact.capturedAt,
        sequence,
      });
      continue;
    }

    if (artifact.kind === "campaign-transition-circuit") {
      const transitionId = nonEmptyText(data.connectionId);
      const checkId = nonEmptyText(data.checkId);
      const reason = nonEmptyText(data.reason);
      const status =
        data.status === "open"
          ? "blocked"
          : data.status === "needs-confirmation"
            ? "drifted"
            : undefined;
      if (data.schemaVersion !== 1 || !transitionId || !checkId || !reason || !status) continue;
      setLatestState(states, transitionId, {
        status,
        observedAt: artifact.capturedAt,
        sequence,
        problem: { reason },
        checkId,
      });
    }
  }

  const projected = [...transitions.values()].map((transition) => {
    const state = states.get(transition.transitionId);
    const storedProof = proofs.get(transition.transitionId);
    const proof = storedProof
      ? {
          tokenId: storedProof.tokenId,
          runId: storedProof.runId,
          verifiedAt: storedProof.verifiedAt,
          destination: storedProof.destination,
        }
      : undefined;
    const repair =
      state?.checkId && (state.status === "drifted" || state.status === "blocked")
        ? {
            sourceRunId: job.id,
            checkId: state.checkId,
            title: `Repair ${transition.source.title} → ${endpointTitle(transition.destination)}`,
            summary: state.problem?.reason ?? "Review this shared transition.",
          }
        : undefined;
    return {
      transitionId: transition.transitionId,
      authoredOrder: transition.authoredOrder,
      source: transition.source,
      destination: transition.destination,
      status: state?.status ?? "ready",
      dependentCheckIds: [...transition.dependentCheckIds],
      observedAt: Math.max(transition.observedAt, state?.observedAt ?? 0),
      ...(proof ? { proof } : {}),
      ...(state?.problem ? { problem: state.problem } : {}),
      ...(repair ? { repair } : {}),
    } satisfies NavigationTransitionHealthDto;
  });
  return navigationTransitionHealthModel(projected);
}

function setLatestState(
  states: Map<string, TransitionState>,
  transitionId: string,
  next: TransitionState,
): void {
  const current = states.get(transitionId);
  if (
    !current ||
    next.observedAt > current.observedAt ||
    (next.observedAt === current.observedAt && next.sequence >= current.sequence)
  ) {
    states.set(transitionId, next);
  }
}

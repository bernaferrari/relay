import type { AppMap, Connection } from "@relay/protocol";

const MAX_CONNECTION_ROUTE_SAMPLES = 32;

export type ConnectionRouteCost = {
  connectionIds: string[];
  proof: "ready" | "unproven";
  attempts: number;
  successes: number;
  /** Laplace-smoothed route success. Unknown one-edge routes are 0.5, so
   * observed success can help but never turns a draft edge into permission. */
  estimatedSuccess: number;
  p50DurationMs?: number;
};

function p50(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * 0.5;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return Math.ceil(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower));
}

function observations(map: AppMap, connectionId: string) {
  return Object.values(map.targetResults)
    .flatMap((result) =>
      (result.connectionObservations ?? []).flatMap((observation) =>
        observation.connectionId === connectionId ? [{ resultId: result.id, observation }] : [],
      ),
    )
    .sort(
      (left, right) =>
        right.observation.observedAt - left.observation.observedAt ||
        left.resultId.localeCompare(right.resultId),
    )
    .slice(0, MAX_CONNECTION_ROUTE_SAMPLES)
    .map(({ observation }) => observation);
}

/** Deterministic read-only cost for an already-authored route. It never
 * searches the live graph or authorizes an unreviewed Connection. */
export function connectionRouteCost(
  map: AppMap,
  connectionIds: readonly string[],
): ConnectionRouteCost {
  const connections = connectionIds.map((id) => map.connections[id]);
  const ready =
    connections.length > 0 &&
    connections.every((connection) => connection?.state === "ready") &&
    connections.every((connection, index) => {
      if (index === 0) return true;
      const previous = connections[index - 1];
      return (
        previous?.destination.kind === "screen" &&
        previous.destination.screenId === connection?.fromScreenId
      );
    });
  let attempts = 0;
  let successes = 0;
  let estimatedSuccess = 1;
  let allDurationsKnown = true;
  let totalP50DurationMs = 0;
  for (const connectionId of connectionIds) {
    const samples = observations(map, connectionId);
    const passed = samples.filter((sample) => sample.outcome === "passed");
    attempts += samples.length;
    successes += passed.length;
    estimatedSuccess *= (passed.length + 1) / (samples.length + 2);
    const duration = p50(passed.map((sample) => sample.durationMs));
    if (duration === undefined) allDurationsKnown = false;
    else totalP50DurationMs += duration;
  }
  return {
    connectionIds: [...connectionIds],
    proof: ready ? "ready" : "unproven",
    attempts,
    successes,
    estimatedSuccess,
    ...(allDurationsKnown ? { p50DurationMs: totalP50DurationMs } : {}),
  };
}

function executionSignature(connection: Connection): string {
  return JSON.stringify({
    fromScreenId: connection.fromScreenId,
    destination: connection.destination,
    actions: connection.actions,
    navigation: connection.navigation,
    return: connection.return,
  });
}

function compareRouteCost(left: ConnectionRouteCost, right: ConnectionRouteCost): number {
  if (left.proof !== right.proof) return left.proof === "ready" ? -1 : 1;
  if (left.estimatedSuccess !== right.estimatedSuccess) {
    return right.estimatedSuccess - left.estimatedSuccess;
  }
  const leftDuration = left.p50DurationMs ?? Number.POSITIVE_INFINITY;
  const rightDuration = right.p50DurationMs ?? Number.POSITIVE_INFINITY;
  if (leftDuration !== rightDuration) return leftDuration - rightDuration;
  if (left.connectionIds.length !== right.connectionIds.length) {
    return left.connectionIds.length - right.connectionIds.length;
  }
  return left.connectionIds.join("\u0000").localeCompare(right.connectionIds.join("\u0000"));
}

/** Select among duplicate reviewed direct edges only when their executable
 * contracts are byte-for-byte equivalent. Different behaviors stay
 * ambiguous; persisted timing must never justify an unsafe live route. */
export function selectEquivalentDirectConnection(
  map: AppMap,
  candidates: readonly Connection[],
): Connection | undefined | null {
  if (!candidates.length) return undefined;
  const ready = candidates.filter((candidate) => candidate.state === "ready");
  if (!ready.length) return undefined;
  const endpoints = new Set(
    ready.map((candidate) =>
      JSON.stringify({ from: candidate.fromScreenId, destination: candidate.destination }),
    ),
  );
  const signatures = new Set(ready.map(executionSignature));
  if (endpoints.size !== 1 || signatures.size !== 1) return null;
  return [...ready]
    .map((connection) => ({ connection, cost: connectionRouteCost(map, [connection.id]) }))
    .sort((left, right) => compareRouteCost(left.cost, right.cost))[0]?.connection;
}

export const GOLDEN_LOOP_TELEMETRY_VERSION = 1 as const;
export const GOLDEN_LOOP_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const GOLDEN_LOOP_MAX_EVENTS = 2_000;

export const GOLDEN_LOOP_BOUNDARIES = [
  "connect",
  "record",
  "checkpoint",
  "compile",
  "review",
  "replay",
  "approve",
  "run",
  "report",
] as const;
export type GoldenLoopBoundary = (typeof GOLDEN_LOOP_BOUNDARIES)[number];

export const GOLDEN_LOOP_ACTIONS = [
  ...GOLDEN_LOOP_BOUNDARIES,
  "observe",
  "edit-recording",
  "repeat",
  "recover",
] as const;
export type GoldenLoopAction = (typeof GOLDEN_LOOP_ACTIONS)[number];

type EventBase = {
  schemaVersion: 1;
  sequence: number;
  at: number;
  projectScopeId: string;
  journeyId: string;
};

export type GoldenLoopTelemetryEvent = EventBase &
  (
    | {
        type: "boundary";
        boundary: GoldenLoopBoundary;
        outcome: "started" | "completed" | "failed" | "abandoned";
      }
    | { type: "help-opened"; surface: "docs" | "cli-help" | "mcp-help" | "in-product-help" }
    | { type: "action-latency"; action: GoldenLoopAction; durationMs: number }
    | {
        type: "recovery-outcome";
        outcome: "recovered" | "bounded-replay" | "human-required" | "unsupported";
        durationMs: number;
      }
    | { type: "duplicate-input-count"; count: number }
    | {
        type: "evidence-completeness";
        status: "complete" | "partial";
        requiredChannels: number;
        missingChannels: number;
      }
    | { type: "causal-failure-surfaced"; surfaced: boolean }
  );

export type GoldenLoopTelemetryStore = {
  schemaVersion: 1;
  createdAt: number;
  events: readonly GoldenLoopTelemetryEvent[];
};

export type GoldenLoopJourneyAggregate = {
  journeyId: string;
  completedBoundaries: readonly GoldenLoopBoundary[];
  timeToFirstTrustworthyTestMs?: number;
  abandonmentBoundary?: GoldenLoopBoundary;
  failureBoundary?: GoldenLoopBoundary;
  incompleteAfter?: GoldenLoopBoundary;
};

export type GoldenLoopTelemetryReport = {
  schemaVersion: 1;
  generatedAt: number;
  eventCount: number;
  journeys: readonly GoldenLoopJourneyAggregate[];
  funnel: Record<GoldenLoopBoundary, number>;
  helpOpened: number;
  actionLatency: Partial<
    Record<GoldenLoopAction, { count: number; p50Ms: number; p95Ms: number; maxMs: number }>
  >;
  recovery: {
    total: number;
    recovered: number;
    boundedReplay: number;
    humanRequired: number;
    unsupported: number;
  };
  duplicateInput: { observed: number; count: number };
  evidence: { observed: number; complete: number; partial: number };
  causalFailure: { observed: number; surfaced: number };
  orderingViolations: number;
};

const pseudonym = /^local:[a-f0-9]{64}$/u;
const boundaries = new Set<string>(GOLDEN_LOOP_BOUNDARIES);
const actions = new Set<string>(GOLDEN_LOOP_ACTIONS);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label} contains unsupported fields: ${extras.join(", ")}`);
}

function integer(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new Error(`${label} must be a bounded non-negative integer`);
  }
  return value as number;
}

export function parseGoldenLoopTelemetryEvent(value: unknown): GoldenLoopTelemetryEvent {
  const input = record(value, "golden-loop event");
  const base = ["schemaVersion", "sequence", "at", "projectScopeId", "journeyId", "type"];
  if (input.schemaVersion !== 1) throw new Error("golden-loop event schemaVersion must be 1");
  integer(input.sequence, "golden-loop event sequence");
  integer(input.at, "golden-loop event timestamp");
  if (typeof input.projectScopeId !== "string" || !pseudonym.test(input.projectScopeId)) {
    throw new Error("golden-loop project scope must be a local pseudonym");
  }
  if (typeof input.journeyId !== "string" || !pseudonym.test(input.journeyId)) {
    throw new Error("golden-loop journey must be a local pseudonym");
  }
  if (input.type === "boundary") {
    exactKeys(input, [...base, "boundary", "outcome"], "golden-loop boundary event");
    if (typeof input.boundary !== "string" || !boundaries.has(input.boundary)) {
      throw new Error("golden-loop boundary is unsupported");
    }
    if (!new Set(["started", "completed", "failed", "abandoned"]).has(String(input.outcome))) {
      throw new Error("golden-loop boundary outcome is unsupported");
    }
  } else if (input.type === "help-opened") {
    exactKeys(input, [...base, "surface"], "golden-loop help event");
    if (!new Set(["docs", "cli-help", "mcp-help", "in-product-help"]).has(String(input.surface))) {
      throw new Error("golden-loop help surface is unsupported");
    }
  } else if (input.type === "action-latency") {
    exactKeys(input, [...base, "action", "durationMs"], "golden-loop latency event");
    if (typeof input.action !== "string" || !actions.has(input.action)) {
      throw new Error("golden-loop action is unsupported");
    }
    integer(input.durationMs, "golden-loop action duration", 24 * 60 * 60 * 1_000);
  } else if (input.type === "recovery-outcome") {
    exactKeys(input, [...base, "outcome", "durationMs"], "golden-loop recovery event");
    if (
      !new Set(["recovered", "bounded-replay", "human-required", "unsupported"]).has(
        String(input.outcome),
      )
    ) {
      throw new Error("golden-loop recovery outcome is unsupported");
    }
    integer(input.durationMs, "golden-loop recovery duration", 24 * 60 * 60 * 1_000);
  } else if (input.type === "duplicate-input-count") {
    exactKeys(input, [...base, "count"], "golden-loop duplicate-input event");
    integer(input.count, "golden-loop duplicate-input count", 1_000_000);
  } else if (input.type === "evidence-completeness") {
    exactKeys(
      input,
      [...base, "status", "requiredChannels", "missingChannels"],
      "golden-loop evidence event",
    );
    if (!new Set(["complete", "partial"]).has(String(input.status))) {
      throw new Error("golden-loop evidence status is unsupported");
    }
    integer(input.requiredChannels, "golden-loop required channel count", 64);
    integer(input.missingChannels, "golden-loop missing channel count", 64);
    if ((input.missingChannels as number) > (input.requiredChannels as number)) {
      throw new Error("golden-loop missing channels cannot exceed required channels");
    }
  } else if (input.type === "causal-failure-surfaced") {
    exactKeys(input, [...base, "surfaced"], "golden-loop causal-failure event");
    if (typeof input.surfaced !== "boolean") {
      throw new Error("golden-loop causal-failure surfaced must be boolean");
    }
  } else {
    throw new Error("golden-loop event type is unsupported");
  }
  return structuredClone(input) as GoldenLoopTelemetryEvent;
}

export function parseGoldenLoopTelemetryStore(value: unknown): GoldenLoopTelemetryStore {
  const input = record(value, "golden-loop store");
  exactKeys(input, ["schemaVersion", "createdAt", "events"], "golden-loop store");
  if (input.schemaVersion !== 1) throw new Error("golden-loop store schemaVersion must be 1");
  integer(input.createdAt, "golden-loop store creation time");
  if (!Array.isArray(input.events) || input.events.length > GOLDEN_LOOP_MAX_EVENTS) {
    throw new Error("golden-loop events exceed the local retention bound");
  }
  const events = input.events.map(parseGoldenLoopTelemetryEvent);
  return { schemaVersion: 1, createdAt: input.createdAt as number, events };
}

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

export function projectGoldenLoopTelemetry(
  events: readonly GoldenLoopTelemetryEvent[],
  generatedAt: number,
): GoldenLoopTelemetryReport {
  const parsed = events.map(parseGoldenLoopTelemetryEvent);
  let orderingViolations = 0;
  for (let index = 1; index < parsed.length; index += 1) {
    if (
      parsed[index]!.sequence <= parsed[index - 1]!.sequence ||
      parsed[index]!.at < parsed[index - 1]!.at
    )
      orderingViolations += 1;
  }
  const ordered = [...parsed].sort(
    (left, right) => left.sequence - right.sequence || left.at - right.at,
  );
  const funnel = Object.fromEntries(
    GOLDEN_LOOP_BOUNDARIES.map((boundary) => [boundary, 0]),
  ) as Record<GoldenLoopBoundary, number>;
  const funnelJourneys = new Map<GoldenLoopBoundary, Set<string>>(
    GOLDEN_LOOP_BOUNDARIES.map((boundary) => [boundary, new Set()]),
  );
  const journeyEvents = new Map<string, GoldenLoopTelemetryEvent[]>();
  const latency = new Map<GoldenLoopAction, number[]>();
  const recovery = { total: 0, recovered: 0, boundedReplay: 0, humanRequired: 0, unsupported: 0 };
  let helpOpened = 0;
  let duplicateInputCount = 0;
  let duplicateInputObserved = 0;
  let evidenceObserved = 0;
  let evidenceComplete = 0;
  let causalObserved = 0;
  let causalSurfaced = 0;
  for (const event of ordered) {
    journeyEvents.set(event.journeyId, [...(journeyEvents.get(event.journeyId) ?? []), event]);
    if (event.type === "boundary" && event.outcome === "completed")
      funnelJourneys.get(event.boundary)!.add(event.journeyId);
    if (event.type === "help-opened") helpOpened += 1;
    if (event.type === "action-latency")
      latency.set(event.action, [...(latency.get(event.action) ?? []), event.durationMs]);
    if (event.type === "recovery-outcome") {
      recovery.total += 1;
      if (event.outcome === "recovered") recovery.recovered += 1;
      if (event.outcome === "bounded-replay") recovery.boundedReplay += 1;
      if (event.outcome === "human-required") recovery.humanRequired += 1;
      if (event.outcome === "unsupported") recovery.unsupported += 1;
    }
    if (event.type === "duplicate-input-count") {
      duplicateInputObserved += 1;
      duplicateInputCount += event.count;
    }
    if (event.type === "evidence-completeness") {
      evidenceObserved += 1;
      if (event.status === "complete") evidenceComplete += 1;
    }
    if (event.type === "causal-failure-surfaced") {
      causalObserved += 1;
      if (event.surfaced) causalSurfaced += 1;
    }
  }
  for (const boundary of GOLDEN_LOOP_BOUNDARIES)
    funnel[boundary] = funnelJourneys.get(boundary)!.size;
  const journeys = [...journeyEvents].map(([journeyId, own]): GoldenLoopJourneyAggregate => {
    const completed = own.filter(
      (event): event is Extract<GoldenLoopTelemetryEvent, { type: "boundary" }> =>
        event.type === "boundary" && event.outcome === "completed",
    );
    const completedBoundaries = GOLDEN_LOOP_BOUNDARIES.filter((boundary) =>
      completed.some((event) => event.boundary === boundary),
    );
    const connectedAt = completed.find((event) => event.boundary === "connect")?.at;
    const approvedAt = completed.find((event) => event.boundary === "approve")?.at;
    const abandoned = own.find(
      (event): event is Extract<GoldenLoopTelemetryEvent, { type: "boundary" }> =>
        event.type === "boundary" && event.outcome === "abandoned",
    );
    const failed = own.find(
      (event): event is Extract<GoldenLoopTelemetryEvent, { type: "boundary" }> =>
        event.type === "boundary" && event.outcome === "failed",
    );
    const incompleteAfter = [...completedBoundaries]
      .reverse()
      .find((boundary) => boundary !== "report");
    return {
      journeyId,
      completedBoundaries,
      ...(connectedAt !== undefined && approvedAt !== undefined && approvedAt >= connectedAt
        ? { timeToFirstTrustworthyTestMs: approvedAt - connectedAt }
        : {}),
      ...(abandoned ? { abandonmentBoundary: abandoned.boundary } : {}),
      ...(failed ? { failureBoundary: failed.boundary } : {}),
      ...(!abandoned && !failed && !completedBoundaries.includes("report") && incompleteAfter
        ? { incompleteAfter }
        : {}),
    };
  });
  return {
    schemaVersion: 1,
    generatedAt,
    eventCount: ordered.length,
    journeys,
    funnel,
    helpOpened,
    actionLatency: Object.fromEntries(
      [...latency].map(([action, values]) => [
        action,
        {
          count: values.length,
          p50Ms: percentile(values, 0.5),
          p95Ms: percentile(values, 0.95),
          maxMs: Math.max(...values),
        },
      ]),
    ),
    recovery,
    duplicateInput: { observed: duplicateInputObserved, count: duplicateInputCount },
    evidence: {
      observed: evidenceObserved,
      complete: evidenceComplete,
      partial: evidenceObserved - evidenceComplete,
    },
    causalFailure: { observed: causalObserved, surfaced: causalSurfaced },
    orderingViolations,
  };
}

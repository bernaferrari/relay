import type {
  DiscoveryCoverageReport,
  DiscoveryScope,
  DiscoverySession,
  OperationInput,
  TracePackExportResponse,
} from "@relay/protocol";
import type {
  ExportEvidenceIntent,
  DebugBugOutcome,
  DebugBugOutcomeIntent,
  FailureInspection,
  InspectFailureIntent,
  ProposeRepairIntent,
  RecordTestOutcomeIntent,
  RelayInvokeClient,
  RelayOperationPort,
  RelayOutcomeJobs,
  RepairProposalResult,
  RunTestOutcomeIntent,
  VerifyChangeOutcomeIntent,
} from "@relay/workflows";
import { createRelayOperationPort } from "@relay/workflows/operation-port";

export type { DebugBugOutcome, DebugBugOutcomeIntent } from "@relay/workflows";

/** The deliberately small public view of one discovery session.
 * Controls, accessibility trees, screenshots, and raw transitions remain in
 * the canonical discovery operations and are not copied into product state. */
export type AgentDebugDiscoverySummary = {
  readonly id: string;
  readonly name: string;
  readonly targetId: string;
  readonly status: DiscoverySession["status"];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly currentScreenId?: string;
  readonly scope: Pick<DiscoveryScope, "maxScreens" | "maxTransitions" | "maxDurationMs">;
  readonly screenCount: number;
  readonly transitionCount: number;
  readonly exploration?: {
    readonly strategy: NonNullable<DiscoverySession["explore"]>["strategy"];
    readonly maxDepth: number;
    readonly status: "complete" | "cancelled" | "budget" | "left_app" | "error" | "running";
    readonly problemCount: number;
  };
};

export type AgentDebugCoverageSummary = {
  readonly mapName: string;
  readonly generatedAt: number;
  readonly sessionCount: number;
  readonly profileCount: number;
  readonly unprofiledSessionCount: number;
  readonly screenCount: number;
  readonly transitionCount: number;
  readonly exploreOutcome?: NonNullable<DiscoveryCoverageReport["exploreOutcome"]>;
  readonly blockedReasonCount: number;
};

/** Evidence is returned as attribution-safe metadata; the trace-pack content
 * remains available through the advanced export operation. */
export type AgentDebugEvidenceSummary = {
  readonly runId: string;
  readonly attribution: AgentDebugAttribution;
  readonly tracePackDigest: string;
  readonly historicalVerdict: "proved" | "failed" | "insufficient-evidence";
  readonly objectCount: number;
  readonly evidenceStatus: "complete" | "partial";
  readonly smallestLiveVerification: {
    readonly kind: string;
    readonly reason: string;
  };
};

export type AgentDebugAttribution = { readonly actorId: string };

export type AgentDebugPlanStep =
  | {
      readonly kind: "record";
      readonly supported: true;
      readonly operation: "outcome.record";
      readonly intent: RecordTestOutcomeIntent;
      readonly requires: "confirmControl";
    }
  | {
      readonly kind: "create-discovery";
      readonly supported: true;
      readonly operation: "discovery.create";
      readonly intent: OperationInput<"discovery.create">;
    }
  | {
      readonly kind: "start-discovery";
      readonly supported: true;
      readonly operation: "discovery.start";
      readonly intent: OperationInput<"discovery.start">;
    }
  | {
      readonly kind: "review-test";
      readonly supported: false;
      readonly requiresHuman: true;
      readonly reason: "No automatic test approval is exposed by Agent Debug.";
    }
  | {
      readonly kind: "run";
      readonly supported: true;
      readonly operation: "outcome.run";
      readonly intent: RunTestOutcomeIntent;
    }
  | {
      readonly kind: "inspect-failure";
      readonly supported: true;
      readonly operation: "outcome.inspectFailure";
      readonly intent: InspectFailureIntent;
    }
  | {
      readonly kind: "propose-repair";
      readonly supported: true;
      readonly operation: "outcome.proposeRepair";
      readonly intent: ProposeRepairIntent;
      readonly requiresHumanReview: true;
    }
  | {
      readonly kind: "verify-change";
      readonly supported: true;
      readonly operation: "outcome.verifyChange";
      readonly intent: VerifyChangeOutcomeIntent;
      readonly mutation: "none";
    }
  | {
      readonly kind: "export-evidence";
      readonly supported: true;
      readonly operation: "outcome.exportEvidence";
      readonly intent: ExportEvidenceIntent;
    };

export type AgentDebugPlan = {
  readonly schemaVersion: 1;
  readonly kind: "agent-debug-plan";
  readonly attribution: AgentDebugAttribution;
  readonly steps: readonly AgentDebugPlanStep[];
  readonly gaps: readonly string[];
};

export type AgentDebugPlanInput = {
  readonly actorId: string;
  readonly record: RecordTestOutcomeIntent;
  readonly discovery?: {
    readonly create: OperationInput<"discovery.create">;
    readonly start?: OperationInput<"discovery.start">;
  };
  readonly run?: RunTestOutcomeIntent;
  readonly failure?: InspectFailureIntent;
  readonly repair?: ProposeRepairIntent;
  readonly verifyChange?: VerifyChangeOutcomeIntent;
  readonly exportEvidence?: ExportEvidenceIntent;
};

export type AgentDebugProductService = {
  readonly plan: (input: AgentDebugPlanInput) => AgentDebugPlan;
  /** Advance one explicit, bounded Agent Debug stage through canonical jobs. */
  readonly debugBug: (intent: DebugBugOutcomeIntent) => Promise<DebugBugOutcome>;
  readonly record: (intent: RecordTestOutcomeIntent) => ReturnType<RelayOutcomeJobs["record"]>;
  readonly createDiscovery: (
    input: OperationInput<"discovery.create">,
  ) => Promise<AgentDebugDiscoverySummary>;
  readonly startDiscovery: (
    input: OperationInput<"discovery.start">,
  ) => Promise<AgentDebugDiscoverySummary>;
  readonly getDiscovery: (sessionId: string) => Promise<AgentDebugDiscoverySummary>;
  readonly getCoverage: (sessionId: string) => Promise<AgentDebugCoverageSummary>;
  readonly run: (intent: RunTestOutcomeIntent) => ReturnType<RelayOutcomeJobs["run"]>;
  readonly inspectFailure: (intent: InspectFailureIntent) => Promise<FailureInspection>;
  readonly proposeRepair: (intent: ProposeRepairIntent) => Promise<RepairProposalResult>;
  readonly verifyChange: (
    intent: VerifyChangeOutcomeIntent,
  ) => ReturnType<RelayOutcomeJobs["verifyChange"]>;
  readonly exportEvidence: (intent: ExportEvidenceIntent) => Promise<AgentDebugEvidenceSummary>;
};

const MAX_DISCOVERY_SCREENS = 500;
const MAX_DISCOVERY_TRANSITIONS = 2_000;
const MAX_DISCOVERY_DURATION_MS = 60 * 60 * 1_000;

function assertActorId(actorId: string): void {
  if (!actorId.trim()) throw new TypeError("Agent Debug requires an actor identity.");
}

function boundedScope(
  scope: unknown,
): Pick<DiscoveryScope, "maxScreens" | "maxTransitions" | "maxDurationMs"> {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new TypeError("Discovery scope is required for bounded Agent Debug exploration.");
  }
  const value = scope as Partial<DiscoveryScope>;
  const fields: readonly [string, unknown, number][] = [
    ["maxScreens", value.maxScreens, MAX_DISCOVERY_SCREENS],
    ["maxTransitions", value.maxTransitions, MAX_DISCOVERY_TRANSITIONS],
    ["maxDurationMs", value.maxDurationMs, MAX_DISCOVERY_DURATION_MS],
  ];
  for (const [label, candidate, maximum] of fields) {
    if (
      typeof candidate !== "number" ||
      !Number.isInteger(candidate) ||
      candidate < 1 ||
      candidate > maximum
    ) {
      throw new TypeError(`${label} must be an integer between 1 and ${maximum}.`);
    }
  }
  return {
    maxScreens: value.maxScreens as number,
    maxTransitions: value.maxTransitions as number,
    maxDurationMs: value.maxDurationMs as number,
  };
}

export function projectAgentDebugDiscovery(session: DiscoverySession): AgentDebugDiscoverySummary {
  const scope = boundedScope(session.scope);
  const explore = session.explore;
  return {
    id: session.id,
    name: session.name,
    targetId: session.targetId,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.currentScreenId ? { currentScreenId: session.currentScreenId } : {}),
    scope,
    screenCount: session.screens.length,
    transitionCount: session.transitions.length,
    ...(explore
      ? {
          exploration: {
            strategy: explore.strategy,
            maxDepth: explore.maxDepth,
            status: explore.stopReason?.code ?? "running",
            problemCount: explore.problems?.length ?? 0,
          },
        }
      : {}),
  };
}

export function projectAgentDebugCoverage(
  coverage: DiscoveryCoverageReport,
): AgentDebugCoverageSummary {
  return {
    mapName: coverage.mapName,
    generatedAt: coverage.generatedAt,
    sessionCount: coverage.sessionIds.length,
    profileCount: coverage.profiles.length,
    unprofiledSessionCount: coverage.unprofiledSessionIds.length,
    screenCount: coverage.screens.length,
    transitionCount: coverage.transitions.length,
    ...(coverage.exploreOutcome ? { exploreOutcome: coverage.exploreOutcome } : {}),
    blockedReasonCount: coverage.blockedReasons?.length ?? 0,
  };
}

export function projectAgentDebugEvidence(
  attribution: AgentDebugAttribution,
  runId: string,
  result: TracePackExportResponse,
): AgentDebugEvidenceSummary {
  if (result.tracePack.source.runId !== runId || result.analysis.sourceRunId !== runId) {
    throw new TypeError("Relay returned evidence for a different run.");
  }
  return {
    runId,
    attribution,
    tracePackDigest: result.tracePack.digest,
    historicalVerdict: result.analysis.historicalVerdict,
    objectCount: result.tracePack.objects.length,
    evidenceStatus: result.tracePack.completeness.status,
    smallestLiveVerification: {
      kind: result.analysis.smallestLiveVerification.kind,
      reason: result.analysis.smallestLiveVerification.reason.slice(0, 2_048),
    },
  };
}

/** Build a stable, non-executing plan. The review steps are explicit because
 * Relay has no safe operation that approves a Test or applies a repair. */
export function planAgentDebug(input: AgentDebugPlanInput): AgentDebugPlan {
  assertActorId(input.actorId);
  if (input.record.confirmControl !== true) {
    throw new TypeError("Agent Debug recording requires explicit confirmControl:true.");
  }
  const steps: AgentDebugPlanStep[] = [
    {
      kind: "record",
      supported: true,
      operation: "outcome.record",
      intent: input.record,
      requires: "confirmControl",
    },
  ];
  if (input.discovery) {
    boundedScope(input.discovery.create.scope);
    if (input.discovery.start && input.discovery.create.id !== input.discovery.start.sessionId) {
      throw new TypeError(
        "A deterministic discovery plan requires create.id to match start.sessionId.",
      );
    }
    steps.push({
      kind: "create-discovery",
      supported: true,
      operation: "discovery.create",
      intent: input.discovery.create,
    });
    if (input.discovery.start) {
      steps.push({
        kind: "start-discovery",
        supported: true,
        operation: "discovery.start",
        intent: input.discovery.start,
      });
    }
  }
  if (input.run || input.failure || input.repair || input.verifyChange || input.exportEvidence) {
    steps.push({
      kind: "review-test",
      supported: false,
      requiresHuman: true,
      reason: "No automatic test approval is exposed by Agent Debug.",
    });
  }
  if (input.run)
    steps.push({ kind: "run", supported: true, operation: "outcome.run", intent: input.run });
  if (input.failure)
    steps.push({
      kind: "inspect-failure",
      supported: true,
      operation: "outcome.inspectFailure",
      intent: input.failure,
    });
  if (input.repair) {
    steps.push({
      kind: "propose-repair",
      supported: true,
      operation: "outcome.proposeRepair",
      intent: input.repair,
      requiresHumanReview: true,
    });
  }
  if (input.verifyChange) {
    steps.push({
      kind: "verify-change",
      supported: true,
      operation: "outcome.verifyChange",
      intent: input.verifyChange,
      mutation: "none",
    });
  }
  if (input.exportEvidence)
    steps.push({
      kind: "export-evidence",
      supported: true,
      operation: "outcome.exportEvidence",
      intent: input.exportEvidence,
    });
  return {
    schemaVersion: 1,
    kind: "agent-debug-plan",
    attribution: { actorId: input.actorId },
    steps,
    gaps: [
      "Failure inspection is bounded evidence and repair context; no canonical failure-clustering operation exists.",
      "Discovery promotion, test approval, repair application, and code mutation remain explicit human-owned operations.",
      "Recording creates an authoring session; running still requires an existing saved test identity.",
      "Verification is offline and export returns TracePack metadata; neither publishes proof nor predicts future device behavior.",
    ],
  };
}

export type AgentDebugProductServiceOptions = {
  readonly actorId: string;
  readonly jobs?: Pick<
    RelayOutcomeJobs,
    | "record"
    | "run"
    | "inspectFailure"
    | "proposeRepair"
    | "verifyChange"
    | "exportEvidence"
    | "debugBug"
  >;
  readonly operations?: RelayOperationPort;
};

export function createAgentDebugProductService(
  client: RelayInvokeClient,
  options: AgentDebugProductServiceOptions,
): AgentDebugProductService {
  assertActorId(options.actorId);
  const jobsPromise = options.jobs
    ? Promise.resolve(options.jobs)
    : import("@relay/workflows/outcomes").then(({ createRelayOutcomeJobs }) =>
        createRelayOutcomeJobs(client, { actorId: options.actorId }),
      );
  const operations = options.operations ?? createRelayOperationPort(client);
  return {
    plan: (input) => planAgentDebug({ ...input, actorId: options.actorId }),
    debugBug: (intent) => jobsPromise.then((jobs) => jobs.debugBug(intent)),
    record: async (intent) => (await jobsPromise).record(intent),
    async createDiscovery(input) {
      boundedScope(input.scope);
      const { session } = await operations.invoke("discovery.create", input);
      return projectAgentDebugDiscovery(session);
    },
    async startDiscovery(input) {
      const { session } = await operations.invoke("discovery.start", input);
      return projectAgentDebugDiscovery(session);
    },
    async getDiscovery(sessionId) {
      const { session } = await operations.invoke("discovery.get", { sessionId });
      return projectAgentDebugDiscovery(session);
    },
    async getCoverage(sessionId) {
      const { coverage } = await operations.invoke("discovery.coverage", { sessionId });
      return projectAgentDebugCoverage(coverage);
    },
    run: async (intent) => (await jobsPromise).run(intent),
    inspectFailure: async (intent) => (await jobsPromise).inspectFailure(intent),
    proposeRepair: async (intent) => (await jobsPromise).proposeRepair(intent),
    verifyChange: async (intent) => (await jobsPromise).verifyChange(intent),
    async exportEvidence(intent) {
      const result = await (await jobsPromise).exportEvidence(intent);
      return projectAgentDebugEvidence({ actorId: options.actorId }, intent.runId, result);
    },
  };
}

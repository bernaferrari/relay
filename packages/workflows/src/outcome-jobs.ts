import { verifyChangeOffline } from "@relay/core/verify-change";
import {
  measureTracePackJson,
  TRACE_PACK_OFFLINE_TRANSPORT_LIMITS,
  VERIFY_CHANGE_MAX_IDS,
  VERIFY_CHANGE_MAX_TRACE_PACKS,
  type CampaignRepairTargetSummary,
  type SourceRevision,
  type TracePack,
  type TracePackExportResponse,
} from "@relay/protocol";
import type { RelayOperationPort } from "./operation-port.js";
import { createRelayOperationPort, type RelayInvokeClient } from "./operation-port.js";
import { createRelayWorkflows } from "./relay-workflows.js";
import { watchWorkflow, type WorkflowEventSource } from "./workflow-watch.js";
import type {
  ConnectTargetIntent,
  ConnectTargetResult,
  DebugBugOutcome,
  DebugBugDiscoverySummary,
  DebugBugOutcomeIntent,
  ExportEvidenceIntent,
  FailureEvidenceSummary,
  FailureInspection,
  FailureRepairProposal,
  FailureRunSummary,
  InspectFailureIntent,
  InspectProofOutcomeIntent,
  ObserveTargetIntent,
  ProposeRepairIntent,
  ProveChangeOutcomeIntent,
  RepairProposalResult,
  RecordTestOutcomeIntent,
  RelayOutcomeJobs,
  RepeatTestOutcomeIntent,
  ReplayLabOutcomeIntent,
  RunTestOutcomeIntent,
  VerifyChangeOutcomeIntent,
} from "./types.js";
import { runReplayLab } from "./replay-lab.js";
import { recordingPathContext } from "./recording-path-context.js";
import { startDebugBugRecording } from "./recording-outcome-jobs.js";
import { acquireOwnLease, selectAppMap, selectTarget, targetCatalog } from "./target-catalog.js";

export type RelayOutcomeJobOptions = { actorId: string };

const VERIFY_CHANGE_READ_CONCURRENCY = 4;
const VERIFY_CHANGE_MAX_TOTAL_PACK_BYTES = 128 * 1024 * 1024;
const VERIFY_CHANGE_MAX_PACK_OBJECTS = 2_000;
const PUBLIC_ID_MAX_CHARS = 512;
const PUBLIC_LABEL_MAX_CHARS = 1_024;
const PUBLIC_ERROR_MAX_CHARS = 8_192;
const PUBLIC_EVIDENCE_CHANNELS_MAX = 64;
const DEBUG_BUG_MAX_DISCOVERY_SCREENS = 500;
const DEBUG_BUG_MAX_DISCOVERY_TRANSITIONS = 2_000;
const DEBUG_BUG_MAX_DISCOVERY_DURATION_MS = 60 * 60 * 1_000;
const DEBUG_BUG_MAX_TEXT_CHARS = 2_048;

function boundedDebugBugDiscovery(input: DebugBugOutcomeIntent): void {
  if (input.action !== "explore") return;
  const scope = input.create.scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new TypeError("Agent Debug exploration requires an explicit bounded scope.");
  }
  const value = scope as Record<string, unknown>;
  const bounds: readonly [string, number][] = [
    ["maxScreens", DEBUG_BUG_MAX_DISCOVERY_SCREENS],
    ["maxTransitions", DEBUG_BUG_MAX_DISCOVERY_TRANSITIONS],
    ["maxDurationMs", DEBUG_BUG_MAX_DISCOVERY_DURATION_MS],
  ];
  for (const [name, maximum] of bounds) {
    const candidate = value[name];
    if (
      typeof candidate !== "number" ||
      !Number.isInteger(candidate) ||
      candidate < 1 ||
      candidate > maximum
    ) {
      throw new TypeError(`${name} must be an integer between 1 and ${maximum}.`);
    }
  }
}

function boundedDebugBugText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > DEBUG_BUG_MAX_TEXT_CHARS) {
    throw new TypeError(`${label} must be between 1 and ${DEBUG_BUG_MAX_TEXT_CHARS} characters.`);
  }
  return normalized;
}

function projectDebugBugDiscovery(session: {
  id: string;
  name: string;
  targetId: string;
  status: string;
  scope: unknown;
  screens: readonly unknown[];
  transitions: readonly unknown[];
  currentScreenId?: string;
}): DebugBugDiscoverySummary {
  const scope = session.scope as Record<string, unknown>;
  const projected = {
    id: session.id,
    name: session.name,
    targetId: session.targetId,
    status: session.status,
    scope: {
      maxScreens: scope.maxScreens as number,
      maxTransitions: scope.maxTransitions as number,
      maxDurationMs: scope.maxDurationMs as number,
    },
    screenCount: session.screens.length,
    transitionCount: session.transitions.length,
    ...(session.currentScreenId ? { currentScreenId: session.currentScreenId } : {}),
  };
  return projected;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: values.length }, () => undefined as R);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function measureBoundedTracePack(pack: TracePack): number {
  if (pack.objects.length > VERIFY_CHANGE_MAX_PACK_OBJECTS) {
    throw new TypeError(
      `Verify change TracePack exceeds ${VERIFY_CHANGE_MAX_PACK_OBJECTS} objects.`,
    );
  }
  return measureTracePackJson(pack, TRACE_PACK_OFFLINE_TRANSPORT_LIMITS).serializedBytes;
}

function assertBoundedTracePacks(packs: readonly TracePack[]): void {
  if (packs.length > VERIFY_CHANGE_MAX_TRACE_PACKS) {
    throw new TypeError(
      `Verify change accepts at most ${VERIFY_CHANGE_MAX_TRACE_PACKS} TracePacks.`,
    );
  }
  let totalBytes = 0;
  for (const pack of packs) {
    totalBytes += measureBoundedTracePack(pack);
    if (totalBytes > VERIFY_CHANGE_MAX_TOTAL_PACK_BYTES) {
      throw new TypeError("Verify change TracePacks exceed 128 MiB in aggregate.");
    }
  }
}

function uniqueBoundedIds(values: readonly string[], label: string): string[] {
  if (values.length > VERIFY_CHANGE_MAX_IDS) {
    throw new TypeError(`${label} accepts at most ${VERIFY_CHANGE_MAX_IDS} ids.`);
  }
  const unique = [...new Set(values)].sort();
  if (unique.length > VERIFY_CHANGE_MAX_IDS) {
    throw new TypeError(`${label} accepts at most ${VERIFY_CHANGE_MAX_IDS} unique ids.`);
  }
  return unique;
}

function publicRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function publicString(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    throw new TypeError(`${label} must be between 1 and ${maxChars} characters.`);
  }
  return value;
}

function publicNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function optionalPublicNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : publicNumber(value, label);
}

function failureRunSummary(value: unknown, expectedRunId: string): FailureRunSummary {
  const run = publicRecord(value, "Failure Run");
  const id = publicString(run.id, "Failure Run id", PUBLIC_ID_MAX_CHARS);
  if (id !== expectedRunId) throw new TypeError("Relay returned a different Run for inspection.");
  const startedAt = optionalPublicNumber(run.startedAt, "Failure Run startedAt");
  const finishedAt = optionalPublicNumber(run.finishedAt, "Failure Run finishedAt");
  const error =
    run.error === undefined
      ? undefined
      : publicString(run.error, "Failure Run error", PUBLIC_ERROR_MAX_CHARS);
  return {
    id,
    action: publicString(run.action, "Failure Run action", PUBLIC_LABEL_MAX_CHARS),
    status: publicString(run.status, "Failure Run status", PUBLIC_LABEL_MAX_CHARS),
    queuedAt: publicNumber(run.queuedAt, "Failure Run queuedAt"),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(error === undefined ? {} : { error }),
  };
}

function failureEvidenceSummary(value: unknown, expectedRunId: string): FailureEvidenceSummary {
  const evidence = publicRecord(value, "Failure evidence");
  if (evidence.runId !== undefined && evidence.runId !== expectedRunId) {
    throw new TypeError("Relay returned evidence for a different Run.");
  }
  const events = evidence.events === undefined ? [] : evidence.events;
  if (!Array.isArray(events)) throw new TypeError("Failure evidence events must be an array.");
  const channelRecord =
    evidence.channels === undefined
      ? {}
      : publicRecord(evidence.channels, "Failure evidence channels");
  const channels = Object.keys(channelRecord).sort();
  if (channels.length > PUBLIC_EVIDENCE_CHANNELS_MAX) {
    throw new TypeError(
      `Failure evidence exceeds ${PUBLIC_EVIDENCE_CHANNELS_MAX} public channels.`,
    );
  }
  channels.forEach((channel) =>
    publicString(channel, "Failure evidence channel", PUBLIC_LABEL_MAX_CHARS),
  );
  return { runId: expectedRunId, eventCount: events.length, channels };
}

function repairProposal(
  value: CampaignRepairTargetSummary,
  expectedRunId: string,
): FailureRepairProposal {
  const runId = publicString(value.source.runId, "Repair Run id", PUBLIC_ID_MAX_CHARS);
  if (runId !== expectedRunId) {
    throw new TypeError("Relay returned a repair proposal for a different Run.");
  }
  if (!Number.isInteger(value.priorAttemptCount) || value.priorAttemptCount < 0) {
    throw new TypeError("Repair priorAttemptCount must be a non-negative integer.");
  }
  return {
    id: publicString(value.id, "Repair id", PUBLIC_ID_MAX_CHARS),
    runId,
    checkId: publicString(value.source.checkId, "Repair check id", PUBLIC_ID_MAX_CHARS),
    checkTitle: publicString(value.source.checkTitle, "Repair check title", PUBLIC_LABEL_MAX_CHARS),
    error: publicString(value.error, "Repair error", PUBLIC_ERROR_MAX_CHARS),
    priorAttemptCount: value.priorAttemptCount,
  };
}

function revisionMatches(candidate: unknown, expected: SourceRevision): boolean {
  if (!candidate || typeof candidate !== "object") return false;
  const value = candidate as Partial<SourceRevision>;
  return (
    value.vcs === expected.vcs &&
    value.sha === expected.sha &&
    (expected.prNumber === undefined || value.prNumber === expected.prNumber) &&
    (expected.branch === undefined || value.branch === expected.branch) &&
    (expected.artifactDigest === undefined || value.artifactDigest === expected.artifactDigest)
  );
}

class CanonicalRelayOutcomeJobs implements RelayOutcomeJobs {
  private readonly operations: RelayOperationPort;
  private readonly workflows;

  constructor(
    client: RelayInvokeClient,
    private readonly options: RelayOutcomeJobOptions,
  ) {
    this.operations = createRelayOperationPort(client);
    this.workflows = createRelayWorkflows(client);
    this.eventSource = client.events
      ? (client as RelayInvokeClient & WorkflowEventSource)
      : undefined;
  }

  private readonly eventSource?: WorkflowEventSource;

  async connect(intent: ConnectTargetIntent = { kind: "connect-target" }) {
    const catalog = await targetCatalog(this.operations);
    const available = catalog.flatMap(({ target }) => (target ? [target] : []));
    const current = intent.targetId
      ? available.find((target) => target.targetId === intent.targetId)
      : available.length === 1
        ? available[0]
        : undefined;
    if (intent.targetId && !current) {
      await selectTarget(this.operations, intent.targetId);
      throw new TypeError(`Target ${intent.targetId} is not ready.`);
    }
    return {
      targets: available,
      ...(current ? { current } : {}),
    } satisfies ConnectTargetResult;
  }

  async observe(intent: ObserveTargetIntent = { kind: "observe-target" }) {
    const target = await selectTarget(this.operations, intent.targetId);
    const observation = await this.operations.invoke("target.observation.capture", {
      serial: target.targetId,
    });
    if (
      observation.target.targetId !== target.targetId ||
      observation.target.platform !== target.platform
    ) {
      throw new TypeError("Relay returned durable evidence for a different target.");
    }
    if (observation.pixels.status === "captured" && observation.pixels.presentationBase64) {
      const { presentationBase64, ...boundedPixels } = observation.pixels;
      // Native MCP presentation may read this property, but normal workflow
      // and CLI JSON serialization must stay artifact-referenced and bounded.
      Object.defineProperty(boundedPixels, "presentationBase64", {
        value: presentationBase64,
        enumerable: false,
      });
      return { ...observation, pixels: boundedPixels };
    }
    return observation;
  }

  async record(intent: RecordTestOutcomeIntent) {
    if (intent.confirmControl !== true) {
      throw new TypeError(
        "Recording requires explicit confirmation before Relay acquires control.",
      );
    }
    const target = await selectTarget(this.operations, intent.targetId);
    const appMapId = await selectAppMap(this.operations, intent.appMapId, intent.title);
    const leaseId = await acquireOwnLease(this.operations, this.options.actorId, target.targetId);
    return this.workflows.start({
      kind: "author-test",
      actorId: this.options.actorId,
      title: intent.title,
      appMapId,
      target,
      leaseId,
      revision: "current",
      ...recordingPathContext(intent),
      workflowRequestId: crypto.randomUUID(),
      continuation: "durable",
    });
  }

  async run(intent: RunTestOutcomeIntent) {
    const appMapId = await selectAppMap(this.operations, intent.appMapId);
    const target = await selectTarget(this.operations, intent.targetId);
    return this.workflows.start({
      kind: "run-test",
      appMapId,
      testId: intent.testId,
      target,
      revision: "current",
      workflowRequestId: crypto.randomUUID(),
      continuation: "durable",
      ...(intent.confirmRisk ? { confirmRisk: true } : {}),
    });
  }

  async repeat(intent: RepeatTestOutcomeIntent) {
    const appMapId = await selectAppMap(this.operations, intent.appMapId);
    const target = await selectTarget(this.operations, intent.targetId);
    return this.workflows.start({
      kind: "repeat-test",
      actorId: this.options.actorId,
      appMapId,
      testId: intent.testId,
      target,
      revision: "current",
      repeat: structuredClone(intent.repeat),
      workflowRequestId: crypto.randomUUID(),
      continuation: "durable",
      ...(intent.evidence ? { evidence: intent.evidence } : {}),
      ...(intent.confirmRisk ? { confirmRisk: true } : {}),
    });
  }

  async inspectFailure(intent: InspectFailureIntent): Promise<FailureInspection> {
    const [run, evidence, repairs] = await Promise.all([
      this.operations.invoke("run.get", { runId: intent.runId }),
      this.operations.invoke("run.evidence.get", { runId: intent.runId }),
      this.operations.invoke("run.repair.list", { limit: 500 }),
    ]);
    return {
      runId: intent.runId,
      run: failureRunSummary(run.run, intent.runId),
      evidence: failureEvidenceSummary(evidence.evidence, intent.runId),
      repairProposals: repairs.repairs
        .filter((repair) => repair.source.runId === intent.runId)
        .map((repair) => repairProposal(repair, intent.runId)),
    };
  }

  async debugBug(intent: DebugBugOutcomeIntent): Promise<DebugBugOutcome> {
    if (intent.action === "start") {
      return startDebugBugRecording(this, this.options.actorId, intent);
    }
    if (intent.action === "explore") {
      boundedDebugBugDiscovery(intent);
      const created = await this.operations.invoke("discovery.create", intent.create);
      if (created.session.id !== intent.create.id && intent.create.id !== undefined) {
        throw new TypeError("Relay returned a different Agent Debug discovery session.");
      }
      if (created.session.targetId !== intent.create.targetId) {
        throw new TypeError("Relay returned an Agent Debug session for a different target.");
      }
      const session = intent.start
        ? (await this.operations.invoke("discovery.start", intent.start)).session
        : created.session;
      if (session.id !== created.session.id) {
        throw new TypeError("Relay returned a different Agent Debug discovery session.");
      }
      if (session.targetId !== intent.create.targetId) {
        throw new TypeError("Relay started Agent Debug on a different target.");
      }
      return {
        schemaVersion: 1,
        kind: "debug-bug",
        action: "explore",
        actorId: this.options.actorId,
        nextAction: "review-discovery",
        session: projectDebugBugDiscovery(session),
      };
    }
    if (intent.action === "run") {
      const run = await this.run({ ...intent, kind: "run-test" });
      return {
        schemaVersion: 1,
        kind: "debug-bug",
        action: "run",
        actorId: this.options.actorId,
        nextAction: "inspect-run",
        run,
      };
    }
    if (intent.action === "inspect") {
      const failure = await this.inspectFailure({ kind: "inspect-failure", runId: intent.runId });
      return {
        schemaVersion: 1,
        kind: "debug-bug",
        action: "inspect",
        actorId: this.options.actorId,
        nextAction: failure.repairProposals.length ? "review-repair" : "verify-change",
        failure,
        clustering: {
          status: "unavailable",
          reason:
            "Relay has no canonical failure-clustering operation; this outcome preserves the immutable evidence and repair queue without inferring a cluster.",
        },
      };
    }
    if (intent.action === "propose-repair") {
      const repair = await this.proposeRepair({
        ...intent,
        kind: "propose-repair",
        reason: boundedDebugBugText(intent.reason, "Repair reason"),
      });
      return {
        schemaVersion: 1,
        kind: "debug-bug",
        action: "propose-repair",
        actorId: this.options.actorId,
        nextAction: "human-review",
        repair,
      };
    }
    if (intent.action === "verify") {
      const verification = await this.verifyChange({
        kind: "verify-change",
        selection: intent.selection,
        ...(intent.confirmationSatisfied === true ? { confirmationSatisfied: true } : {}),
      });
      return {
        schemaVersion: 1,
        kind: "debug-bug",
        action: "verify",
        actorId: this.options.actorId,
        nextAction: "inspect-verdict",
        verification,
      };
    }
    const evidence = await this.exportEvidence({ kind: "export-evidence", runId: intent.runId });
    return {
      schemaVersion: 1,
      kind: "debug-bug",
      action: "export",
      actorId: this.options.actorId,
      nextAction: "share-proof",
      evidence,
    };
  }

  async proposeRepair(intent: ProposeRepairIntent): Promise<RepairProposalResult> {
    const result = await this.operations.invoke("run.repair.propose", {
      runId: intent.runId,
      checkId: intent.checkId,
      kind: intent.proposal,
      reason: intent.reason,
    });
    const repairTargetId = publicString(result.repair.id, "Repair target id", PUBLIC_ID_MAX_CHARS);
    if (
      result.repair.source.runId !== intent.runId ||
      result.repair.source.checkId !== intent.checkId
    ) {
      throw new TypeError("Relay returned a repair proposal for a different failed check.");
    }
    return {
      proposalId: publicString(result.proposalId, "Proposal id", PUBLIC_ID_MAX_CHARS),
      repairTargetId,
      runId: intent.runId,
      checkId: intent.checkId,
      proposal: intent.proposal,
      reviewRequired: true,
    };
  }

  async exportEvidence(intent: ExportEvidenceIntent): Promise<TracePackExportResponse> {
    const result = await this.operations.invoke("run.trace-pack.get", { runId: intent.runId });
    measureBoundedTracePack(result.tracePack);
    if (
      result.tracePack.source.runId !== intent.runId ||
      result.analysis.sourceRunId !== intent.runId
    ) {
      throw new TypeError("Relay returned TracePack evidence for a different Run.");
    }
    if (result.analysis.tracePackDigest !== result.tracePack.digest) {
      throw new TypeError("Relay returned TracePack analysis for a different evidence digest.");
    }
    return result;
  }

  replayLab(intent: ReplayLabOutcomeIntent) {
    return runReplayLab(intent);
  }

  async verifyChange(intent: VerifyChangeOutcomeIntent) {
    const selection = intent.selection;
    if (selection.kind === "tests") {
      const testIds = uniqueBoundedIds(selection.testIds, "Verify change Test selection");
      const { appMap } = await this.operations.invoke("app-map.get", {
        appMapId: selection.appMapId,
      });
      const tests = testIds.flatMap((testId) => {
        const test = appMap.tests[testId];
        return test ? [{ appMap, test }] : [];
      });
      const missing = testIds
        .filter((testId) => !appMap.tests[testId])
        .map((testId) => `affected-test-not-found:${selection.appMapId}:${testId}`);
      return verifyChangeOffline({
        selectionKind: "tests",
        tests,
        confirmationSatisfied: intent.confirmationSatisfied,
        selectionUncertainty: missing,
      });
    }

    let tracePacks: readonly TracePack[];
    let selectionUncertainty: string[] = [];
    if (selection.kind === "trace-packs") {
      tracePacks = selection.tracePacks;
      assertBoundedTracePacks(tracePacks);
    } else {
      let runIds: readonly string[];
      if (selection.kind === "runs") {
        runIds = uniqueBoundedIds(selection.runIds, "Verify change Run selection");
      } else {
        const { runs } = await this.operations.invoke("run.list", {
          limit: VERIFY_CHANGE_MAX_IDS + 1,
          ...(selection.appMapId ? { appMapId: selection.appMapId } : {}),
        });
        const matchingRunIds = runs
          .filter((run) => revisionMatches(run.sourceRevision, selection.sourceRevision))
          .map((run) => run.id)
          .sort();
        runIds = matchingRunIds.slice(0, VERIFY_CHANGE_MAX_IDS);
        if (matchingRunIds.length > VERIFY_CHANGE_MAX_IDS) {
          selectionUncertainty.push(
            `affected-test-selection-truncated:source-revision:${selection.sourceRevision.sha}`,
          );
        }
        if (!runIds.length) {
          selectionUncertainty.push(
            `affected-test-selection-unavailable:source-revision:${selection.sourceRevision.sha}`,
          );
        }
      }
      let totalBytes = 0;
      tracePacks = await mapWithConcurrency(
        runIds,
        VERIFY_CHANGE_READ_CONCURRENCY,
        async (runId) => {
          const { tracePack } = await this.operations.invoke("run.trace-pack.get", { runId });
          totalBytes += measureBoundedTracePack(tracePack);
          if (totalBytes > VERIFY_CHANGE_MAX_TOTAL_PACK_BYTES) {
            throw new TypeError("Verify change TracePacks exceed 128 MiB in aggregate.");
          }
          return tracePack;
        },
      );
    }
    return verifyChangeOffline({
      selectionKind: selection.kind,
      tracePacks,
      ...(selection.kind === "source-revision" ? { sourceRevision: selection.sourceRevision } : {}),
      confirmationSatisfied: intent.confirmationSatisfied,
      selectionUncertainty,
    });
  }

  proveChange(intent: ProveChangeOutcomeIntent) {
    if (!intent.proofId) {
      return this.operations.invoke("proof.prepare", {
        ...(intent.baseRef ? { baseRef: intent.baseRef } : {}),
        ...(intent.pullRequest ? { pullRequest: intent.pullRequest } : {}),
        ...(intent.agentClaim ? { agentClaim: intent.agentClaim } : {}),
        ...(intent.policy ? { policy: intent.policy } : {}),
        ...(intent.targetIds ? { targetIds: intent.targetIds } : {}),
        ...(intent.buildIds ? { buildIds: intent.buildIds } : {}),
      });
    }
    return this.operations.invoke("proof.run", {
      proofId: intent.proofId,
      ...(intent.expectedVersion === undefined ? {} : { expectedVersion: intent.expectedVersion }),
      ...(intent.wait === undefined ? {} : { wait: intent.wait }),
    });
  }

  inspectProof(intent: InspectProofOutcomeIntent) {
    return this.operations.invoke("proof.inspect", {
      proofId: intent.proofId,
      ...(intent.includeHistory === undefined ? {} : { includeHistory: intent.includeHistory }),
    });
  }

  inspect(input: Parameters<RelayOutcomeJobs["inspect"]>[0]) {
    return "workflowId" in input
      ? this.workflows.inspectDurable(input.workflowId)
      : this.workflows.inspect(input.legacyRef);
  }

  watchWorkflow(input: Parameters<RelayOutcomeJobs["watchWorkflow"]>[0]) {
    return watchWorkflow({
      ...input,
      source: this.eventSource,
      inspect: () => this.workflows.inspectDurable(input.workflowId),
    });
  }

  cancelRun(input: Parameters<RelayOutcomeJobs["cancelRun"]>[0]) {
    if (input.confirmCancel !== true) {
      throw new TypeError("Cancelling a Run requires explicit confirmation.");
    }
    return this.workflows.cancelRun({
      workflowId: input.workflowId,
      expectedVersion: input.expectedVersion,
    });
  }

  async continueRepeat(input: Parameters<RelayOutcomeJobs["continueRepeat"]>[0]) {
    const snapshot = await this.workflows.advanceRepeat({
      workflowId: input.workflowId,
      expectedVersion: input.expectedVersion,
      action: "confirm-and-continue",
    });
    if (snapshot.kind !== "repeat-test") {
      throw new TypeError("The workflow reference does not identify a Repeat.");
    }
    return snapshot;
  }

  async advanceRecording(decision: Parameters<RelayOutcomeJobs["advanceRecording"]>[0]) {
    return this.workflows.advanceAuthoring(decision);
  }

  editRecording(intent: Parameters<RelayOutcomeJobs["editRecording"]>[0]) {
    return this.advanceRecording({
      action: "edit",
      workflowId: intent.workflowId,
      expectedVersion: intent.expectedVersion,
      edit: structuredClone(intent.edit),
    });
  }
}

export function createRelayOutcomeJobs(
  client: RelayInvokeClient,
  options: RelayOutcomeJobOptions,
): RelayOutcomeJobs {
  if (!options.actorId.trim()) throw new TypeError("Outcome jobs require a Relay actor identity.");
  return new CanonicalRelayOutcomeJobs(client, options);
}

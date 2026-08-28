import { verifyChangeOffline } from "@relay/core/verify-change";
import {
  measureTracePackJson,
  TRACE_PACK_OFFLINE_TRANSPORT_LIMITS,
  VERIFY_CHANGE_MAX_IDS,
  VERIFY_CHANGE_MAX_TRACE_PACKS,
  type AuthoringTarget,
  type DeviceLease,
  type DeviceSummary,
  type SourceRevision,
  type TracePack,
} from "@relay/protocol";
import type { RelayOperationPort } from "./operation-port.js";
import { createRelayOperationPort, type RelayInvokeClient } from "./operation-port.js";
import { createRelayWorkflows } from "./relay-workflows.js";
import type {
  ConnectTargetIntent,
  ConnectTargetResult,
  ExportEvidenceIntent,
  FailureInspection,
  InspectFailureIntent,
  ObserveTargetIntent,
  ProposeRepairIntent,
  RecordTestOutcomeIntent,
  RelayOutcomeJobs,
  RepeatTestOutcomeIntent,
  ReplayLabOutcomeIntent,
  RunTestOutcomeIntent,
  VerifyChangeOutcomeIntent,
} from "./types.js";
import { runReplayLab } from "./replay-lab.js";

export type RelayOutcomeJobOptions = { actorId: string };

const VERIFY_CHANGE_READ_CONCURRENCY = 4;
const VERIFY_CHANGE_MAX_TOTAL_PACK_BYTES = 128 * 1024 * 1024;
const VERIFY_CHANGE_MAX_PACK_OBJECTS = 2_000;

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

function runnableTarget(device: DeviceSummary): AuthoringTarget | undefined {
  if (device.platform !== "android" && device.platform !== "ios") return undefined;
  if (device.booted === false || device.connectionState === "disconnected") return undefined;
  return { kind: "device", platform: device.platform, targetId: device.serial || device.id };
}

async function targets(operations: RelayOperationPort): Promise<AuthoringTarget[]> {
  const output = await operations.invoke("target.devices.list", {});
  return output.devices.flatMap((device) => {
    const target = runnableTarget(device);
    return target ? [target] : [];
  });
}

async function selectTarget(
  operations: RelayOperationPort,
  targetId?: string,
): Promise<AuthoringTarget> {
  const available = await targets(operations);
  if (targetId) {
    const selected = available.find((target) => target.targetId === targetId);
    if (selected) return selected;
    throw new TypeError(`Target ${targetId} is not a connected Android or iOS device.`);
  }
  if (available.length === 1) return available[0]!;
  throw new TypeError(
    available.length === 0
      ? "No connected Android or iOS target is ready."
      : `Target selection is ambiguous: ${available.length} devices are ready. Choose one by id.`,
  );
}

async function selectAppMap(
  operations: RelayOperationPort,
  requestedId: string | undefined,
  createForRecordingTitle?: string,
): Promise<string> {
  if (requestedId?.trim()) {
    await operations.invoke("app-map.get", { appMapId: requestedId });
    return requestedId;
  }
  const { appMaps } = await operations.invoke("app-map.list", {});
  if (appMaps.length === 1) return appMaps[0]!.id;
  if (appMaps.length === 0 && createForRecordingTitle) {
    const { appMap } = await operations.invoke("app-map.create", {
      appMapId: "default",
      name: createForRecordingTitle,
    });
    return appMap.id;
  }
  throw new TypeError(
    appMaps.length === 0
      ? "No App Map exists. Record the first Test before running one."
      : `App Map selection is ambiguous: ${appMaps.length} maps exist. Choose one by id.`,
  );
}

function activeLeaseForTarget(
  leases: readonly DeviceLease[],
  targetId: string,
): DeviceLease | undefined {
  return leases.find((lease) => lease.deviceSerial === targetId && lease.status === "leased");
}

async function acquireOwnLease(
  operations: RelayOperationPort,
  actorId: string,
  targetId: string,
): Promise<string> {
  const { leases } = await operations.invoke("lease.list", { status: "active" });
  const active = activeLeaseForTarget(leases, targetId);
  if (active) {
    if (active.ownerId !== actorId) {
      throw new TypeError(
        `${targetId} is controlled by ${active.ownerId}. Relay will not take over that lease implicitly.`,
      );
    }
    return active.id;
  }
  const { lease } = await operations.invoke("lease.create", {
    poolId: "local",
    deviceSerial: targetId,
  });
  if (lease.ownerId !== actorId || lease.deviceSerial !== targetId || lease.status !== "leased") {
    throw new TypeError("Relay could not prove ownership of the acquired target lease.");
  }
  return lease.id;
}

function repairList(value: unknown, runId: string): unknown[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const candidates = Array.isArray(record.proposals)
    ? record.proposals
    : Array.isArray(record.repairs)
      ? record.repairs
      : [];
  return candidates.filter(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      (!("runId" in candidate) || (candidate as { runId?: unknown }).runId === runId),
  );
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
  }

  async connect(intent: ConnectTargetIntent = { kind: "connect-target" }) {
    const available = await targets(this.operations);
    const current = intent.targetId
      ? available.find((target) => target.targetId === intent.targetId)
      : available.length === 1
        ? available[0]
        : undefined;
    if (intent.targetId && !current) {
      throw new TypeError(`Target ${intent.targetId} is not a connected Android or iOS device.`);
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
      run: run.run,
      evidence: evidence.evidence,
      repairProposals: repairList(repairs, intent.runId),
    };
  }

  proposeRepair(intent: ProposeRepairIntent) {
    return this.operations.invoke("run.repair.propose", {
      runId: intent.runId,
      checkId: intent.checkId,
      kind: intent.proposal,
      reason: intent.reason,
    });
  }

  exportEvidence(intent: ExportEvidenceIntent) {
    return this.operations.invoke("run.trace-pack.get", { runId: intent.runId });
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

  inspect(input: Parameters<RelayOutcomeJobs["inspect"]>[0]) {
    return "workflowId" in input
      ? this.workflows.inspectDurable(input.workflowId)
      : this.workflows.inspect(input.legacyRef);
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

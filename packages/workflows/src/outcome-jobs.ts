import type { AuthoringTarget, DeviceLease, DeviceSummary } from "@relay/protocol";
import type { RelayOperationPort } from "./operation-port.js";
import { createRelayOperationPort, type RelayInvokeClient } from "./operation-port.js";
import { createRelayWorkflows } from "./relay-workflows.js";
import type {
  ConnectTargetIntent,
  ConnectTargetResult,
  ExportEvidenceIntent,
  FailureInspection,
  InspectFailureIntent,
  ProposeRepairIntent,
  RecordTestOutcomeIntent,
  RelayOutcomeJobs,
  RepeatTestOutcomeIntent,
  RunTestOutcomeIntent,
} from "./types.js";

export type RelayOutcomeJobOptions = { actorId: string };

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
    });
  }

  async repeat(intent: RepeatTestOutcomeIntent) {
    const appMapId = await selectAppMap(this.operations, intent.appMapId);
    const target = await selectTarget(this.operations, intent.targetId);
    return this.workflows.start({
      kind: "repeat-test",
      appMapId,
      testId: intent.testId,
      target,
      revision: "current",
      over: { dimensionId: intent.over.dimensionId, valueIds: [...intent.over.valueIds] },
      ...(intent.evidence ? { evidence: intent.evidence } : {}),
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

  inspect(ref: Parameters<RelayOutcomeJobs["inspect"]>[0]) {
    return this.workflows.inspect(ref);
  }

  async continueRepeat(input: Parameters<RelayOutcomeJobs["continueRepeat"]>[0]) {
    const snapshot = await this.workflows.advance({
      ref: input.ref,
      expectedVersion: input.expectedVersion,
      action: "confirm-and-continue",
    });
    if (snapshot.kind !== "repeat-test") {
      throw new TypeError("The workflow reference does not identify a Repeat.");
    }
    return snapshot;
  }

  async advanceRecording(decision: Parameters<RelayOutcomeJobs["advanceRecording"]>[0]) {
    const snapshot = await this.workflows.advance(decision);
    if (snapshot.kind !== "author-test") {
      throw new TypeError("The workflow reference does not identify a recording.");
    }
    return snapshot;
  }
}

export function createRelayOutcomeJobs(
  client: RelayInvokeClient,
  options: RelayOutcomeJobOptions,
): RelayOutcomeJobs {
  if (!options.actorId.trim()) throw new TypeError("Outcome jobs require a Relay actor identity.");
  return new CanonicalRelayOutcomeJobs(client, options);
}

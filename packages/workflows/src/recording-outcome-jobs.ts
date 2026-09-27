import type { AuthorTestSnapshot, DebugBugOutcome, DebugBugOutcomeIntent } from "./types.js";
import { CanonicalAuthoringWorkflow } from "./authoring-workflow.js";
import { createRelayOperationPort, type RelayInvokeClient } from "./operation-port.js";
import { recordingPathContext } from "./recording-path-context.js";
import { acquireOwnLease, selectAppMap, selectTarget, targetCatalog } from "./target-catalog.js";
import type {
  ConnectTargetIntent,
  ConnectTargetResult,
  DurableAuthorTestDecision,
  RecordTestOutcomeIntent,
} from "./types.js";

export type RelayRecordingOutcomeJobs = {
  connect(intent?: ConnectTargetIntent): Promise<ConnectTargetResult>;
  record(intent: RecordTestOutcomeIntent): Promise<AuthorTestSnapshot>;
  inspect(input: { workflowId: string }): Promise<AuthorTestSnapshot>;
  advanceRecording(decision: DurableAuthorTestDecision): Promise<AuthorTestSnapshot>;
};

type DebugBugStartIntent = Extract<DebugBugOutcomeIntent, { action: "start" }>;
type DebugBugStartOutcome = Extract<DebugBugOutcome, { action: "start" }>;

/** Shared browser-safe projection for the recording entry point of Agent Debug.
 * Both the complete outcome facade and the React adapter use this exact path,
 * while offline Proof dependencies remain outside the renderer bundle. */
export async function startDebugBugRecording(
  jobs: Pick<RelayRecordingOutcomeJobs, "record">,
  actorId: string,
  intent: DebugBugStartIntent,
): Promise<DebugBugStartOutcome> {
  const { action: _action, kind: _kind, ...recordIntent } = intent;
  const recording = await jobs.record({ ...recordIntent, kind: "record-test" });
  return {
    schemaVersion: 1,
    kind: "debug-bug",
    action: "start",
    actorId,
    nextAction: "review-recording",
    recording,
  };
}

/** Browser-safe outcome boundary for the Product recording journey.
 *
 * Keeping this module separate is deliberate: importing the complete outcome
 * job collection also brings offline proof and replay analysis into a web
 * renderer. Recording only needs target selection and the canonical durable
 * authoring workflow.
 */
export function createRelayRecordingOutcomeJobs(
  client: RelayInvokeClient,
  options: { actorId: string },
): RelayRecordingOutcomeJobs {
  if (!options.actorId.trim()) throw new TypeError("Outcome jobs require a Relay actor identity.");
  const operations = createRelayOperationPort(client);
  const authoring = new CanonicalAuthoringWorkflow(operations);
  return {
    async connect(intent = { kind: "connect-target" }) {
      const catalog = await targetCatalog(operations);
      const available = catalog.flatMap(({ target }) => (target ? [target] : []));
      const current = intent.targetId
        ? available.find((target) => target.targetId === intent.targetId)
        : available.length === 1
          ? available[0]
          : undefined;
      if (intent.targetId && !current) {
        await selectTarget(operations, intent.targetId);
        throw new TypeError(`Target ${intent.targetId} is not ready.`);
      }
      return {
        targets: available,
        ...(current ? { current } : {}),
      } satisfies ConnectTargetResult;
    },
    async record(intent) {
      if (intent.confirmControl !== true) {
        throw new TypeError(
          "Recording requires explicit confirmation before Relay acquires control.",
        );
      }
      const target = recordingTarget(
        await selectTarget(operations, intent.targetId),
        intent.authenticationFixtureId,
        intent.liveSessionId,
      );
      const appMapId = await selectAppMap(operations, intent.appMapId, intent.title);
      const leaseId = await acquireOwnLease(operations, options.actorId, target.targetId);
      return authoring.start({
        kind: "author-test",
        actorId: options.actorId,
        title: intent.title,
        appMapId,
        target,
        ...(intent.originApplication?.trim()
          ? { originApplication: intent.originApplication.trim() }
          : {}),
        leaseId,
        revision: "current",
        ...recordingPathContext(intent),
        workflowRequestId: crypto.randomUUID(),
        continuation: "durable",
      });
    },
    inspect: ({ workflowId }) => authoring.inspectDurable(workflowId),
    advanceRecording: (decision) => authoring.advanceDurable(decision),
  };
}

/** The target a recording controls, signed in with a saved login when chosen. */
export function recordingTarget<T extends { kind: "device" | "browser" }>(
  selected: T,
  authenticationFixtureId?: string,
  liveSessionId?: string,
): T & { authenticationFixtureId?: string; liveSessionId?: string } {
  const account = authenticationFixtureId?.trim();
  const live = liveSessionId?.trim();
  if (!account && !live) return selected;
  if (selected.kind !== "browser") {
    throw new TypeError("Only a browser recording can use a saved login or live session.");
  }
  return {
    ...selected,
    ...(account ? { authenticationFixtureId: account } : {}),
    ...(live ? { liveSessionId: live } : {}),
  };
}

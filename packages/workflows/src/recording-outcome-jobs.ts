import type { AuthorTestSnapshot } from "./types.js";
import { CanonicalAuthoringWorkflow } from "./authoring-workflow.js";
import { createRelayOperationPort, type RelayInvokeClient } from "./operation-port.js";
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

/** Browser-safe outcome boundary for the Product V2 recording journey.
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
      const target = await selectTarget(operations, intent.targetId);
      const appMapId = await selectAppMap(operations, intent.appMapId, intent.title);
      const leaseId = await acquireOwnLease(operations, options.actorId, target.targetId);
      return authoring.start({
        kind: "author-test",
        actorId: options.actorId,
        title: intent.title,
        appMapId,
        target,
        leaseId,
        revision: "current",
        workflowRequestId: crypto.randomUUID(),
        continuation: "durable",
      });
    },
    inspect: ({ workflowId }) => authoring.inspectDurable(workflowId),
    advanceRecording: (decision) => authoring.advanceDurable(decision),
  };
}

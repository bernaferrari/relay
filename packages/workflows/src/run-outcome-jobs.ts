import { createRelayOperationPort, type RelayInvokeClient } from "./operation-port.js";
import { createRelayWorkflows } from "./relay-workflows.js";
import { watchWorkflow, type WorkflowEventSource } from "./workflow-watch.js";
import { selectAppMap, selectTarget } from "./target-catalog.js";
import type {
  CancelRunOutcomeIntent,
  RunTestOutcomeIntent,
  RunTestSnapshot,
  WorkflowSnapshot,
} from "./types.js";

export type RelayRunOutcomeJobs = {
  /** Start one durable Run after Relay verifies the selected target. */
  run(intent: RunTestOutcomeIntent): Promise<RunTestSnapshot>;
  /** Read one server-owned workflow by its durable identity. */
  inspect(input: { workflowId: string }): Promise<RunTestSnapshot>;
  /** Follow server-owned progress; events remain invalidation hints only. */
  watchWorkflow(input: {
    workflowId: string;
    initial: WorkflowSnapshot;
    signal?: AbortSignal;
    onSnapshot?: (snapshot: WorkflowSnapshot) => void;
    disconnectedRefreshMs?: number;
    reconnectMs?: number;
  }): Promise<WorkflowSnapshot>;
  /** Cancel with the latest CAS version and explicit consent. */
  cancelRun(input: CancelRunOutcomeIntent): Promise<RunTestSnapshot>;
};

export type RelayRunOutcomeJobOptions = { actorId: string };

/**
 * Browser-safe Run seam for Product.
 *
 * This is deliberately separate from the complete outcome collection. The
 * renderer needs only the durable Run lifecycle, target readiness, and the
 * canonical workflow watcher. Keeping that interface here prevents a web
 * bundle from importing proof verification, replay analysis, or other host
 * and native-facing outcome code by accident.
 */
export function createRelayRunOutcomeJobs(
  client: RelayInvokeClient,
  options: RelayRunOutcomeJobOptions,
): RelayRunOutcomeJobs {
  if (!options.actorId.trim())
    throw new TypeError("Run outcome jobs require a Relay actor identity.");

  const operations = createRelayOperationPort(client);
  const workflows = createRelayWorkflows(client);
  const eventSource = client.events
    ? (client as RelayInvokeClient & WorkflowEventSource)
    : undefined;

  return {
    async run(intent) {
      const appMapId = await selectAppMap(operations, intent.appMapId);
      // selectTarget performs the canonical target catalog lookup and, for
      // managed browsers, registration plus target.preflight verification.
      const target = await selectTarget(operations, intent.targetId);
      return workflows.start({
        kind: "run-test",
        appMapId,
        testId: intent.testId,
        target,
        revision: intent.revision ?? "current",
        ...(intent.targetProfileId ? { targetProfileId: intent.targetProfileId } : {}),
        ...(intent.startup ? { startup: intent.startup } : {}),
        ...(intent.sourceRevision ? { sourceRevision: intent.sourceRevision } : {}),
        ...(intent.engine ? { engine: intent.engine } : {}),
        ...(intent.account ? { account: intent.account } : {}),
        workflowRequestId: crypto.randomUUID(),
        continuation: "durable",
        ...(intent.confirmRisk ? { confirmRisk: true } : {}),
      });
    },

    async inspect({ workflowId }) {
      const snapshot = await workflows.inspectDurable(workflowId);
      if (snapshot.kind !== "run-test") {
        throw new TypeError("The durable workflow is not a Test Run.");
      }
      return snapshot;
    },

    watchWorkflow(input) {
      return watchWorkflow({
        ...input,
        source: eventSource,
        inspect: async () => {
          const snapshot = await workflows.inspectDurable(input.workflowId);
          if (snapshot.kind !== "run-test") {
            throw new TypeError("The durable workflow is not a Test Run.");
          }
          return snapshot;
        },
      });
    },

    async cancelRun(input) {
      if (input.confirmCancel !== true) {
        throw new TypeError("Cancelling a Run requires explicit confirmation.");
      }
      return workflows.cancelRun({
        workflowId: input.workflowId,
        expectedVersion: input.expectedVersion,
      });
    },
  };
}

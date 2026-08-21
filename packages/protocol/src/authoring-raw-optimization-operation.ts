import {
  assertAuthoringSessionRef,
  parseAuthoringRawOptimizationProposalResponse,
  type AuthoringRawOptimizationProposalResponse,
} from "./authoring.js";
import type { OperationDefinition, RuntimeParser } from "./operation-contract.js";
import { objectParser } from "./operation-parser-primitives.js";

const input = objectParser<{ sessionId: string }>(
  "authoring raw optimization input",
  assertAuthoringSessionRef,
);

const output: RuntimeParser<AuthoringRawOptimizationProposalResponse> = {
  description: "authoring raw optimization proposal response",
  parse: parseAuthoringRawOptimizationProposalResponse,
};

/** An offline review surface over immutable redacted raw capture. It cannot
 * initiate device work or apply an edit to the Take it describes. */
export const authoringRawOptimizationOperationDefinition: OperationDefinition<"authoring.take.optimization.get"> =
  {
    id: "authoring.take.optimization.get",
    version: 1,
    label: "Get Raw Take Optimization Review",
    category: "authoring",
    mode: "query",
    input,
    output,
    idempotency: "inherent",
    targetCapabilities: [],
    lease: "none",
    confirmation: "none",
    minimumRole: "viewer",
    progress: false,
    cancellable: false,
    transport: { method: "GET", path: "/authoring-sessions/:sessionId/optimization-proposal" },
  };

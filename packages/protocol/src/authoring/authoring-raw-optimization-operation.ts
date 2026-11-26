import { type AuthoringRawOptimizationProposalResponse } from "./authoring.js";
import type { OperationDefinition, RuntimeParser } from "../operation/operation-contract.js";
import {
  operationInputContractFromSchema,
  operationOutputContractFromSchema,
} from "../operation/operation-builders.js";
import type { OperationInput, OperationOutput } from "../operation/operation-map.js";
export { authoringTakeEditOperationDefinition } from "./authoring-take-edit-operation.js";

const output: RuntimeParser<OperationOutput<"authoring.take.optimization.get">> =
  operationOutputContractFromSchema("authoring.take.optimization.get");

/** An offline review surface over immutable redacted raw capture. It cannot
 * initiate device work or apply an edit to the Take it describes. */
export const authoringRawOptimizationOperationDefinition: OperationDefinition<
  "authoring.take.optimization.get",
  OperationInput<"authoring.take.optimization.get">,
  AuthoringRawOptimizationProposalResponse
> = {
  id: "authoring.take.optimization.get",
  version: 1,
  label: "Get Raw Take Optimization Review",
  category: "authoring",
  mode: "query",
  input: operationInputContractFromSchema("authoring.take.optimization.get"),
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

import type { OperationDefinition } from "../operation/operation-contract.js";
import {
  operationInputContractFromSchema,
  operationOutputContractFromSchema,
} from "../operation/operation-builders.js";
import type { OperationInput, OperationOutput } from "../operation/operation-map.js";

export function createTargetObservationOperationDefinition(): OperationDefinition<
  "target.observation.capture",
  OperationInput<"target.observation.capture">,
  OperationOutput<"target.observation.capture">
> {
  return {
    id: "target.observation.capture",
    version: 1,
    label: "Capture durable target observation",
    category: "evidence",
    mode: "query",
    input: operationInputContractFromSchema("target.observation.capture"),
    output: operationOutputContractFromSchema("target.observation.capture"),
    idempotency: "inherent",
    targetCapabilities: ["screenshot", "snapshot"],
    lease: "none",
    confirmation: "none",
    minimumRole: "viewer",
    progress: false,
    cancellable: false,
    transport: { method: "GET", path: "/observation" },
  };
}

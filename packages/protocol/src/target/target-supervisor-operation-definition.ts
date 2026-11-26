import type { OperationDefinition } from "../operation/operation-contract.js";
import {
  operationInputContractFromSchema,
  operationOutputContractFromSchema,
} from "../operation/operation-builders.js";
import type { OperationInput, OperationOutput } from "../operation/operation-map.js";

export function createTargetSupervisorOperationDefinition(): OperationDefinition<
  "target.health.get",
  OperationInput<"target.health.get">,
  OperationOutput<"target.health.get">
> {
  const output = operationOutputContractFromSchema("target.health.get");
  return {
    id: "target.health.get",
    version: 1,
    label: "Read target health",
    category: "target",
    mode: "query",
    input: operationInputContractFromSchema("target.health.get"),
    output,
    idempotency: "inherent",
    targetCapabilities: [],
    lease: "none",
    confirmation: "none",
    minimumRole: "viewer",
    progress: false,
    cancellable: false,
    transport: { method: "GET", path: "/device/health" },
  };
}

export function createTargetInputReconciliationOperationDefinition(): OperationDefinition<
  "target.input.reconcile",
  OperationInput<"target.input.reconcile">,
  OperationOutput<"target.input.reconcile">
> {
  const output = operationOutputContractFromSchema("target.input.reconcile");
  return {
    id: "target.input.reconcile",
    version: 1,
    label: "Reconcile uncertain target input",
    category: "target",
    mode: "command",
    input: operationInputContractFromSchema("target.input.reconcile"),
    output,
    idempotency: "required",
    targetCapabilities: ["screenshot", "snapshot"],
    lease: "exclusive",
    confirmation: "confirm",
    minimumRole: "runner",
    progress: false,
    cancellable: false,
    transport: { method: "POST", path: "/device/input/reconcile" },
  };
}

export function createTargetInputReceiptGetOperationDefinition(): OperationDefinition<
  "target.input.receipt.get",
  OperationInput<"target.input.receipt.get">,
  OperationOutput<"target.input.receipt.get">
> {
  const output = operationOutputContractFromSchema("target.input.receipt.get");
  return {
    id: "target.input.receipt.get",
    version: 1,
    label: "Read a durable input reconciliation receipt",
    category: "target",
    mode: "query",
    input: operationInputContractFromSchema("target.input.receipt.get"),
    output,
    idempotency: "inherent",
    targetCapabilities: [],
    lease: "none",
    confirmation: "none",
    minimumRole: "viewer",
    progress: false,
    cancellable: false,
    transport: { method: "GET", path: "/device/input/receipt" },
  };
}

export function createTargetSupervisorOperationDefinitions() {
  return [
    createTargetSupervisorOperationDefinition(),
    createTargetInputReconciliationOperationDefinition(),
    createTargetInputReceiptGetOperationDefinition(),
  ] as const;
}

import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

type WorkflowOperationId = "workflow.create" | "workflow.get" | "workflow.transition";
const { command, query } = createOperationBuilders<Pick<RelayOperationMap, WorkflowOperationId>>();

export const workflowOperationDefinitions = [
  command("workflow.create", "Create durable workflow", "POST", "/workflows", {
    category: "execution",
    idempotency: "inherent",
  }),
  query("workflow.get", "Read durable workflow", "/workflows/:workflowId", {
    category: "execution",
    minimumRole: "viewer",
  }),
  command(
    "workflow.transition",
    "Transition durable workflow",
    "POST",
    "/workflows/:workflowId/transitions",
    { category: "execution", idempotency: "inherent" },
  ),
] as const;

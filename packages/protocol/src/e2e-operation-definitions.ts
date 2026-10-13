import { createOperationBuilders } from "./operation-builders.js";
import type { E2EOperationMap } from "./e2e-project.js";
const { query, command } = createOperationBuilders<E2EOperationMap>();
export const e2eOperationDefinitions = [
  query("e2e.project.list", "List e2e projects", "/e2e/projects"),
  command("e2e.project.open", "Trust and open e2e project", "POST", "/e2e/projects", {
    minimumRole: "admin",
  }),
  command("e2e.project.refresh", "Discover e2e Tests", "POST", "/e2e/projects/:projectId/refresh", {
    minimumRole: "admin",
  }),
  query("e2e.project.source", "Read trusted e2e source", "/e2e/projects/:projectId/source"),
  command("e2e.project.run", "Run upstream e2e", "POST", "/e2e/projects/:projectId/run", {
    category: "execution",
    minimumRole: "admin",
  }),
  query("e2e.execution.get", "Inspect e2e execution", "/e2e/executions/:executionId"),
  command(
    "e2e.execution.cancel",
    "Stop e2e execution",
    "POST",
    "/e2e/executions/:executionId/cancel",
    { minimumRole: "admin" },
  ),
  command(
    "e2e.execution.retry-import",
    "Retry e2e evidence import",
    "POST",
    "/e2e/executions/:executionId/import",
    { category: "evidence", minimumRole: "admin" },
  ),
] as const;

import { createOperationBuilders } from "./operation-builders.js";
import type { OperationId, RelayOperationMap } from "./operation-map.js";
import { localeMatrixMaterializationOperationDefinition } from "./locale-matrix-materialization-operation.js";

const { command } = createOperationBuilders<
  Pick<RelayOperationMap, "job.locale-matrix.start">
>();

/** Locale planning and execution stay together so the public start contract
 * cannot drift from its read-only materialization prerequisite. */
export const localeMatrixOperationDefinitions = [
  command(
    "job.locale-matrix.start" satisfies OperationId,
    "Run a map path across locales",
    "POST",
    "/jobs/locale-matrix",
    {
      category: "execution",
      progress: true,
      cancellable: true,
      lease: "exclusive",
      targetCapabilities: ["tap", "snapshot", "screenshot", "launch"],
    },
  ),
  localeMatrixMaterializationOperationDefinition,
] as const;

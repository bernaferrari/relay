import { createSchemaOperationBuilders } from "../operation/operation-builders.js";

const { query } = createSchemaOperationBuilders();

export const tracePackOperationDefinitions = [
  query("run.trace-pack.get", "Export TracePack", "/runs/:runId/trace-pack", {
    category: "evidence",
  }),
] as const;

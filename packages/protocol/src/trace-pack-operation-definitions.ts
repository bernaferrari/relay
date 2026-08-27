import { createOperationBuilders } from "./operation-builders.js";
import type { OperationOutput, RelayOperationMap } from "./operation-map.js";
import type { RuntimeParser } from "./operation-contract.js";
import { parseTracePackExportResponse } from "./trace-pack.js";

const { query } = createOperationBuilders<RelayOperationMap>();

const tracePackOutputParser: RuntimeParser<OperationOutput<"run.trace-pack.get">> = {
  description: "TracePack export response",
  parse: parseTracePackExportResponse,
};

export const tracePackOperationDefinitions = [
  query("run.trace-pack.get", "Export TracePack", "/runs/:runId/trace-pack", {
    category: "evidence",
    output: tracePackOutputParser,
  }),
] as const;

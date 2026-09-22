import { createOperationBuilders } from "./operation-builders.js";
import type { OperationOutput, RelayOperationMap } from "./operation-map.js";
import type { RuntimeParser } from "./operation-contract.js";
import { parseWalkthroughPackExportResponse } from "./walkthrough-pack.js";

const { query } = createOperationBuilders<RelayOperationMap>();

const walkthroughPackOutputParser: RuntimeParser<OperationOutput<"run.walkthrough-pack.get">> = {
  description: "Walkthrough pack export response",
  parse: parseWalkthroughPackExportResponse,
};

export const walkthroughPackOperationDefinitions = [
  query("run.walkthrough-pack.get", "Export walkthrough pack", "/runs/:runId/walkthrough-pack", {
    category: "evidence",
    output: walkthroughPackOutputParser,
  }),
] as const;

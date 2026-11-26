import { createSchemaOperationBuilders } from "../operation/operation-builders.js";

const { query } = createSchemaOperationBuilders();

export const walkthroughPackOperationDefinitions = [
  query("run.walkthrough-pack.get", "Export walkthrough pack", "/runs/:runId/walkthrough-pack", {
    category: "evidence",
  }),
] as const;

import { createSchemaOperationBuilders } from "../operation/operation-builders.js";
export { runPanelManifestSchema, type RunPanelManifest } from "./run-panel-manifest-schema.js";

const { query } = createSchemaOperationBuilders();
export const runPanelManifestOperationDefinitions = [
  query("run.panel-manifest.get", "Read retained Run manifest", "/runs/:runId/panel-manifest", {
    category: "evidence",
  }),
] as const;

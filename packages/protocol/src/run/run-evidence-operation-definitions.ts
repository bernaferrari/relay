import { runShareOperationDefinitions } from "./run-share.js";
import { tracePackOperationDefinitions } from "../trace/trace-pack-operation-definitions.js";
import { walkthroughPackOperationDefinitions } from "../walkthrough/walkthrough-pack-operation-definitions.js";
import { runPanelManifestOperationDefinitions } from "./run-panel-manifest.js";

export const runEvidenceOperationDefinitions = [
  ...tracePackOperationDefinitions,
  ...walkthroughPackOperationDefinitions,
  ...runPanelManifestOperationDefinitions,
  ...runShareOperationDefinitions,
] as const;

import { runShareOperationDefinitions } from "./run-share.js";
import { tracePackOperationDefinitions } from "./trace-pack-operation-definitions.js";
import { walkthroughPackOperationDefinitions } from "./walkthrough-pack-operation-definitions.js";

export const runEvidenceOperationDefinitions = [
  ...tracePackOperationDefinitions,
  ...walkthroughPackOperationDefinitions,
  ...runShareOperationDefinitions,
] as const;

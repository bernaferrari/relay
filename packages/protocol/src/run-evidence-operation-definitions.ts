import { runShareOperationDefinitions } from "./run-share.js";
import { tracePackOperationDefinitions } from "./trace-pack-operation-definitions.js";

export const runEvidenceOperationDefinitions = [
  ...tracePackOperationDefinitions,
  ...runShareOperationDefinitions,
] as const;

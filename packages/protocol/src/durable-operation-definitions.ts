import { changeVerificationOperationDefinitions } from "./change-verification-operation-definitions.js";
import { workflowOperationDefinitions } from "./workflow-operation-definitions.js";

/** Durable server-owned lifecycles share one registry insertion point while
 * retaining separate public contracts and storage models. */
export const durableOperationDefinitions = [
  ...workflowOperationDefinitions,
  ...changeVerificationOperationDefinitions,
] as const;

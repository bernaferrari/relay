import { parseAuthoringSessionResponse, type AuthoringSessionResponse } from "./authoring.js";
import type { RuntimeParser } from "./operation-contract.js";
import type { RelayOperationMap } from "./operation-map.js";
import { createOperationBuilders } from "./operation-builders.js";

const { command } = createOperationBuilders<Pick<RelayOperationMap, "authoring.take.edit">>();
const output: RuntimeParser<AuthoringSessionResponse> = {
  description: "authoring session response",
  parse: parseAuthoringSessionResponse,
};

/** One deep command for semantic recording review. The schema owns the
 * discriminated edit interface; core owns canonical revision semantics. */
export const authoringTakeEditOperationDefinition = command(
  "authoring.take.edit",
  "Edit Recorded Actions",
  "POST",
  "/authoring-sessions/:sessionId/edit",
  { category: "authoring", output },
);

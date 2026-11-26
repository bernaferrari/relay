import { createSchemaOperationBuilders } from "../operation/operation-builders.js";

const { command } = createSchemaOperationBuilders<"authoring.take.edit">();

/** One deep command for semantic recording review. The schema owns the
 * discriminated edit interface; core owns canonical revision semantics. */
export const authoringTakeEditOperationDefinition = command(
  "authoring.take.edit",
  "Edit Recorded Actions",
  "POST",
  "/authoring-sessions/:sessionId/edit",
  {
    category: "authoring",
  },
);

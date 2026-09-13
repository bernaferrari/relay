import type * as z from "zod/v4";
import { coreOperationOutputSchemas } from "./core-operation-output-schemas.js";
import { executionOperationOutputSchemas } from "./execution-operation-output-schemas.js";
import { observationOperationOutputSchemas } from "./observation-operation-output-schemas.js";
import { workspaceTargetOperationOutputSchemas } from "./workspace-target-operation-output-schemas.js";
import { laneOperationOutputSchemas } from "./lane-operation-schemas.js";
import { changeVerificationOperationOutputSchemas } from "./change-verification-operation-schemas.js";
import { proofSetupOperationOutputSchemas } from "./proof-setup.js";

/** Schema-first outputs for operation families that previously used OperationRecord. */
export const operationFamilyOutputSchemas = {
  ...workspaceTargetOperationOutputSchemas,
  ...laneOperationOutputSchemas,
  ...observationOperationOutputSchemas,
  ...executionOperationOutputSchemas,
  ...changeVerificationOperationOutputSchemas,
  ...proofSetupOperationOutputSchemas,
} as const satisfies Readonly<Record<string, z.ZodType>>;

/** Exact runtime schemas for every descriptor that does not own a specialized parser. */
export const operationOutputSchemas = {
  ...coreOperationOutputSchemas,
  ...operationFamilyOutputSchemas,
} as const satisfies Readonly<Record<string, z.ZodType>>;

export type OperationOutputSchemaId = keyof typeof operationOutputSchemas;
export type OperationSchemaOutput<Id extends OperationOutputSchemaId> = z.output<
  (typeof operationOutputSchemas)[Id]
>;

export function operationOutputSchema(id: string): z.ZodType {
  const schema = operationOutputSchemas[id as OperationOutputSchemaId];
  if (!schema) throw new Error(`Missing operation output schema: ${id}`);
  return schema;
}

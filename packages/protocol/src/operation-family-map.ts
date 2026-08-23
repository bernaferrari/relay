import type * as z from "zod/v4";
import type {
  OperationSchemaId,
  OperationSchemaInput,
} from "./operation-input-schemas.js";
import type { operationFamilyOutputSchemas } from "./operation-output-schemas.js";

type OperationFamilyId = keyof typeof operationFamilyOutputSchemas;

/** Exact family I/O is inferred from the same Zod contracts used at runtime. */
export type OperationFamilyMap = {
  [Id in OperationFamilyId]: {
    input: OperationSchemaInput<Id & OperationSchemaId>;
    output: z.output<(typeof operationFamilyOutputSchemas)[Id]>;
  };
};

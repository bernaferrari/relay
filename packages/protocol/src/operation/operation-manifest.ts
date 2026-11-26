import type { OperationDefinition } from "./operation-contract.js";
import { validateOperationDefinitions } from "./operation-definition-validation.js";
export type OperationManifestItem = Omit<OperationDefinition, "input" | "output"> & {
  input: string;
  output: string;
};
export function createOperationManifest(
  definitions: readonly OperationDefinition[],
): OperationManifestItem[] {
  validateOperationDefinitions(definitions);
  return definitions.map(({ input, output, ...definition }) => ({
    ...definition,
    input: input.description,
    output: output.description,
  }));
}

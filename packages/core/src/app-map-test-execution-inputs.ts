import { parseAppMapCombineCellExecutionIntentArtifact } from "./app-map-combine-cell-intent.js";
import { parseAppMapTestExecutionIntentArtifact } from "./app-map-test-execution-intent.js";
import { frozenRecipeInputsMatch } from "./frozen-recipe-inputs.js";
import { PRIVATE_INPUT } from "./private-inputs.js";

/** Outputs may reuse an input name. Replay starts with the admitted inputs,
 * while private values must still be available locally and match their seal. */
export function replayAppMapTestInputValues(source: {
  artifacts?: readonly { kind: string; data: unknown }[];
  resolvedInputs: Record<string, string>;
}): Record<string, string> {
  const artifacts = source.artifacts ?? [];
  const receipt = artifacts
    .map(
      (artifact) =>
        parseAppMapCombineCellExecutionIntentArtifact(artifact)?.child.frozenInputs ??
        parseAppMapTestExecutionIntentArtifact(artifact)?.frozenInputs,
    )
    .find(Boolean);
  const values = { ...source.resolvedInputs };
  if (!receipt) return values;
  for (const [name, value] of Object.entries(receipt.values)) {
    if (value !== PRIVATE_INPUT) values[name] = value;
  }
  if (!frozenRecipeInputsMatch(receipt, values))
    throw new Error(
      "The frozen Test inputs are unavailable; provide private values again before replaying.",
    );
  return values;
}

import {
  CasePlanError,
  freezeRecipeInputs,
  readProjectVariables,
  type EnqueueJobInput,
  type Recipe,
} from "@relay/core";
import type { FrozenRecipeInputReceipt } from "@relay/protocol";
import { HttpError } from "./http.js";

/** Prompt generation and missing/private input checks finish before lease or enqueue. */
export async function prepareTestRunInputs(input: {
  projectId: string;
  recipeGraph: Record<string, Recipe>;
  variables?: Record<string, string>;
  queuedAt: number;
  readProjectVariables?: typeof readProjectVariables;
}): Promise<{
  variables: Record<string, string>;
  sensitiveInputNames: string[];
  artifacts: NonNullable<EnqueueJobInput["artifacts"]>;
  receipt?: FrozenRecipeInputReceipt;
}> {
  try {
    const definitions = await (input.readProjectVariables ?? readProjectVariables)(input.projectId);
    const prepared = await freezeRecipeInputs({
      recipeGraph: input.recipeGraph,
      definitions,
      runtimeValues: input.variables,
      seed: input.queuedAt,
    });
    return {
      variables: prepared?.variables ?? {},
      sensitiveInputNames: prepared?.sensitiveInputNames ?? [],
      ...(prepared ? { receipt: prepared.receipt } : {}),
      artifacts: prepared
        ? [
            {
              kind: "frozen-inputs",
              capturedAt: input.queuedAt,
              data: prepared.receipt,
            },
          ]
        : [],
    };
  } catch (error) {
    if (!(error instanceof CasePlanError)) throw error;
    throw new HttpError(409, error.message, {
      code: error.code,
      recovery:
        error.code === "generation-failed"
          ? "Check the Data set generation provider or supply an explicit runtime value."
          : "Supply the missing input in variables or add a value to its project Data set, then run this saved Test again.",
    });
  }
}

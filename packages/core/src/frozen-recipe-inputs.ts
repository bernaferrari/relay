import { createHash } from "node:crypto";
import type { FrozenRecipeInputReceipt, FrozenRunCase, TestData } from "@relay/protocol";
import { redactCasePlan } from "./case-plan.js";
import { PRIVATE_INPUT, redactPrivateValue } from "./private-inputs.js";
import { prepareFrozenRecipeInputs } from "./recipe-input-plan.js";
import type { Recipe } from "./recipes.js";

export type PreparedFrozenRecipeInputs = {
  variables: Record<string, string>;
  sensitiveInputNames: string[];
  receipt: FrozenRecipeInputReceipt;
};

export function frozenRecipeInputValuesDigest(values: Record<string, string>): string {
  return createHash("sha256")
    .update(JSON.stringify(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
    .digest("hex");
}

export async function freezeRecipeInputs(input: {
  recipeGraph: Record<string, Recipe>;
  definitions: { revision: number; value: TestData[] };
  runtimeValues?: Record<string, string>;
  seed: number;
}): Promise<PreparedFrozenRecipeInputs | undefined> {
  const prepared = await prepareFrozenRecipeInputs({
    ...input,
    definitions: input.definitions.value,
  });
  if (!Object.keys(prepared.variables).length) return undefined;
  const receipt: FrozenRecipeInputReceipt = {
    schemaVersion: 1,
    projectDataRevision: input.definitions.revision,
    seed: prepared.matrix?.seed ?? input.seed,
    values: redactPrivateValue(
      prepared.variables,
      prepared.variables,
      prepared.sensitiveInputNames,
    ),
    sensitiveInputNames: [...prepared.sensitiveInputNames],
    valuesDigest: frozenRecipeInputValuesDigest(prepared.variables),
    ...(prepared.matrix
      ? { case: redactCasePlan(prepared.matrix, input.definitions.value).cases[0]! }
      : {}),
  };
  return {
    variables: prepared.variables,
    sensitiveInputNames: prepared.sensitiveInputNames,
    receipt,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function string(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function values(value: unknown): value is Record<string, string> {
  return (
    record(value) && Object.entries(value).every(([key, value]) => string(key) && string(value))
  );
}
function only(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function frozenCase(value: unknown, inputs: Record<string, string>): value is FrozenRunCase {
  if (
    !record(value) ||
    !only(value, ["id", "name", "index", "values", "provenance"]) ||
    !string(value.id) ||
    !string(value.name) ||
    !integer(value.index) ||
    value.index < 0 ||
    !values(value.values) ||
    !Array.isArray(value.provenance)
  )
    return false;
  return (
    Object.entries(value.values).every(([key, entry]) => inputs[key] === entry) &&
    value.provenance.every(
      (entry) =>
        record(entry) &&
        only(entry, [
          "variableId",
          "variableName",
          "source",
          "provider",
          "model",
          "generatedAt",
          "seed",
        ]) &&
        string(entry.variableId) &&
        string(entry.variableName) &&
        ["static", "list", "generated"].includes(String(entry.source)) &&
        (entry.provider === undefined || string(entry.provider)) &&
        (entry.model === undefined || string(entry.model)) &&
        (entry.generatedAt === undefined || integer(entry.generatedAt)) &&
        (entry.seed === undefined || integer(entry.seed)),
    )
  );
}

export function parseFrozenRecipeInputReceipt(
  value: unknown,
): FrozenRecipeInputReceipt | undefined {
  if (
    !record(value) ||
    !only(value, [
      "schemaVersion",
      "projectDataRevision",
      "seed",
      "values",
      "sensitiveInputNames",
      "valuesDigest",
      "case",
    ]) ||
    value.schemaVersion !== 1 ||
    !integer(value.projectDataRevision) ||
    value.projectDataRevision < 0 ||
    !integer(value.seed) ||
    !values(value.values) ||
    !Array.isArray(value.sensitiveInputNames) ||
    !value.sensitiveInputNames.every(string) ||
    !string(value.valuesDigest) ||
    !/^[a-f0-9]{64}$/u.test(value.valuesDigest)
  )
    return undefined;
  const frozenValues = value.values;
  if (
    new Set(value.sensitiveInputNames).size !== value.sensitiveInputNames.length ||
    value.sensitiveInputNames.some((name) => frozenValues[name] !== PRIVATE_INPUT)
  )
    return undefined;
  if (
    !value.sensitiveInputNames.length &&
    value.valuesDigest !== frozenRecipeInputValuesDigest(value.values)
  )
    return undefined;
  if (value.case !== undefined && !frozenCase(value.case, value.values)) return undefined;
  return structuredClone(value) as FrozenRecipeInputReceipt;
}

/** Wrapper inputs and later outputs are outside the frozen external input
 * identity. Every original dependency must still have its admitted value. */
export function frozenRecipeInputsMatch(
  receipt: FrozenRecipeInputReceipt,
  executionValues: Record<string, string> | undefined,
): boolean {
  const selected: Record<string, string> = {};
  for (const name of Object.keys(receipt.values)) {
    const value = executionValues?.[name];
    if (value === undefined) return false;
    selected[name] = value;
  }
  return frozenRecipeInputValuesDigest(selected) === receipt.valuesDigest;
}

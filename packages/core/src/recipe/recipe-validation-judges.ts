import type { RecipeStep } from "@relay/protocol";
import { isNumber, isObject, isString, stepErr } from "./recipe-validation-primitives.js";

function parseJudgeFields(
  raw: Record<string, unknown>,
  index: number,
  kind: "evaluate-semantic" | "evaluate-visual",
): Pick<
  Extract<RecipeStep, { kind: "evaluate-semantic" }>,
  | "criteria"
  | "threshold"
  | "provider"
  | "model"
  | "requireAgreement"
  | "secondProvider"
  | "secondModel"
> {
  if (!Array.isArray(raw.criteria) || raw.criteria.length === 0 || !raw.criteria.every(isString)) {
    throw stepErr(index, `${kind}.criteria must be a non-empty string array`);
  }
  if (
    raw.threshold !== undefined &&
    (!isNumber(raw.threshold) || raw.threshold < 0 || raw.threshold > 1)
  ) {
    throw stepErr(index, `${kind}.threshold must be between 0 and 1`);
  }
  if (raw.provider !== undefined && !isString(raw.provider))
    throw stepErr(index, `${kind}.provider must be a string`);
  if (raw.model !== undefined && !isString(raw.model))
    throw stepErr(index, `${kind}.model must be a string`);
  if (raw.requireAgreement !== undefined && typeof raw.requireAgreement !== "boolean")
    throw stepErr(index, `${kind}.requireAgreement must be a boolean`);
  if (raw.secondProvider !== undefined && !isString(raw.secondProvider))
    throw stepErr(index, `${kind}.secondProvider must be a string`);
  if (raw.secondModel !== undefined && !isString(raw.secondModel))
    throw stepErr(index, `${kind}.secondModel must be a string`);
  if (
    raw.requireAgreement === true &&
    (!isString(raw.secondProvider) || !raw.secondProvider.trim())
  )
    throw stepErr(index, `${kind}.secondProvider is required for agreement`);
  return {
    criteria: raw.criteria,
    ...(raw.threshold !== undefined ? { threshold: raw.threshold } : {}),
    ...(isString(raw.provider) ? { provider: raw.provider } : {}),
    ...(isString(raw.model) ? { model: raw.model } : {}),
    ...(raw.requireAgreement === true ? { requireAgreement: true } : {}),
    ...(isString(raw.secondProvider) ? { secondProvider: raw.secondProvider } : {}),
    ...(isString(raw.secondModel) ? { secondModel: raw.secondModel } : {}),
  };
}

function parsePixelRegion(
  raw: unknown,
  index: number,
  field: string,
): { x: number; y: number; width: number; height: number } {
  if (!isObject(raw)) throw stepErr(index, `${field} must be an object`);
  const { x, y, width, height } = raw;
  if (
    !isNumber(x) ||
    !isNumber(y) ||
    !isNumber(width) ||
    !isNumber(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw stepErr(index, `${field} requires x, y, width, and height`);
  }
  return { x, y, width, height };
}

export function parseNamedPixelRegions(
  raw: unknown,
  index: number,
  field: string,
): Array<{ x: number; y: number; width: number; height: number; name?: string }> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw stepErr(index, `${field} must be an array`);
  if (raw.length === 0) return undefined;
  if (raw.length > 16) throw stepErr(index, `${field} must contain at most 16 regions`);
  return raw.map((item, regionIndex) => {
    const region = parsePixelRegion(item, index, `${field}[${regionIndex}]`);
    if (!isObject(item)) throw stepErr(index, `${field}[${regionIndex}] must be an object`);
    if (item.name !== undefined && !isString(item.name)) {
      throw stepErr(index, `${field}[${regionIndex}].name must be a string`);
    }
    const name = isString(item.name) ? item.name.trim() : "";
    return { ...region, ...(name ? { name } : {}) };
  });
}

export function parseJudgeRecipeStep(
  raw: Record<string, unknown>,
  kind: string,
  index: number,
  note?: string,
): RecipeStep | undefined {
  if (kind === "act") {
    if (!isString(raw.intent) || !raw.intent.trim()) throw stepErr(index, "act.intent is required");
    if (
      raw.maxActions !== undefined &&
      (typeof raw.maxActions !== "number" ||
        !Number.isInteger(raw.maxActions) ||
        raw.maxActions < 1 ||
        raw.maxActions > 20)
    ) {
      throw stepErr(index, "act.maxActions must be an integer from 1 to 20");
    }
    if (raw.model !== undefined && !isString(raw.model)) {
      throw stepErr(index, "act.model must be a string");
    }
    return {
      kind: "act",
      intent: raw.intent.trim(),
      ...(typeof raw.maxActions === "number" ? { maxActions: raw.maxActions } : {}),
      ...(isString(raw.model) && raw.model.trim() ? { model: raw.model.trim() } : {}),
      ...(note ? { note } : {}),
    };
  }
  if (kind === "identity-ignore") {
    const region = parsePixelRegion(raw.region, index, "identity-ignore.region");
    if (raw.name !== undefined && !isString(raw.name)) {
      throw stepErr(index, "identity-ignore.name must be a string");
    }
    return {
      kind: "identity-ignore",
      region,
      ...(isString(raw.name) && raw.name.trim() ? { name: raw.name.trim() } : {}),
      ...(note ? { note } : {}),
    };
  }
  if (kind !== "evaluate-semantic" && kind !== "evaluate-visual") return undefined;
  const fields = parseJudgeFields(raw, index, kind);
  if (kind === "evaluate-semantic") {
    if (!isString(raw.input) || !raw.input.trim())
      throw stepErr(index, "evaluate-semantic.input is required");
    return {
      kind: "evaluate-semantic",
      input: raw.input,
      ...fields,
      ...(note ? { note } : {}),
    };
  }
  const region =
    raw.region === undefined
      ? undefined
      : parsePixelRegion(raw.region, index, "evaluate-visual.region");
  return {
    kind: "evaluate-visual",
    ...fields,
    ...(region ? { region } : {}),
    ...(note ? { note } : {}),
  };
}

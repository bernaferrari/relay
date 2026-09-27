import type { ProductRunAcrossSetup } from "./run-across.js";

export function normalizedSelection(
  setup: ProductRunAcrossSetup,
  selected: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const known = new Set(setup.dataSet.dimensions.map((dimension) => dimension.id));
  const unknown = Object.keys(selected).find((id) => !known.has(id));
  if (unknown) throw new TypeError(`The selected data dimension ${unknown} is not available.`);
  for (const dimension of setup.dataSet.dimensions) {
    const allowed = new Set(dimension.values.map((value) => value.id));
    const requested = selected[dimension.id];
    if (requested === undefined) continue;
    const values = [...new Set(requested)].filter((value) => allowed.has(value));
    if (!values.length) throw new TypeError(`Choose at least one value for ${dimension.name}.`);
    result[dimension.id] = values;
  }
  if (setup.dataSet.dimensions.length && !Object.keys(result).length)
    throw new TypeError("Choose at least one data value.");
  return result;
}

export function cartesianCount(selected: Readonly<Record<string, readonly string[]>>): number {
  return Object.values(selected).reduce((total, values) => total * values.length, 1);
}

export function representativeCase(
  setup: ProductRunAcrossSetup,
  selected: Readonly<Record<string, readonly string[]>>,
  explicit?: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const dimension of setup.dataSet.dimensions) {
    const values = selected[dimension.id];
    if (!values?.length) continue;
    const value = explicit?.[dimension.id] ?? values[0];
    if (!value || !values.includes(value)) {
      throw new TypeError(`${dimension.name} is not included in the selected data scope.`);
    }
    result[dimension.id] = value;
  }
  return result;
}

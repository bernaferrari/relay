import type { AppMapCombine, AppMapVariable } from "@relay/protocol";

/** Restore a saved matrix draft without inventing selections for a new one. */
export function initialCombineDraft(
  existing: AppMapCombine | undefined,
  variables: Record<string, AppMapVariable>,
  availableTestIds: readonly string[],
): { variableIds: string[]; testIds: string[]; selected: Record<string, string[]> } {
  if (!existing) return { variableIds: [], testIds: [], selected: {} };
  const variableIds = existing.variableIds.filter((id) => variables[id]);
  const availableTests = new Set(availableTestIds);
  return {
    variableIds,
    testIds: existing.testIds.filter((id) => availableTests.has(id)),
    selected: Object.fromEntries(
      variableIds.map((id) => [
        id,
        existing.selected?.[id] ?? variables[id]!.options.map((option) => option.id),
      ]),
    ),
  };
}

/** Remove one Variable from a saved matrix without leaving a dangling value selection. */
export function combineWithoutVariable(
  combine: AppMapCombine,
  variableId: string,
  updatedAt: number,
): AppMapCombine | null {
  const variableIds = combine.variableIds.filter((id) => id !== variableId);
  if (!variableIds.length) return null;
  return {
    ...combine,
    variableIds,
    selected: Object.fromEntries(
      Object.entries(combine.selected ?? {}).filter(([id]) => id !== variableId),
    ),
    ...(combine.cellRuntimeProfiles
      ? {
          cellRuntimeProfiles: combine.cellRuntimeProfiles.filter(
            (binding) => !Object.hasOwn(binding.values, variableId),
          ),
        }
      : {}),
    updatedAt,
  };
}

import type { AppMapCombine } from "@relay/protocol";

/** Remove one modifier from a saved matrix without leaving a dangling value selection. */
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
    updatedAt,
  };
}

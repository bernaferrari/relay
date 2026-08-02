import type { CaseExpansionStrategy, CaseStack, TestVariable } from "@relay/protocol";

function valueCount(variable: TestVariable): number {
  return variable.scope === "private" ? 1 : Math.max(1, variable.values?.length ?? 1);
}

export function caseStackCount(
  stack: Pick<CaseStack, "variableIds" | "strategy" | "maxCases">,
  variables: TestVariable[],
): { count: number; exact: boolean } {
  const counts = stack.variableIds
    .map((id) => variables.find((variable) => variable.id === id))
    .filter((variable): variable is TestVariable => Boolean(variable))
    .map(valueCount);
  if (!counts.length) return { count: 0, exact: true };
  const limit = Math.min(100, Math.max(1, stack.maxCases));
  if (stack.strategy === "cartesian") {
    return {
      count: Math.min(
        limit,
        counts.reduce((product, count) => product * count, 1),
      ),
      exact: true,
    };
  }
  if (stack.strategy === "zip") {
    return { count: Math.min(limit, Math.max(...counts)), exact: true };
  }
  if (counts.length === 1) return { count: Math.min(limit, counts[0]!), exact: true };
  if (counts.length === 2) {
    return { count: Math.min(limit, counts[0]! * counts[1]!), exact: true };
  }
  return {
    count: Math.min(limit, Math.max(...counts) * Math.max(2, counts.length - 1)),
    exact: false,
  };
}

export function caseStrategyLabel(strategy: CaseExpansionStrategy): string {
  if (strategy === "cartesian") return "Every combination";
  if (strategy === "pairwise") return "Pairwise coverage";
  return "Matched rows";
}

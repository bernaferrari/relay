import type { CaseExpansionStrategy, CaseStack, TestData } from "@relay/protocol";

function valueCount(variable: TestData): number {
  return variable.scope === "private" ? 1 : Math.max(1, variable.values?.length ?? 1);
}

export function caseStackCount(
  stack: Pick<CaseStack, "dataIds" | "strategy" | "maxCases">,
  variables: TestData[],
): { count: number; exact: boolean } {
  const counts = stack.dataIds
    .map((id) => variables.find((variable) => variable.id === id))
    .filter((variable): variable is TestData => Boolean(variable))
    .map(valueCount);
  if (!counts.length) return { count: 0, exact: true };
  const limit = Math.min(250, Math.max(1, stack.maxCases));
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

import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import type { RepeatTestSnapshot } from "@relay/workflows";

export type AppMapTestCombineStripProps = {
  map: AppMap;
  test: AppMapScenarioTest;
  ready: boolean;
  onStarted?: () => void;
  onChooseTarget?: () => void;
  onOpenTarget?: () => void;
  onOpenRun?: (runId: string) => void;
};

export function repeatStatusLabel(status: RepeatTestSnapshot["results"][number]["status"]): string {
  if (status === "needs-review") return "Needs review";
  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
}

export function repeatCaseLabel(
  values: Readonly<Record<string, string>>,
  selectedDimensionId: string,
  valueLabel: (valueId: string) => string,
): string {
  return Object.entries(values)
    .map(([dimensionId, valueId]) =>
      dimensionId === selectedDimensionId ? valueLabel(valueId) : `${dimensionId}: ${valueId}`,
    )
    .join(" × ");
}

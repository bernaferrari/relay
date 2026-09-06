/** Current Test steps and historical Run steps are independent selections. */
export function currentTestOutlineCopy(input: {
  stepCount: number;
  viewingHistoricalRun: boolean;
}): { title: string; hint?: string } {
  return {
    title:
      input.stepCount === 1 ? "Current Test · 1 step" : `Current Test · ${input.stepCount} steps`,
    ...(input.viewingHistoricalRun
      ? {
          hint: "Selecting a current step does not change the historical Run.",
        }
      : {}),
  };
}

export function historicalRunCaption(input: { runId: string; sourceRevision?: string }): string {
  if (input.sourceRevision) {
    return `Viewing historical Run ${input.runId}, which executed revision ${input.sourceRevision}. Current Test steps stay selected separately.`;
  }
  return `Viewing historical Run ${input.runId}. Current Test steps stay selected separately.`;
}

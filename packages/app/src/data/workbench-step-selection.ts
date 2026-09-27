/** Current Test steps and historical Run steps are independent selections. */
export function currentTestOutlineCopy(input: {
  stepCount: number;
  viewingHistoricalRun: boolean;
}): { title: string; hint?: string } {
  return {
    title: input.stepCount === 1 ? "1 step" : `${input.stepCount} steps`,
    ...(input.viewingHistoricalRun
      ? {
          hint: "",
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

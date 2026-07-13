export type CompletedRun = {
  id: string;
  action: string;
  status: string;
  queuedAt?: number;
  startedAt?: number;
  finishedAt?: number;
};

/** The earliest real successful run is the durable onboarding completion signal. */
export function firstSuccessfulRun(runs: CompletedRun[]): CompletedRun | null {
  return (
    runs
      .filter((run) => run.status === "ok" || run.status === "healed")
      .slice()
      .sort(
        (a, b) =>
          (a.finishedAt ?? a.startedAt ?? a.queuedAt ?? 0) -
          (b.finishedAt ?? b.startedAt ?? b.queuedAt ?? 0),
      )[0] ?? null
  );
}

export function canShowFirstRunGuide(input: {
  recipeId: string | null | undefined;
  recipeSource: "builtin" | "custom" | null | undefined;
  firstRun: CompletedRun | null;
}): boolean {
  if (!input.recipeId || input.recipeSource !== "custom") return false;
  return !input.firstRun || input.firstRun.action === input.recipeId;
}

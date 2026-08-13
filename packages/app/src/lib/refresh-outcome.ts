export type RefreshOutcome = { ok: true } | { ok: false; error: string };

export type RunCatalogRefreshState = {
  error: string | null;
  lastSuccessAt: number | null;
};

export function refreshFailure(error: unknown): RefreshOutcome {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function runCatalogRefreshState(
  previous: RunCatalogRefreshState,
  jobs: RefreshOutcome,
  runs: RefreshOutcome,
  completedAt: number,
): RunCatalogRefreshState {
  const failures = [
    !jobs.ok ? `jobs: ${jobs.error}` : null,
    !runs.ok ? `runs: ${runs.error}` : null,
  ].filter((message): message is string => Boolean(message));
  return failures.length
    ? { ...previous, error: `Couldn’t refresh ${failures.join("; ")}. Showing saved results.` }
    : { error: null, lastSuccessAt: completedAt };
}

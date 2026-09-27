/** Restore only when a stored pointer points at a different Run. */
export function shouldRestorePersistedRun(
  pointer: { runId: string } | null | undefined,
  runId: string,
): boolean {
  return pointer != null && pointer.runId !== runId;
}

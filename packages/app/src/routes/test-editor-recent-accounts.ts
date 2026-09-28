/** Accounts this Test ran as, newest run first. */
export function recentAccountIds(
  runs: readonly { queuedAt: number; executionIdentity?: { accountId?: string } }[] = [],
): string[] {
  return [...runs]
    .sort((left, right) => right.queuedAt - left.queuedAt)
    .flatMap((run) => (run.executionIdentity?.accountId ? [run.executionIdentity.accountId] : []));
}

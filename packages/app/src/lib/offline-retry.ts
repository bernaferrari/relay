export function createGuardedRetry(
  retryConnection: () => Promise<unknown>,
  setBusy: (busy: boolean) => void,
): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    if (pending) return pending;
    setBusy(true);
    pending = retryConnection()
      .then(
        () => undefined,
        (error) => Promise.reject(error),
      )
      .finally(() => {
        pending = undefined;
        setBusy(false);
      });
    return pending;
  };
}

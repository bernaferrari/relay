/** One probe at a time. Stop waits for the active probe before finalization. */
export function sampleRunPerformance({
  probe,
  retain,
  onError,
  onLimit,
  shouldRetry = () => false,
  intervalMs = 2_000,
  limit = 900,
}: {
  probe(): Promise<unknown>;
  retain(value: unknown, capturedAt: number): void;
  onError(error: unknown): void;
  onLimit?(): void;
  /** Retry only known transient failures, at most twice consecutively. The
   * probe must settle its underlying operation before rejecting. */
  shouldRetry?(error: unknown): boolean;
  intervalMs?: number;
  limit?: number;
}): { stop(): Promise<void> } {
  let stopped = false;
  let count = 0;
  let consecutiveErrors = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const schedule = () => {
    if (stopped || count >= limit) return;
    timer = setTimeout(
      () => {
        pending = (async () => {
          try {
            const value = await probe();
            consecutiveErrors = 0;
            if (!stopped) {
              retain(value, Date.now());
              count++;
              if (count === limit) onLimit?.();
            }
          } catch (error) {
            consecutiveErrors++;
            stopped ||= !shouldRetry(error) || consecutiveErrors >= 3;
            onError(error);
          }
          schedule();
        })();
      },
      intervalMs * 2 ** consecutiveErrors,
    );
    timer.unref?.();
  };
  schedule();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await pending;
    },
  };
}

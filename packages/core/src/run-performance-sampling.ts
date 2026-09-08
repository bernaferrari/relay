/** One probe at a time. Stop waits for the active probe before finalization. */
export function sampleRunPerformance({
  probe,
  retain,
  onError,
  onLimit,
  intervalMs = 2_000,
  limit = 900,
}: {
  probe(): Promise<unknown>;
  retain(value: unknown, capturedAt: number): void;
  onError(error: unknown): void;
  onLimit?(): void;
  intervalMs?: number;
  limit?: number;
}): { stop(): Promise<void> } {
  let stopped = false;
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const schedule = () => {
    if (stopped || count >= limit) return;
    timer = setTimeout(() => {
      pending = (async () => {
        try {
          const value = await probe();
          if (!stopped) {
            retain(value, Date.now());
            count++;
            if (count === limit) onLimit?.();
          }
        } catch (error) {
          stopped = true;
          onError(error);
        }
        schedule();
      })();
    }, intervalMs);
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

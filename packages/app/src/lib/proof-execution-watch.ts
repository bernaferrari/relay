import type { ProofExecutionWatchNotice } from "./server-event-controller";

export type ProofExecutionWatchTimers<Handle = ReturnType<typeof setInterval>> = {
  setInterval(callback: () => void, milliseconds: number): Handle;
  clearInterval(handle: Handle): void;
};

/** Event-driven invalidation for one active Proof. The event is deliberately
 * only a hint: refresh always re-reads proof.inspect. A slow timer is retained
 * solely while SSE is disconnected or for a legacy server with no event. */
export function watchActiveProofExecution<Handle = ReturnType<typeof setInterval>>(input: {
  proofId: string;
  sseConnected: () => boolean;
  subscribe: (proofId: string, listener: (notice: ProofExecutionWatchNotice) => void) => () => void;
  refresh: () => void;
  fallbackMs?: number;
  timers?: ProofExecutionWatchTimers<Handle>;
}): () => void {
  const timers =
    input.timers ??
    ({
      setInterval: (callback, milliseconds) =>
        globalThis.setInterval(callback, milliseconds) as unknown as Handle,
      clearInterval: (handle) =>
        globalThis.clearInterval(handle as unknown as ReturnType<typeof setInterval>),
    } satisfies ProofExecutionWatchTimers<Handle>);
  const unsubscribe = input.subscribe(input.proofId, () => input.refresh());
  const timer = timers.setInterval(() => {
    if (!input.sseConnected()) input.refresh();
  }, input.fallbackMs ?? 15_000);
  return () => {
    unsubscribe();
    timers.clearInterval(timer);
  };
}

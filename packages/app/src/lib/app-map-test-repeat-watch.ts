export type RepeatWorkflowWatchNotice =
  | { kind: "changed"; version: number; status: string }
  | { kind: "gap" };

export type RepeatWorkflowWatchTimers<Handle = ReturnType<typeof setInterval>> = {
  setInterval(callback: () => void, milliseconds: number): Handle;
  clearInterval(handle: Handle): void;
};

export function repeatNeedsWatch<T extends { workflow?: unknown; ref?: unknown; phase: string }>(
  repeat: T | undefined,
): repeat is T {
  return Boolean(
    (repeat?.workflow || repeat?.ref) && (repeat.phase === "queued" || repeat.phase === "running"),
  );
}

/** Event-driven invalidation for one active Repeat. Legacy handles and a
 * disconnected stream retain one deliberately slow canonical read. */
export function watchActiveRepeat<Handle = ReturnType<typeof setInterval>>(input: {
  workflowId?: string;
  currentVersion: () => number;
  sseConnected: () => boolean;
  subscribe: (
    workflowId: string,
    listener: (notice: RepeatWorkflowWatchNotice) => void,
  ) => () => void;
  refresh: () => void;
  fallbackMs?: number;
  timers?: RepeatWorkflowWatchTimers<Handle>;
}): () => void {
  const timers =
    input.timers ??
    ({
      setInterval: (callback, milliseconds) =>
        globalThis.setInterval(callback, milliseconds) as unknown as Handle,
      clearInterval: (handle) =>
        globalThis.clearInterval(handle as unknown as ReturnType<typeof setInterval>),
    } satisfies RepeatWorkflowWatchTimers<Handle>);
  const unsubscribe = input.workflowId
    ? input.subscribe(input.workflowId, (notice) => {
        if (notice.kind === "gap" || notice.version > input.currentVersion()) input.refresh();
      })
    : () => undefined;
  const timer = timers.setInterval(() => {
    if (!input.workflowId || !input.sseConnected()) input.refresh();
  }, input.fallbackMs ?? 15_000);
  return () => {
    unsubscribe();
    timers.clearInterval(timer);
  };
}

type Deferred<Value> = {
  resolve: (value: Value) => void;
  reject: (reason?: unknown) => void;
};

function deferred<Value>(): { promise: Promise<Value>; deferred: Deferred<Value> } {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, deferred: { resolve, reject } };
}

/**
 * Coalesce reads requested in the same turn, while preserving a trailing read
 * for requests made after an earlier read has started. The trailing read is
 * important for event-driven state: an in-flight GET may predate the write
 * that caused a later event. A failed batch settles only its own callers, so
 * a later request can always recover with a new read.
 */
export function createCoalescedRefresh<Value>(read: () => Promise<Value>): () => Promise<Value> {
  let reading = false;
  let flushQueued = false;
  let waiting: Deferred<Value>[] = [];

  function schedule(): void {
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(() => void flush());
  }

  async function flush(): Promise<void> {
    flushQueued = false;
    if (reading || waiting.length === 0) return;

    reading = true;
    const batch = waiting;
    waiting = [];
    try {
      const value = await read();
      for (const caller of batch) caller.resolve(value);
    } catch (error) {
      for (const caller of batch) caller.reject(error);
    } finally {
      reading = false;
      // Requests that arrived after `read` began need a newer snapshot, but
      // still share one follow-up request regardless of their count.
      if (waiting.length > 0) schedule();
    }
  }

  return () => {
    const next = deferred<Value>();
    waiting.push(next.deferred);
    schedule();
    return next.promise;
  };
}

/**
 * Tracks handlers that can outlive their HTTP connection. `server.close()`
 * stops new sockets, but it does not make detached request promises safe to
 * ignore: a disconnected client can leave one continuing toward job admission.
 */
export type RequestHandlerLifecycle = {
  run(handler: () => Promise<void>): boolean;
  stopAdmission(): void;
  drain(): Promise<void>;
};

export function createRequestHandlerLifecycle(): RequestHandlerLifecycle {
  let accepting = true;
  const active = new Set<Promise<void>>();

  return {
    run(handler) {
      if (!accepting) return false;
      const operation = handler();
      active.add(operation);
      void operation.then(
        () => active.delete(operation),
        () => active.delete(operation),
      );
      return true;
    },
    stopAdmission() {
      accepting = false;
    },
    async drain() {
      while (active.size) await Promise.allSettled(active);
    },
  };
}

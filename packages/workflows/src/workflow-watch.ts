import type { EventEnvelope } from "@relay/protocol";
import type { WorkflowSnapshot } from "./types.js";

export type WorkflowEventSource = {
  events(
    onEvent: (event: EventEnvelope) => void,
    options?: {
      signal?: AbortSignal;
      onOpen?: () => void;
      afterSequence?: number;
      onGap?: (event: EventEnvelope) => void;
    },
  ): Promise<void>;
};

export type WatchWorkflowInput = {
  workflowId: string;
  initial: WorkflowSnapshot;
  inspect: () => Promise<WorkflowSnapshot>;
  source?: WorkflowEventSource;
  signal?: AbortSignal;
  onSnapshot?: (snapshot: WorkflowSnapshot) => void;
  /** Slow canonical refresh used only while the event stream is disconnected. */
  disconnectedRefreshMs?: number;
  /** Bounded reconciliation while connected. Some durable resources become
   * terminal before their workflow record is advanced, so an idle event
   * stream cannot be treated as proof that canonical state is unchanged. */
  connectedRefreshMs?: number;
  reconnectMs?: number;
};

const DEFAULT_DISCONNECTED_REFRESH_MS = 15_000;
const DEFAULT_CONNECTED_REFRESH_MS = 2_000;
const DEFAULT_RECONNECT_MS = 1_000;

function abortError(): DOMException {
  return new DOMException("cancelled", "AbortError");
}

function active(snapshot: WorkflowSnapshot): boolean {
  return (
    snapshot.kind !== "author-test" && (snapshot.phase === "queued" || snapshot.phase === "running")
  );
}

function version(snapshot: WorkflowSnapshot): number {
  return snapshot.workflow?.expectedVersion ?? 0;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", cancelled, { once: true });
    function done(): void {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }
    function cancelled(): void {
      clearTimeout(timer);
      reject(abortError());
    }
  });
}

/**
 * Watch one server-owned workflow through the shared Relay event stream.
 * Events are only invalidation hints: every update is reconstructed through
 * the canonical scoped workflow read. A sequence gap forces the same refresh,
 * and a disconnected stream falls back to a deliberately slow read cadence.
 */
export async function watchWorkflow(input: WatchWorkflowInput): Promise<WorkflowSnapshot> {
  if (!input.workflowId.trim()) throw new TypeError("Workflow watch requires an id.");
  const disconnectedRefreshMs = input.disconnectedRefreshMs ?? DEFAULT_DISCONNECTED_REFRESH_MS;
  const connectedRefreshMs = input.connectedRefreshMs ?? DEFAULT_CONNECTED_REFRESH_MS;
  const reconnectMs = input.reconnectMs ?? DEFAULT_RECONNECT_MS;
  if (disconnectedRefreshMs < 1 || connectedRefreshMs < 1 || reconnectMs < 1) {
    throw new TypeError("Workflow watch intervals must be positive.");
  }

  let current = input.initial;
  if (!active(current)) return current;

  const controller = new AbortController();
  const cancel = () => controller.abort();
  input.signal?.addEventListener("abort", cancel, { once: true });
  let connected = false;
  let cursor = 0;
  let wakeVersion = 0;
  let wakeResolver: (() => void) | undefined;
  let refreshRequested = false;

  const wake = (): void => {
    wakeVersion += 1;
    wakeResolver?.();
    wakeResolver = undefined;
  };
  const requestRefresh = (): void => {
    refreshRequested = true;
    wake();
  };
  const waitForWake = async (timeoutMs?: number): Promise<"wake" | "timeout"> => {
    const observed = wakeVersion;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        controller.signal.removeEventListener("abort", cancelled);
        wakeResolver = undefined;
      };
      const finish = (reason: "wake" | "timeout"): void => {
        cleanup();
        resolve(reason);
      };
      const cancelled = (): void => {
        cleanup();
        reject(abortError());
      };
      if (controller.signal.aborted) {
        cancelled();
        return;
      }
      controller.signal.addEventListener("abort", cancelled, { once: true });
      if (wakeVersion !== observed) {
        finish("wake");
        return;
      }
      wakeResolver = () => finish("wake");
      if (timeoutMs !== undefined) timer = setTimeout(() => finish("timeout"), timeoutMs);
    });
  };

  const handleEvent = (event: EventEnvelope): void => {
    cursor = Math.max(cursor, event.sequence);
    if (event.payload.type === "stream.gap") {
      requestRefresh();
      return;
    }
    if (event.payload.type !== "workflow.changed") return;
    const payload = event.payload as Record<string, unknown>;
    if (
      payload.workflowId === input.workflowId &&
      typeof payload.version === "number" &&
      payload.version > version(current)
    ) {
      requestRefresh();
    }
  };

  const connectionLoop = async (): Promise<void> => {
    if (!input.source) return;
    while (!controller.signal.aborted) {
      connected = false;
      try {
        await input.source.events(handleEvent, {
          signal: controller.signal,
          afterSequence: cursor,
          onOpen: () => {
            connected = true;
            // Replay buffers are bounded and server sequence numbers restart.
            // Canonical state on every open closes both otherwise-silent gaps.
            requestRefresh();
          },
          onGap: requestRefresh,
        });
      } catch (error) {
        if (controller.signal.aborted || (error as { name?: string }).name === "AbortError") return;
      } finally {
        connected = false;
        wake();
      }
      await delay(reconnectMs, controller.signal).catch(() => undefined);
    }
  };

  const connection = connectionLoop();
  try {
    while (active(current)) {
      if (controller.signal.aborted) throw abortError();
      if (refreshRequested) {
        refreshRequested = false;
        current = await input.inspect();
        input.onSnapshot?.(current);
        continue;
      }
      const wakeReason = await waitForWake(connected ? connectedRefreshMs : disconnectedRefreshMs);
      if (wakeReason === "timeout" && !refreshRequested) refreshRequested = true;
    }
    return current;
  } finally {
    controller.abort();
    input.signal?.removeEventListener("abort", cancel);
    await connection.catch(() => undefined);
  }
}

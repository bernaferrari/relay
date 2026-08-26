import type { Accessor } from "solid-js";
import type { HealthState } from "./api-types";

export type ServerProviderLifecycleTimers<Handle = ReturnType<typeof setInterval>> = {
  setInterval(callback: () => void, delayMs: number): Handle;
  clearInterval(handle: Handle): void;
};

export type ServerProviderLifecycleDependencies<Handle = ReturnType<typeof setInterval>> = {
  pollMs: number;
  health: Accessor<HealthState>;
  resolveConnection: () => Promise<unknown>;
  restoreWorkspace: () => Promise<void>;
  pollHealth: () => Promise<void>;
  refreshInitial: () => Promise<void>;
  normalizeWorkspace: () => void;
  refreshRetry: () => Promise<void>;
  refreshPoll: () => Promise<void>;
  refreshRecovered: () => Promise<void>;
  connectSse: () => void;
  disposeSse: () => void;
  stopPlayback: () => void;
  releaseTargetControl: () => Promise<void>;
  timers?: ServerProviderLifecycleTimers<Handle>;
};

/**
 * Starts and stops the ServerProvider's remote lifecycle behind one seam.
 * Remote work, storage, SSE, target control, and timers are injected so the
 * same interface is both the production composition point and the test surface.
 */
export function createServerProviderLifecycle<Handle = ReturnType<typeof setInterval>>(
  input: ServerProviderLifecycleDependencies<Handle>,
) {
  const timers: ServerProviderLifecycleTimers<Handle> = input.timers ?? {
    setInterval: (callback, delayMs) =>
      globalThis.setInterval(callback, delayMs) as unknown as Handle,
    clearInterval: (handle) =>
      globalThis.clearInterval(handle as unknown as ReturnType<typeof setInterval>),
  };
  let pollTimer: Handle | undefined;
  let startPromise: Promise<void> | undefined;
  let pollPromise: Promise<void> | undefined;
  let disposed = false;

  async function initialize(): Promise<void> {
    await input.resolveConnection();
    if (disposed) return;
    await input.restoreWorkspace();
    if (disposed) return;
    await input.pollHealth();
    if (disposed || input.health() !== "online") return;
    await input.refreshInitial();
    if (disposed) return;
    input.normalizeWorkspace();
    input.connectSse();
  }

  async function retryConnection(): Promise<void> {
    await input.pollHealth();
    if (disposed || input.health() !== "online") return;
    await input.refreshRetry();
    if (!disposed) input.connectSse();
  }

  async function runPoll(): Promise<void> {
    const previous = input.health();
    await input.pollHealth();
    if (disposed || input.health() !== "online") return;
    await input.refreshPoll();
    if (disposed || previous === "online") return;
    await input.refreshRecovered();
    if (!disposed) input.connectSse();
  }

  function pollOnce(): Promise<void> {
    if (pollPromise) return pollPromise;
    const current = runPoll().finally(() => {
      if (pollPromise === current) pollPromise = undefined;
    });
    pollPromise = current;
    return current;
  }

  function start(): Promise<void> {
    if (startPromise) return startPromise;
    disposed = false;
    pollTimer = timers.setInterval(() => void pollOnce(), input.pollMs);
    startPromise = initialize();
    return startPromise;
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    if (pollTimer !== undefined) {
      timers.clearInterval(pollTimer);
      pollTimer = undefined;
    }
    input.stopPlayback();
    input.disposeSse();
    await input.releaseTargetControl();
  }

  return { start, retryConnection, pollOnce, dispose };
}

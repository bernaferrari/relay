import assert from "node:assert/strict";
import test from "node:test";
import { createSignal } from "solid-js";
import type { HealthState } from "./api-types";
import { createServerProviderLifecycle } from "./server-provider-lifecycle";

function lifecycleFixture(initialHealth: HealthState = "unknown") {
  const [health, setHealth] = createSignal<HealthState>(initialHealth);
  const calls: string[] = [];
  let intervalCallback: (() => void) | undefined;
  let clearedHandle: number | undefined;
  let nextHealth: HealthState | undefined;
  const lifecycle = createServerProviderLifecycle<number>({
    pollMs: 250,
    health,
    resolveConnection: async () => void calls.push("resolve"),
    restoreWorkspace: async () => void calls.push("restore"),
    pollHealth: async () => {
      calls.push("health");
      if (nextHealth) setHealth(nextHealth);
      nextHealth = undefined;
    },
    refreshInitial: async () => void calls.push("initial"),
    normalizeWorkspace: () => void calls.push("normalize"),
    refreshRetry: async () => void calls.push("retry"),
    refreshPoll: async () => void calls.push("poll"),
    refreshRecovered: async () => void calls.push("recovered"),
    connectSse: () => void calls.push("sse:connect"),
    disposeSse: () => void calls.push("sse:dispose"),
    stopPlayback: () => void calls.push("playback:stop"),
    releaseTargetControl: async () => void calls.push("lease:release"),
    timers: {
      setInterval(callback, delayMs) {
        assert.equal(delayMs, 250);
        intervalCallback = callback;
        return 17;
      },
      clearInterval(handle) {
        clearedHandle = handle;
      },
    },
  });
  return {
    lifecycle,
    calls,
    setHealth,
    setNextHealth: (value: HealthState) => {
      nextHealth = value;
    },
    intervalCallback: () => intervalCallback,
    clearedHandle: () => clearedHandle,
  };
}

test("ServerProvider startup restores workspace before loading online state and SSE", async () => {
  const fixture = lifecycleFixture("online");

  await fixture.lifecycle.start();

  assert.deepEqual(fixture.calls, [
    "resolve",
    "restore",
    "health",
    "initial",
    "normalize",
    "sse:connect",
  ]);
  assert.equal(typeof fixture.intervalCallback(), "function");
});

test("ServerProvider poll recovers an offline session and reconnects SSE", async () => {
  const fixture = lifecycleFixture("offline");
  await fixture.lifecycle.start();
  assert.deepEqual(fixture.calls, ["resolve", "restore", "health"]);

  fixture.calls.length = 0;
  fixture.setNextHealth("online");
  await fixture.lifecycle.pollOnce();

  assert.deepEqual(fixture.calls, ["health", "poll", "recovered", "sse:connect"]);
});

test("ServerProvider retry refreshes canonical state only after health is online", async () => {
  const fixture = lifecycleFixture("offline");
  await fixture.lifecycle.start();
  fixture.calls.length = 0;

  await fixture.lifecycle.retryConnection();
  assert.deepEqual(fixture.calls, ["health"]);

  fixture.calls.length = 0;
  fixture.setHealth("online");
  await fixture.lifecycle.retryConnection();
  assert.deepEqual(fixture.calls, ["health", "retry", "sse:connect"]);
});

test("ServerProvider cleanup stops polling, SSE, playback, and releases target control", async () => {
  const fixture = lifecycleFixture("online");
  await fixture.lifecycle.start();
  fixture.calls.length = 0;

  await fixture.lifecycle.dispose();
  await fixture.lifecycle.dispose();

  assert.equal(fixture.clearedHandle(), 17);
  assert.deepEqual(fixture.calls, ["playback:stop", "sse:dispose", "lease:release"]);
});

test("ServerProvider coalesces overlapping poll ticks", async () => {
  const [health] = createSignal<HealthState>("online");
  let releaseHealth!: () => void;
  const healthPending = new Promise<void>((resolve) => {
    releaseHealth = resolve;
  });
  let healthPolls = 0;
  let refreshes = 0;
  const lifecycle = createServerProviderLifecycle<number>({
    pollMs: 250,
    health,
    resolveConnection: async () => undefined,
    restoreWorkspace: async () => undefined,
    pollHealth: async () => {
      healthPolls += 1;
      await healthPending;
    },
    refreshInitial: async () => undefined,
    normalizeWorkspace: () => undefined,
    refreshRetry: async () => undefined,
    refreshPoll: async () => void (refreshes += 1),
    refreshRecovered: async () => undefined,
    connectSse: () => undefined,
    disposeSse: () => undefined,
    stopPlayback: () => undefined,
    releaseTargetControl: async () => undefined,
    timers: { setInterval: () => 1, clearInterval: () => undefined },
  });

  const first = lifecycle.pollOnce();
  const second = lifecycle.pollOnce();
  assert.equal(first, second);
  assert.equal(healthPolls, 1);
  releaseHealth();
  await Promise.all([first, second]);
  assert.equal(refreshes, 1);
});

test("ServerProvider cleanup fences an unfinished startup from opening SSE", async () => {
  const [health] = createSignal<HealthState>("online");
  let releaseResolve!: () => void;
  const resolving = new Promise<void>((resolve) => {
    releaseResolve = resolve;
  });
  const calls: string[] = [];
  const lifecycle = createServerProviderLifecycle<number>({
    pollMs: 250,
    health,
    resolveConnection: () => resolving,
    restoreWorkspace: async () => void calls.push("restore"),
    pollHealth: async () => void calls.push("health"),
    refreshInitial: async () => void calls.push("initial"),
    normalizeWorkspace: () => void calls.push("normalize"),
    refreshRetry: async () => undefined,
    refreshPoll: async () => undefined,
    refreshRecovered: async () => undefined,
    connectSse: () => void calls.push("sse:connect"),
    disposeSse: () => void calls.push("sse:dispose"),
    stopPlayback: () => undefined,
    releaseTargetControl: async () => undefined,
    timers: { setInterval: () => 1, clearInterval: () => undefined },
  });

  const startup = lifecycle.start();
  await lifecycle.dispose();
  releaseResolve();
  await startup;

  assert.deepEqual(calls, ["sse:dispose"]);
});

test("ServerProvider default timers preserve the browser global receiver", async () => {
  const [health] = createSignal<HealthState>("offline");
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const handle = { kind: "receiver-sensitive-interval" } as unknown as ReturnType<
    typeof setInterval
  >;
  let scheduled = false;
  let cleared = false;

  globalThis.setInterval = function (
    this: typeof globalThis,
    _callback: () => void,
    delayMs?: number,
  ) {
    assert.equal(this, globalThis);
    assert.equal(delayMs, 250);
    scheduled = true;
    return handle;
  } as typeof setInterval;
  globalThis.clearInterval = function (this: typeof globalThis, actualHandle: unknown) {
    assert.equal(this, globalThis);
    assert.equal(actualHandle, handle);
    cleared = true;
  } as typeof clearInterval;

  try {
    const lifecycle = createServerProviderLifecycle({
      pollMs: 250,
      health,
      resolveConnection: async () => undefined,
      restoreWorkspace: async () => undefined,
      pollHealth: async () => undefined,
      refreshInitial: async () => undefined,
      normalizeWorkspace: () => undefined,
      refreshRetry: async () => undefined,
      refreshPoll: async () => undefined,
      refreshRecovered: async () => undefined,
      connectSse: () => undefined,
      disposeSse: () => undefined,
      stopPlayback: () => undefined,
      releaseTargetControl: async () => undefined,
    });

    await lifecycle.start();
    await lifecycle.dispose();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }

  assert.equal(scheduled, true);
  assert.equal(cleared, true);
});

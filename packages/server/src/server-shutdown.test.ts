import assert from "node:assert/strict";
import test from "node:test";
import { createFailClosedServerShutdown, ServerShutdownTimeoutError } from "./server-shutdown.js";

test("server shutdown retains its state lease when session work does not drain, then retries safely", async () => {
  let closeHttpCalls = 0;
  let closeSchedulerCalls = 0;
  let releaseCalls = 0;
  let releaseDrain!: () => void;
  const drain = new Promise<void>((resolve) => {
    releaseDrain = resolve;
  });
  const close = createFailClosedServerShutdown({
    stopRequestAdmission: () => undefined,
    closeHttp: async () => {
      closeHttpCalls += 1;
    },
    drainRequestHandlers: async () => undefined,
    closeScheduler: async () => {
      closeSchedulerCalls += 1;
    },
    closeSse: () => undefined,
    drainSessionExecutions: async () => await drain,
    flushActivity: async () => undefined,
    releaseStateLease: () => {
      releaseCalls += 1;
    },
    timeoutMs: 10,
  });

  await assert.rejects(
    close(),
    (error: unknown) => error instanceof ServerShutdownTimeoutError && error.phase === "session",
  );
  assert.equal(releaseCalls, 0, "a live session keeps the state directory exclusively owned");
  assert.equal(closeHttpCalls, 1);
  assert.equal(closeSchedulerCalls, 1);

  releaseDrain();
  await close();
  assert.equal(releaseCalls, 1);
  assert.equal(closeHttpCalls, 1, "a retry never calls http.close twice");
  assert.equal(closeSchedulerCalls, 1, "a retry reuses the settled scheduler close");
});

test("server shutdown preserves an HTTP close failure and does not hand over the lease", async () => {
  const failure = new Error("http close failed");
  let releaseCalls = 0;
  let sessionDrainCalls = 0;
  const close = createFailClosedServerShutdown({
    stopRequestAdmission: () => undefined,
    closeHttp: async () => {
      throw failure;
    },
    drainRequestHandlers: async () => undefined,
    closeScheduler: async () => undefined,
    closeSse: () => undefined,
    drainSessionExecutions: async () => {
      sessionDrainCalls += 1;
    },
    flushActivity: async () => undefined,
    releaseStateLease: () => {
      releaseCalls += 1;
    },
  });

  await assert.rejects(close(), (error: unknown) => error === failure);
  assert.equal(sessionDrainCalls, 0);
  assert.equal(releaseCalls, 0);
});

test("server shutdown retains the lease until detached request handlers stop", async () => {
  let stopAdmissionCalls = 0;
  let releaseCalls = 0;
  let sessionDrainCalls = 0;
  let releaseHandlers!: () => void;
  const handlers = new Promise<void>((resolve) => {
    releaseHandlers = resolve;
  });
  const close = createFailClosedServerShutdown({
    stopRequestAdmission: () => {
      stopAdmissionCalls += 1;
    },
    closeHttp: async () => undefined,
    drainRequestHandlers: async () => await handlers,
    closeScheduler: async () => undefined,
    closeSse: () => undefined,
    drainSessionExecutions: async () => {
      sessionDrainCalls += 1;
    },
    flushActivity: async () => undefined,
    releaseStateLease: () => {
      releaseCalls += 1;
    },
    timeoutMs: 10,
  });

  await assert.rejects(
    close(),
    (error: unknown) => error instanceof ServerShutdownTimeoutError && error.phase === "handlers",
  );
  assert.equal(stopAdmissionCalls, 1);
  assert.equal(sessionDrainCalls, 0, "no session snapshot happens while a handler can enqueue");
  assert.equal(releaseCalls, 0);

  releaseHandlers();
  await close();
  assert.equal(stopAdmissionCalls, 1, "a retry keeps new request admission closed");
  assert.equal(sessionDrainCalls, 1);
  assert.equal(releaseCalls, 1);
});

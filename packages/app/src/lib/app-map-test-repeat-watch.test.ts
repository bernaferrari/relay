import assert from "node:assert/strict";
import test from "node:test";
import { watchActiveRepeat, type RepeatWorkflowWatchNotice } from "./app-map-test-repeat-watch.js";

test("active Repeat refreshes on newer events and gaps, with fallback only while disconnected", () => {
  let listener: ((notice: RepeatWorkflowWatchNotice) => void) | undefined;
  let fallback: (() => void) | undefined;
  let refreshes = 0;
  let cleared = false;
  let unsubscribed = false;
  let connected = true;
  const dispose = watchActiveRepeat({
    workflowId: "workflow-1",
    currentVersion: () => 2,
    sseConnected: () => connected,
    subscribe: (workflowId, next) => {
      assert.equal(workflowId, "workflow-1");
      listener = next;
      return () => {
        unsubscribed = true;
      };
    },
    refresh: () => {
      refreshes += 1;
    },
    timers: {
      setInterval: (callback, milliseconds) => {
        assert.equal(milliseconds, 15_000);
        fallback = callback;
        return 7;
      },
      clearInterval: (handle) => {
        assert.equal(handle, 7);
        cleared = true;
      },
    },
  });
  listener?.({ kind: "changed", version: 2, status: "active" });
  listener?.({ kind: "changed", version: 3, status: "active" });
  listener?.({ kind: "gap" });
  fallback?.();
  connected = false;
  fallback?.();
  assert.equal(refreshes, 3);
  dispose();
  assert.equal(unsubscribed, true);
  assert.equal(cleared, true);
});

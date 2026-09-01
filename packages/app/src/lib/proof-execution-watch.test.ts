import assert from "node:assert/strict";
import test from "node:test";
import { watchActiveProofExecution } from "./proof-execution-watch";

test("active Proof refreshes from events and polls only while disconnected", () => {
  let listener: ((notice: { kind: "changed"; cursor: number; status: string }) => void) | undefined;
  let fallback: (() => void) | undefined;
  let connected = true;
  let refreshes = 0;
  let unsubscribed = false;
  let cleared = false;
  const dispose = watchActiveProofExecution<number>({
    proofId: "proof-1",
    sseConnected: () => connected,
    subscribe: (proofId, next) => {
      assert.equal(proofId, "proof-1");
      listener = next as typeof listener;
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
        return 1;
      },
      clearInterval: (handle) => {
        assert.equal(handle, 1);
        cleared = true;
      },
    },
  });

  listener?.({ kind: "changed", cursor: 1, status: "running" });
  fallback?.();
  assert.equal(refreshes, 1);
  connected = false;
  fallback?.();
  assert.equal(refreshes, 2);
  dispose();
  assert.equal(unsubscribed, true);
  assert.equal(cleared, true);
});

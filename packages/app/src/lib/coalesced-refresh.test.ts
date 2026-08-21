import assert from "node:assert/strict";
import test from "node:test";
import { createCoalescedRefresh } from "./coalesced-refresh";

test("coalesces same-turn callers and preserves one trailing fresh read", async () => {
  let reads = 0;
  let releaseFirst!: (value: string) => void;
  const firstRead = new Promise<string>((resolve) => {
    releaseFirst = resolve;
  });
  const refresh = createCoalescedRefresh(async () => {
    reads += 1;
    return reads === 1 ? firstRead : "fresh";
  });

  const first = refresh();
  const concurrent = refresh();
  await Promise.resolve();
  assert.equal(reads, 1);

  const afterWrite = refresh();
  releaseFirst("stale");
  assert.deepEqual(await Promise.all([first, concurrent]), ["stale", "stale"]);

  await Promise.resolve();
  assert.equal(reads, 2);
  assert.equal(await afterWrite, "fresh");
});

test("a failed batch does not poison a later refresh", async () => {
  let reads = 0;
  const refresh = createCoalescedRefresh(async () => {
    reads += 1;
    if (reads === 1) throw new Error("temporary transport failure");
    return "recovered";
  });

  await assert.rejects(refresh(), /temporary transport failure/);
  assert.equal(await refresh(), "recovered");
  assert.equal(reads, 2);
});

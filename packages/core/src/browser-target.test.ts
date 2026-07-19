import assert from "node:assert/strict";
import test from "node:test";
import { performBrowserFind } from "./browser-target.js";

test("browser find implements click and existence semantics", async () => {
  let clicks = 0;
  const present = { count: async () => 1, click: async () => void (clicks += 1) };
  const absent = { count: async () => 0, click: async () => void (clicks += 1) };

  assert.deepEqual(await performBrowserFind(present, "Continue", "exists"), {
    ok: true,
    exists: true,
  });
  await assert.rejects(performBrowserFind(absent, "Missing", "exists"), /No match/);
  await performBrowserFind(present, "Continue", "click");
  await performBrowserFind(present, "Continue", "press");
  assert.equal(clicks, 2);
  await assert.rejects(performBrowserFind(present, "Continue", "unknown"), /unsupported/);
});

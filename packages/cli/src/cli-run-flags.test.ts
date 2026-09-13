import assert from "node:assert/strict";
import test from "node:test";
import { assertPlanCliFlags, parseBudgetMs, startedPlanBatchId } from "./cli-run-flags.js";

test("parses budget units used by the three-minute findings loop", () => {
  assert.equal(parseBudgetMs("3m"), 180_000);
  assert.equal(parseBudgetMs("180s"), 180_000);
  assert.throws(() => parseBudgetMs("3"), /--budget must look like/);
});

test("budget and findings flags stay on Plan commands", () => {
  const tokens = {
    values: new Map([["--budget", "3m"]]),
    switches: new Set(["--findings"]),
  };
  assert.doesNotThrow(() => assertPlanCliFlags("job.combine.start", tokens));
  assert.throws(() => assertPlanCliFlags("job.get", tokens), /--budget is only valid/);
});

test("reads campaign id from a Combine start result", () => {
  assert.equal(
    startedPlanBatchId({ campaign: { id: "camp-1" }, batch: { id: "batch-1" } }),
    "camp-1",
  );
  assert.equal(startedPlanBatchId({ batch: { id: "batch-1" } }), "batch-1");
});

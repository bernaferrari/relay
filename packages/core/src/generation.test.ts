import assert from "node:assert/strict";
import test from "node:test";
import { generateValues } from "./generation.js";

test("deterministic generation is reproducible", async () => {
  const input = {
    purpose: "variable" as const,
    prompt: "A city",
    provider: "deterministic",
    count: 3,
    seed: 42,
  };
  const first = await generateValues(input);
  const second = await generateValues(input);
  assert.deepEqual(first.values, second.values);
  assert.equal(first.values.length, 3);
});

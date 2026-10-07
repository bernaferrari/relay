import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition } from "./operations.js";

const input = {
  appMapId: "grok-android",
  testId: "chat",
  expectedRevision: 1,
  target: { kind: "device", platform: "android", targetId: "pixel" },
};

test("saved Test transport retains bounded runtime prompt values", () => {
  const supplied = { ...input, variables: { chat_prompt: "Ask about sailboats." } };
  assert.deepEqual(operationDefinition("app-map.test.run").input.parse(supplied), supplied);
});

test("runtime Test inputs cannot be silently dropped by Repeat admission", () => {
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        variables: { chat_prompt: "Ask about sailboats." },
        in: { language: ["en"] },
      }),
    /variables.*in|in.*variables/,
  );
});

test("Test input values reject arrays, invalid names, and oversized payloads", () => {
  for (const variables of [
    { prompt: ["a", "b"] },
    { "bad name": "a" },
    { prompt: "a".repeat(20_001) },
  ]) {
    assert.throws(() =>
      operationDefinition("app-map.test.run").input.parse({ ...input, variables }),
    );
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { measureBoundedJsonValue, type JsonValueBounds } from "./json-value-bounds.js";

const limits: JsonValueBounds = {
  maxDepth: 4,
  maxStringBytes: 64,
  maxArrayItems: 4,
  maxObjectEntries: 4,
  maxNodes: 16,
  maxSerializedBytes: 128,
};

test("bounded JSON measurement counts the actual UTF-8 serialization", () => {
  const value = { escaped: 'é\n"' };
  assert.deepEqual(measureBoundedJsonValue(value, limits), {
    nodes: 2,
    serializedBytes: Buffer.byteLength(JSON.stringify(value)),
  });
});

test("bounded JSON measurement rejects depth, containers, strings, and serialized bytes", () => {
  assert.throws(
    () => measureBoundedJsonValue({ a: { b: { c: { d: { e: true } } } } }, limits),
    /depth/u,
  );
  assert.throws(() => measureBoundedJsonValue([1, 2, 3, 4, 5], limits), /array length/u);
  assert.throws(() => measureBoundedJsonValue("x".repeat(65), limits), /string/u);
  assert.throws(
    () =>
      measureBoundedJsonValue(
        { payload: "x".repeat(60) },
        { ...limits, maxStringBytes: 128, maxSerializedBytes: 32 },
      ),
    /serialized bytes/u,
  );
});

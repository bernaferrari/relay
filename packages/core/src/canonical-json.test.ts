import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";

test("canonical JSON is independent of object insertion order", () => {
  const left = { z: 1, nested: { b: true, a: "value" }, array: [3, 2, 1] };
  const right = { array: [3, 2, 1], nested: { a: "value", b: true }, z: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(canonicalSha256(left), canonicalSha256(right));
});

test("canonical JSON uses locale-independent UTF-16 key ordering", () => {
  assert.equal(canonicalJson({ ä: 1, Z: 2, a: 3, "😀": 4 }), '{"Z":2,"a":3,"ä":1,"😀":4}');
});

test("canonical JSON preserves ordinary JSON projection semantics", () => {
  assert.equal(
    canonicalJson({ omitted: undefined, array: [undefined, Number.NaN], kept: null }),
    '{"array":[null,null],"kept":null}',
  );
  assert.throws(() => canonicalJson(undefined), /JSON-compatible root/u);
  assert.throws(() => canonicalJson(1n), TypeError);
});

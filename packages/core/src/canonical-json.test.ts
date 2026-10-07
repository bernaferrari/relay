import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("browser-safe canonical SHA-256 preserves native digest bytes", () => {
  const fixtures: unknown[] = [
    null,
    true,
    1.25,
    "",
    "中文 · العربية · 😀 · \\ud800",
    { ä: 1, Z: 2, a: 3, "😀": 4 },
    { omitted: undefined, array: [undefined, Number.NaN, Number.POSITIVE_INFINITY], kept: null },
    { toJSON: () => ({ z: "projection", a: new Date("2026-10-07T00:00:00Z") }) },
    { id: "device:fixture-1112x834", platform: "ios", viewport: { width: 1112, height: 834 } },
  ];
  for (const value of fixtures) {
    const expected = `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
    assert.equal(canonicalSha256(value), expected);
  }
});

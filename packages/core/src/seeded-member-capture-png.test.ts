import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertSeededMemberPng } from "./seeded-member-capture-png.js";

test("HTML identity is not a Seeded Member PNG capture", () => {
  const html = Buffer.from('<html id="team-seats">5</html>');
  const tiny = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  assert.throws(() => assertSeededMemberPng(html), /not a persisted PNG/u);
  assert.throws(() => assertSeededMemberPng(tiny), /not a persisted PNG/u);
  assert.notEqual(
    createHash("sha256").update(html).digest("hex"),
    createHash("sha256").update(tiny).digest("hex"),
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { REDACTED, redactResolvedInputs, redactValue } from "./redaction.js";

test("redaction removes credentials, clipboard values, headers, and URL queries", () => {
  const sentinel = "relay-secret-sentinel";
  const redacted = redactValue({
    authorization: `Bearer ${sentinel}`,
    clipboard: sentinel,
    url: `https://example.test/path?token=${sentinel}`,
    nested: { cookie: sentinel },
  });
  assert.equal(JSON.stringify(redacted).includes(sentinel), false);
  assert.equal((redacted as { clipboard: string }).clipboard, REDACTED);
  assert.equal(redactResolvedInputs({ password: sentinel }).password?.includes(sentinel), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { interactionBody } from "./server-interaction";

test("builds stable interaction payloads", () => {
  assert.deepEqual(interactionBody({ kind: "label", label: "Send" }), {
    kind: "label",
    label: "Send",
  });
  assert.deepEqual(interactionBody({ kind: "swipe", from: { x: 1, y: 2 }, to: { x: 3, y: 4 } }), {
    kind: "swipe",
    from: { x: 1, y: 2 },
    to: { x: 3, y: 4 },
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { nodeMatchesTarget, nodeText } from "./recipe-target-match.js";

test("browser accessible names match targets without becoming response content", () => {
  const empty = { role: "status", label: "Assistant response", content: "" };
  assert.equal(nodeMatchesTarget(empty, { text: "Assistant response" }), true);
  assert.deepEqual(nodeText(empty), []);

  const answer = { ...empty, content: "Hello! RELAY-QA-OK" };
  assert.deepEqual(nodeText(answer), ["Hello! RELAY-QA-OK"]);

  const filled = { role: "textarea", label: "Message", content: "typed prompt" };
  assert.deepEqual(nodeText(filled), ["typed prompt"]);
  assert.equal(nodeMatchesTarget(filled, { label: "Message" }), true);
});

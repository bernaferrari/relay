import assert from "node:assert/strict";
import test from "node:test";
import { labelsForScope, nodeMatchesTarget, nodeText } from "./recipe-target-match.js";

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

test("labelsForScope uses rect containment when parentIndex is omitted", () => {
  const nodes = [
    {
      index: 26,
      role: "menu",
      label: "Upload a file\nAdd to project\nRecent files",
      rect: { x: 400, y: 500, width: 280, height: 160 },
    },
    {
      index: 27,
      role: "menuitem",
      label: "Upload a file",
      rect: { x: 410, y: 510, width: 260, height: 40 },
    },
    {
      index: 28,
      role: "menuitem",
      label: "Add to project",
      rect: { x: 410, y: 550, width: 260, height: 40 },
    },
    {
      index: 29,
      role: "menuitem",
      label: "Recent files",
      rect: { x: 410, y: 590, width: 260, height: 40 },
    },
    {
      index: 8,
      role: "button",
      label: "Sign in",
      rect: { x: 1100, y: 12, width: 80, height: 32 },
    },
  ];
  assert.deepEqual(labelsForScope(nodes, { role: "menu", text: "Upload a file" }), [
    "Add to project",
    "Recent files",
    "Upload a file",
  ]);
});

test("labelsForScope prefers menu option roles over group chrome", () => {
  const nodes = [
    {
      index: 26,
      role: "menu",
      label: "Language\nFeedback",
      rect: { x: 900, y: 40, width: 220, height: 200 },
    },
    {
      index: 27,
      role: "group",
      label: "Theme",
      rect: { x: 910, y: 50, width: 200, height: 40 },
    },
    {
      index: 28,
      role: "menuitemradio",
      label: "Light",
      rect: { x: 912, y: 52, width: 40, height: 36 },
    },
    {
      index: 29,
      role: "menuitemradio",
      label: "Dark",
      rect: { x: 956, y: 52, width: 40, height: 36 },
    },
    {
      index: 30,
      role: "menuitemradio",
      label: "System",
      rect: { x: 1000, y: 52, width: 40, height: 36 },
    },
    {
      index: 31,
      role: "menuitem",
      label: "Language",
      rect: { x: 910, y: 100, width: 200, height: 36 },
    },
    {
      index: 32,
      role: "menuitem",
      label: "Feedback",
      rect: { x: 910, y: 140, width: 200, height: 36 },
    },
  ];
  assert.deepEqual(labelsForScope(nodes, { role: "menu", text: "Feedback" }), [
    "Dark",
    "Feedback",
    "Language",
    "Light",
    "System",
  ]);
});

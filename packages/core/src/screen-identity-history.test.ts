import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import {
  conversationHistoryLabels,
  isConversationHistoryNode,
} from "./screen-identity-history.js";
import { compareScreenIdentity, observeScreenIdentity } from "./screen-identity.js";

function observe(nodes: SnapshotNode[]) {
  return observeScreenIdentity(nodes);
}

function signedInChrome(history: readonly string[]): SnapshotNode[] {
  return [
    { role: "a", label: "Home page", hittable: true, visibleToUser: true },
    { role: "a", label: "Imagine", hittable: true, visibleToUser: true },
    { role: "a", label: "Library", hittable: true, visibleToUser: true },
    { role: "a", label: "Skip to main content", hittable: true, visibleToUser: true },
    { role: "a", label: "Switch to private chat", hittable: true, visibleToUser: true },
    { role: "a", label: "Chat", identifier: "new-chat", hittable: true, visibleToUser: true },
    { role: "button", label: "Attach", identifier: "attach-button", hittable: true, visibleToUser: true },
    {
      role: "button",
      label: "Model select",
      identifier: "model-select-trigger",
      hittable: true,
      visibleToUser: true,
    },
    { role: "button", label: "BF Bernardo Ferrari", hittable: true, visibleToUser: true },
    { role: "h1", label: "What should we explore?", visibleToUser: true },
    { role: "textbox", label: "Ask Grok anything", hittable: true, visibleToUser: true },
    ...history.flatMap((label) => [
      {
        role: "a" as const,
        label,
        rect: { x: 12, y: 220, width: 240, height: 36 },
        hittable: true,
        visibleToUser: true,
      },
      { role: "text" as const, label, visibleToUser: true },
    ]),
  ];
}

test("conversation history labels are not chrome", () => {
  const nodes: SnapshotNode[] = [
    { role: "a", label: "Paris capital of France" },
    { role: "text", label: "Paris capital of France" },
    { role: "a", label: "cape verde has 10 islands" },
    { role: "text", label: "cape verde has 10 islands" },
    { role: "a", label: "Imagine" },
    { role: "a", label: "Library" },
    { role: "a", label: "Home page" },
    { role: "a", label: "Skip to main content" },
    { role: "a", label: "Switch to private chat" },
    { role: "a", label: "Chat", identifier: "new-chat" },
    { role: "a", label: "Upload a file" },
    { role: "a", label: "3x5 equals 15" },
    { role: "a", label: "paris, france's capital" },
    { role: "a", label: "paris: france's capital and cultural hub" },
    { role: "text", label: "Friday, July 31, 2026" },
  ];
  const history = conversationHistoryLabels(nodes);
  assert.equal(history.has("paris capital of france"), true);
  assert.equal(history.has("cape verde has 10 islands"), true);
  assert.equal(history.has("paris: france's capital and cultural hub"), true);
  assert.equal(history.has("3x5 equals 15"), true);
  assert.equal(history.has("paris, france's capital"), true);
  assert.equal(history.has("imagine"), false);
  assert.equal(history.has("friday, july 31, 2026"), false);
  assert.equal(isConversationHistoryNode(nodes[0]!, history), true);
  assert.equal(isConversationHistoryNode(nodes[1]!, history), true);
  assert.equal(isConversationHistoryNode(nodes[4]!, history), false);
  assert.equal(isConversationHistoryNode(nodes[7]!, history), false);
  assert.equal(isConversationHistoryNode(nodes[8]!, history), false);
  assert.equal(isConversationHistoryNode(nodes[9]!, history), false);
  assert.equal(isConversationHistoryNode(nodes[10]!, history), false);
  assert.equal(isConversationHistoryNode(nodes[11]!, history), true);
  assert.equal(isConversationHistoryNode(nodes[12]!, history), true);
  assert.equal(isConversationHistoryNode(nodes[13]!, history), true);
  assert.equal(isConversationHistoryNode(nodes[14]!, history), false);
});

test("sidebar history does not redefine signed-in home, even in the nav rail", () => {
  const first = observe(signedInChrome(["3x5 equals 15", "Paris capital of France"]));
  const second = observe(
    signedInChrome(["paris, france's capital", "Generate 42 bird images"]),
  );
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(compareScreenIdentity(first, second).decision, "match");
  assert.ok(first.nodes.some((node) => node.label === "library"));
  assert.ok(first.nodes.some((node) => node.label === "switch to private chat"));
  assert.ok(!first.nodes.some((node) => node.label === "paris capital of france"));
  assert.ok(!second.nodes.some((node) => node.label === "generate 42 bird images"));
});

test("an attach menu is a different screen once history is ignored", () => {
  const home = observe(signedInChrome(["Paris capital of France"]));
  const attach = observe([
    ...signedInChrome(["Paris capital of France"]),
    { role: "menuitem", label: "Upload a file", hittable: true, visibleToUser: true },
    { role: "menuitem", label: "Add to project", hittable: true, visibleToUser: true },
    { role: "menuitem", label: "Recent files", hittable: true, visibleToUser: true },
  ]);
  assert.notEqual(home.fingerprint, attach.fingerprint);
  assert.ok(attach.nodes.some((node) => node.label === "upload a file"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { GROK_WEB_APP_POLICY } from "./app-identity-policy.js";
import type { SnapshotNode } from "./device.js";
import { conversationHistoryLabels, isConversationHistoryNode } from "./screen-identity-history.js";
import { compareScreenIdentity, observeScreenIdentity } from "./screen-identity.js";

function observe(nodes: SnapshotNode[]) {
  return observeScreenIdentity(nodes, { policy: GROK_WEB_APP_POLICY });
}

function signedInChrome(history: readonly string[]): SnapshotNode[] {
  return [
    { role: "a", label: "Home page", hittable: true, visibleToUser: true },
    { role: "a", label: "Imagine", hittable: true, visibleToUser: true },
    { role: "a", label: "Library", hittable: true, visibleToUser: true },
    { role: "a", label: "Skip to main content", hittable: true, visibleToUser: true },
    { role: "a", label: "Switch to private chat", hittable: true, visibleToUser: true },
    { role: "a", label: "Chat", identifier: "new-chat", hittable: true, visibleToUser: true },
    {
      role: "button",
      label: "Attach",
      identifier: "attach-button",
      hittable: true,
      visibleToUser: true,
    },
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
  const history = conversationHistoryLabels(nodes, GROK_WEB_APP_POLICY);
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
  const second = observe(signedInChrome(["paris, france's capital", "Generate 42 bird images"]));
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(compareScreenIdentity(first, second).decision, "match");
  assert.ok(first.nodes.some((node) => node.label === "library"));
  assert.ok(first.nodes.some((node) => node.label === "switch to private chat"));
  assert.ok(!first.nodes.some((node) => node.label === "paris capital of france"));
  assert.ok(!second.nodes.some((node) => node.label === "generate 42 bird images"));
});

function openConversationChrome(transcript: string): SnapshotNode[] {
  return [
    { role: "a", label: "Home page", hittable: true, visibleToUser: true },
    { role: "a", label: "Imagine", hittable: true, visibleToUser: true },
    { role: "a", label: "Library", hittable: true, visibleToUser: true },
    { role: "a", label: "Chat", identifier: "new-chat", hittable: true, visibleToUser: true },
    {
      role: "button",
      label: "Attach",
      identifier: "attach-button",
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "button",
      label: "Model select",
      identifier: "model-select-trigger",
      hittable: true,
      visibleToUser: true,
    },
    { role: "button", label: "BF Bernardo Ferrari", hittable: true, visibleToUser: true },
    {
      role: "textbox",
      label: "Ask Grok anything",
      rect: { x: 400, y: 675, width: 726, height: 42 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "article",
      label: "You",
      value: transcript,
      identifier: "user-message",
      rect: { x: 400, y: 200, width: 200, height: 40 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "article",
      label: "Grok",
      value: `${transcript} reply`,
      identifier: "assistant-message",
      rect: { x: 200, y: 260, width: 400, height: 80 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "button",
      label: "Copy response",
      rect: { x: 200, y: 360, width: 120, height: 32 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "button",
      label: "Regenerate",
      rect: { x: 340, y: 360, width: 100, height: 32 },
      hittable: true,
      visibleToUser: true,
    },
  ];
}

test("an open chat is not empty signed-in home without using transcript text", () => {
  const home = observe(signedInChrome(["Relay older Zinnia load"]));
  const firstChat = observe(openConversationChrome("Relay older Zinnia load"));
  const secondChat = observe(openConversationChrome("Paris is the capital of France"));
  assert.notEqual(home.fingerprint, firstChat.fingerprint);
  assert.notEqual(compareScreenIdentity(home, firstChat).decision, "match");
  assert.ok(home.nodes.some((node) => node.label === "what should we explore?"));
  assert.ok(!firstChat.nodes.some((node) => node.label === "what should we explore?"));
  assert.ok(firstChat.nodes.some((node) => node.label === "copy response"));
  assert.ok(firstChat.nodes.some((node) => node.identifier === "assistant-message"));
  assert.ok(!firstChat.nodes.some((node) => (node.value ?? "").includes("zinnia")));
  assert.ok(!firstChat.nodes.some((node) => (node.label ?? "").includes("zinnia")));
  assert.equal(firstChat.fingerprint, secondChat.fingerprint);
  assert.equal(compareScreenIdentity(firstChat, secondChat).decision, "match");
});

test("offscreen You/Grok articles do not put transcript text in identity", () => {
  const chrome = openConversationChrome("Relay older Zinnia load");
  const leaked: SnapshotNode[] = [
    ...chrome,
    {
      role: "article",
      label: "You",
      value: "Relay older Zinnia load",
      rect: { x: 900, y: -96, width: 200, height: 38 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "p",
      label: "Relay older Zinnia load",
      rect: { x: 400, y: 34, width: 400, height: 45 },
      visibleToUser: true,
    },
    {
      role: "div",
      identifier: "last-reply-container",
      label: "2+2\n\n4",
      rect: { x: 416, y: 432, width: 400, height: 80 },
      visibleToUser: true,
    },
    {
      role: "div",
      identifier: "response-c37ac99d-7d57-4f19-8fc4-adc626579178",
      label: "Relay older Zinnia load",
      rect: { x: 416, y: -96, width: 400, height: 82 },
      visibleToUser: true,
    },
  ];
  const other: SnapshotNode[] = leaked.map((node) => {
    const next = { ...node };
    if (next.value?.includes("Zinnia") || next.value === "2+2\n\n4")
      next.value = "Paris is the capital";
    if (
      (next.label?.includes("Zinnia") || next.label === "2+2\n\n4") &&
      !/^(?:you|grok)$/iu.test(next.label ?? "")
    ) {
      next.label = "Paris is the capital";
    }
    return next;
  });
  const first = observe(leaked);
  const second = observe(other);
  assert.ok(first.nodes.some((node) => node.identifier === "last-reply-container"));
  assert.ok(first.nodes.some((node) => node.label === "copy response"));
  assert.ok(
    !first.nodes.some((node) =>
      /zinnia|2\+2|paris/i.test(`${node.label ?? ""} ${node.value ?? ""}`),
    ),
  );
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(
    compareScreenIdentity(observe(signedInChrome(["Relay older Zinnia load"])), first).decision,
    "match",
  );
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

import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import { defaultComposer, findSendControl, promptTarget, replyText } from "./device-prompt.js";
import type { InteractInput } from "./workspace-interact.js";

const rect = (x: number, y: number, width = 100, height = 40) => ({ x, y, width, height });
const composer: SnapshotNode = {
  identifier: "chat_input",
  editable: true,
  rect: rect(20, 2000, 800, 80),
};
const history: SnapshotNode[] = [
  { label: "Earlier answer", rect: rect(20, 400) },
  { label: "Copy", hittable: true, rect: rect(20, 500) },
];
const sendButton: SnapshotNode = {
  label: "Send message",
  hittable: true,
  rect: rect(900, 2010, 80, 60),
};

function fakeDevice(screens: SnapshotNode[][]) {
  const calls: InteractInput[] = [];
  let index = 0;
  let clock = 0;
  return {
    calls,
    deps: {
      interact: async (input: InteractInput) => {
        calls.push(input);
        return input.kind === "replace"
          ? {
              resolution: {
                method: "identifier" as const,
                point: { x: 420, y: 2040 },
                bounds: rect(20, 2000, 800, 80),
              },
            }
          : {};
      },
      nodes: async () => screens[Math.min(index++, screens.length - 1)]!,
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    },
  };
}

test("defaultComposer prefers the focused field, else the lowest unique editable", () => {
  const search: SnapshotNode = {
    identifier: "search",
    editable: true,
    rect: rect(0, 100, 800, 60),
  };
  assert.deepEqual(defaultComposer([search, composer]), { identifier: "chat_input" });
  assert.deepEqual(defaultComposer([{ ...search, focused: true }, composer]), {
    identifier: "search",
  });
  const twin = { ...composer, rect: rect(20, 1000, 800, 80) };
  assert.deepEqual(defaultComposer([twin, composer]), { point: { x: 420, y: 2040 } });
  assert.equal(defaultComposer(history), undefined);
});

test("findSendControl picks the nearest enabled Send control", () => {
  const far: SnapshotNode = { label: "Send feedback", hittable: true, rect: rect(0, 100) };
  assert.equal(findSendControl([far, sendButton], { x: 420, y: 2040 })?.label, "Send message");
  assert.equal(findSendControl([{ ...sendButton, enabled: false }], { x: 0, y: 0 }), undefined);
});

test("replyText drops prior screen text, the prompt echo, and busy controls", () => {
  const before = new Set(["Earlier answer", "Copy"]);
  const nodes: SnapshotNode[] = [
    ...history,
    { label: "hello", rect: rect(0, 600) },
    { label: "Hi! How can I help?", rect: rect(0, 700) },
    { label: "Stop", rect: rect(0, 800) },
  ];
  assert.deepEqual(replyText(nodes, before, "hello"), ["Hi! How can I help?"]);
});

test("promptTarget types, taps Send, and waits for the reply to settle", async () => {
  const typed = [...history, composer, sendButton];
  const thinking = [
    ...history,
    { label: "hello", rect: rect(0, 600) },
    { label: "Thinking for 1s", rect: rect(0, 700) },
    { label: "Stop", rect: rect(0, 800) },
    composer,
  ];
  const streaming = [
    ...history,
    { label: "hello", rect: rect(0, 600) },
    { label: "Hi!", rect: rect(0, 700) },
    { label: "Stop", rect: rect(0, 800) },
    composer,
  ];
  const done = [
    ...history,
    { label: "hello", rect: rect(0, 600) },
    { label: "Hi! How can I help?", rect: rect(0, 700) },
    composer,
  ];
  const { calls, deps } = fakeDevice([
    [...history, composer],
    typed,
    thinking,
    streaming,
    ...Array(10).fill(done),
  ]);

  const result = await promptTarget({ text: "hello", stableForMs: 900 }, deps);

  assert.deepEqual(calls[0], {
    kind: "replace",
    text: "hello",
    target: { identifier: "chat_input" },
  });
  assert.deepEqual(calls[1], { kind: "point", x: 940, y: 2040 });
  assert.equal(result.sent.method, "control");
  assert.equal(result.reply.status, "idle");
  assert.deepEqual(result.reply.newText, ["Hi! How can I help?"]);
});

test("promptTarget falls back to Enter and can skip waiting", async () => {
  const { calls, deps } = fakeDevice([[composer]]);
  const result = await promptTarget({ text: "hi", wait: false }, deps);
  assert.deepEqual(calls.at(-1), { kind: "key", key: "enter" });
  assert.equal(result.reply.status, "not-waited");
});

test("promptTarget times out while the app still shows a busy control", async () => {
  const busy = [
    composer,
    { label: "Thinking", rect: rect(0, 700) },
    { label: "Stop", rect: rect(0, 800) },
  ];
  const { deps } = fakeDevice([[composer], busy]);
  const result = await promptTarget({ text: "hi", send: "enter", timeoutMs: 3_000 }, deps);
  assert.equal(result.reply.status, "timeout");
  assert.deepEqual(result.reply.newText, ["Thinking"]);
});

test("promptTarget explains a missing composer", async () => {
  const { deps } = fakeDevice([history]);
  await assert.rejects(promptTarget({ text: "hi" }, deps), /No editable composer is visible/u);
});

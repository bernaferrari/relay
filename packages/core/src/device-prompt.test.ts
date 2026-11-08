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
  const before = new Map([
    ["Earlier answer", 1],
    ["Copy", 1],
  ]);
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

test("promptTarget recognizes a second identical answer in the conversation", async () => {
  const before = [...history, composer];
  const done = [...history, { label: "Earlier answer", rect: rect(20, 800) }, composer];
  const { deps } = fakeDevice([before, ...Array(8).fill(done)]);
  const result = await promptTarget(
    { text: "repeat the earlier answer", send: "enter", stableForMs: 600, timeoutMs: 2400 },
    deps,
  );
  assert.equal(result.reply.status, "idle");
  assert.deepEqual(result.reply.newText, ["Earlier answer"]);
});

test("promptTarget does not count busy time toward idle stability", async () => {
  const answer = { label: "A new answer", rect: rect(20, 800) };
  const busy = [composer, answer, { label: "Stop message", rect: rect(20, 900) }];
  const done = [composer, answer];
  const { deps } = fakeDevice([[composer], ...Array(6).fill(busy), ...Array(8).fill(done)]);
  const result = await promptTarget(
    { text: "hello", send: "enter", stableForMs: 900, timeoutMs: 5000 },
    deps,
  );
  assert.equal(result.reply.status, "idle");
  assert.equal(result.reply.waitedMs, 2700);
});

test("unchanged prior answers never count as a new reply", async () => {
  const { deps } = fakeDevice([[...history, composer]]);
  const result = await promptTarget(
    { text: "hello", send: "enter", stableForMs: 300, timeoutMs: 1200 },
    deps,
  );
  assert.equal(result.reply.status, "timeout");
  assert.deepEqual(result.reply.newText, []);
});

test("a new connection failure is an error, not a completed reply", async () => {
  const { deps } = fakeDevice([
    [composer],
    [composer, { label: "Connection failed. Try again", rect: rect(20, 800) }],
  ]);
  const result = await promptTarget({ text: "hello", send: "enter", timeoutMs: 2000 }, deps);
  assert.equal(result.reply.status, "error");
});

test("an assistant answer discussing retries is not a quota banner", async () => {
  const { deps } = fakeDevice([
    [composer],
    [
      composer,
      {
        identifier: "assistant-message",
        value: "Try again later is a useful phrase",
        rect: rect(20, 800),
      },
    ],
  ]);
  const result = await promptTarget(
    { text: "hello", send: "enter", stableForMs: 300, timeoutMs: 2000 },
    deps,
  );
  assert.equal(result.reply.status, "idle");
});

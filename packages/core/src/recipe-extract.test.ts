import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import { extractNewestCompletedAssistantTurn } from "./recipe-extract.js";

function grokPageAfterAsk(options: {
  newest: string;
  older?: string;
  quota?: string;
  echo?: string;
  failed?: string;
}): SnapshotNode[] {
  return [
    { role: "a", label: "Paris capital of France", hittable: true, visibleToUser: true },
    ...(options.quota
      ? [{ role: "text", label: options.quota, visibleToUser: true } satisfies SnapshotNode]
      : []),
    ...(options.echo
      ? [
          {
            role: "article",
            label: "You",
            identifier: "user-message",
            value: options.echo,
            rect: { x: 400, y: 180, width: 200, height: 32 },
            visibleToUser: true,
          } satisfies SnapshotNode,
        ]
      : []),
    ...(options.older
      ? [
          {
            role: "article",
            label: "Grok",
            identifier: "assistant-message",
            value: options.older,
            rect: { x: 200, y: 240, width: 400, height: 48 },
            visibleToUser: true,
          } satisfies SnapshotNode,
        ]
      : []),
    {
      role: "article",
      label: "Grok",
      identifier: "assistant-message",
      value: options.newest,
      rect: { x: 200, y: 420, width: 400, height: 48 },
      visibleToUser: true,
    },
    ...(options.failed
      ? [{ role: "text", label: options.failed, visibleToUser: true } satisfies SnapshotNode]
      : []),
  ];
}

const TARGET = { text: "4" };

test("assistant extract uses the newest completed turn, not quota, echo, or history", () => {
  const text = extractNewestCompletedAssistantTurn(
    grokPageAfterAsk({
      newest: "4",
      older: "The previous answer was 4.5",
      quota: "Try again in 4 minutes",
      echo: "What is 2+2? 4",
      failed: "Model v4 failed; no answer generated",
    }),
    TARGET,
  );
  assert.equal(text, "4");
});

test("assistant extract does not treat a quota four as the generated answer", () => {
  const text = extractNewestCompletedAssistantTurn(
    grokPageAfterAsk({
      newest: "Paris is in France.",
      quota: "Try again in 4 minutes",
      failed: "4 minutes remaining",
    }),
    { identifier: "assistant-message" },
  );
  assert.equal(text, "Paris is in France.");
});

test("leftover 15 is history, not the current 2+2 assistant turn", () => {
  const leftoverOnly = grokPageAfterAsk({
    newest: "15",
    echo: "2+2",
    quota: "Free tier limit reached. Try again later.",
  }).map((node) =>
    node.identifier === "user-message"
      ? { ...node, rect: { x: 400, y: 500, width: 200, height: 32 } }
      : node,
  );
  const leftover = leftoverOnly.find((node) => node.identifier === "assistant-message");
  assert.ok(leftover);
  leftover.rect = { x: 200, y: 240, width: 400, height: 48 };
  assert.throws(
    () => extractNewestCompletedAssistantTurn(leftoverOnly, { identifier: "assistant-message" }),
    /no completed assistant turn matched the current action/u,
  );

  const generated = grokPageAfterAsk({
    older: "15",
    newest: "4",
    echo: "2+2",
  }).map((node) =>
    node.identifier === "user-message"
      ? { ...node, rect: { x: 400, y: 330, width: 200, height: 32 } }
      : node,
  );
  assert.equal(
    extractNewestCompletedAssistantTurn(generated, { identifier: "assistant-message" }),
    "4",
  );
});

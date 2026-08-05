import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthoringInteraction } from "@relay/protocol";
import type { RecordingTakeAction } from "../context/recorder";
import {
  interactionForAction,
  interactionWithKind,
  moveActionIds,
  takeActionError,
  targetWithStrategy,
} from "./take-action-model";

function action(
  id: string,
  steps: RecordingTakeAction["steps"],
  label?: string,
): RecordingTakeAction {
  return {
    id,
    source: "captured",
    steps,
    stepStartIndex: 0,
    ...(label ? { label } : {}),
  };
}

test("recorded actions convert to canonical replacement interactions without losing groups", () => {
  assert.deepEqual(
    interactionForAction(action("tap", [{ kind: "tap", target: { label: "Continue" } }])),
    { kind: "tap", target: { label: "Continue" } },
  );
  assert.deepEqual(interactionForAction(action("wait", [{ kind: "sleep", ms: 350 }])), {
    kind: "wait",
    ms: 350,
  });
  assert.deepEqual(
    interactionForAction(
      action("paste", [
        {
          kind: "clipboard",
          action: "paste",
          text: "hello\nworld",
          target: { identifier: "chat_text_input" },
        },
      ]),
    ),
    {
      kind: "clipboard",
      action: "paste",
      text: "hello\nworld",
      target: { identifier: "chat_text_input" },
    },
  );
  assert.deepEqual(
    interactionForAction(action("switcher", [{ kind: "app", action: "switcher" }])),
    { kind: "app", action: "switcher" },
  );
  assert.deepEqual(
    interactionForAction(
      action("routine", [{ kind: "module", recipeId: "login", bindings: { email: "me" } }]),
    ),
    { kind: "reusable", recipeId: "login", bindings: { email: "me" } },
  );

  const grouped = action(
    "grouped",
    [
      { kind: "tap", target: { text: "Send" } },
      { kind: "sleep", ms: 200 },
    ],
    "Send safely",
  );
  assert.deepEqual(interactionForAction(grouped), {
    kind: "steps",
    steps: grouped.steps,
    label: "Send safely",
  });
  assert.deepEqual(interactionForAction(action("observe", [], "Wait for redirect")), {
    kind: "observe",
    label: "Wait for redirect",
  });
});

test("changing action kind preserves compatible targets and gives usable defaults", () => {
  const current: AuthoringInteraction = {
    kind: "tap",
    target: {
      ref: "@continue",
      point: { x: 40, y: 80, referenceBounds: { width: 100, height: 200 } },
    },
  };
  assert.deepEqual(interactionWithKind(current, "type"), {
    kind: "type",
    text: "",
    target: current.target,
  });
  assert.deepEqual(interactionWithKind(current, "key"), { kind: "key", key: "back" });
  assert.deepEqual(interactionWithKind(current, "wait"), { kind: "wait", ms: 1_000 });
  assert.deepEqual(interactionWithKind(current, "device"), {
    kind: "device",
    action: "keyboard-dismiss",
  });
});

test("retargeting keeps the coordinate fallback and removes conflicting semantic selectors", () => {
  const original = {
    ref: "@old",
    label: "Old label",
    point: {
      x: 40,
      y: 80,
      anchor: { horizontal: "left" as const, vertical: "top" as const },
      referenceBounds: { width: 100, height: 200 },
    },
  };
  assert.deepEqual(targetWithStrategy(original, "label", "Continue"), {
    label: "Continue",
    point: original.point,
  });
  assert.deepEqual(targetWithStrategy(original, "ref", "submit"), {
    ref: "@submit",
    point: original.point,
  });
  assert.deepEqual(targetWithStrategy(original, "point", "55, 90"), {
    point: { ...original.point, x: 55, y: 90 },
  });
});

test("reorder always emits every canonical action exactly once", () => {
  const actions = [action("a", []), action("b", []), action("c", [])];
  assert.deepEqual(moveActionIds(actions, "a", 2), ["b", "c", "a"]);
  assert.deepEqual(moveActionIds(actions, "c", -10), ["c", "a", "b"]);
  assert.deepEqual(moveActionIds(actions, "missing", 1), ["a", "b", "c"]);
});

test("replacement validation blocks incomplete or unsafe action drafts", () => {
  assert.equal(takeActionError({ kind: "tap", target: {} }), "Choose what Relay should tap.");
  assert.equal(takeActionError({ kind: "type", text: "" }), "Enter the text Relay should type.");
  assert.equal(
    takeActionError({ kind: "swipe", from: { x: -1, y: 0 }, to: { x: 1, y: 2 } }),
    "Swipe coordinates must be zero or greater.",
  );
  assert.equal(takeActionError({ kind: "wait", ms: -1 }), "Wait time must be zero or greater.");
  assert.equal(
    takeActionError({ kind: "clipboard", action: "copy" }),
    "Choose the text field or element to copy from.",
  );
  assert.equal(
    takeActionError({ kind: "clipboard", action: "paste", text: "hello" }),
    "Choose the text field where Relay should paste.",
  );
  assert.equal(
    takeActionError({ kind: "app", action: "open" }),
    "Choose an app, link, or local artifact.",
  );
  assert.equal(takeActionError({ kind: "reusable", recipeId: "" }), "Choose a routine to run.");
  assert.equal(
    takeActionError({ kind: "steps", steps: [] }),
    "Choose another action type before saving.",
  );
  assert.equal(takeActionError({ kind: "tap", target: { label: "Continue" } }), undefined);
});

test("Take editing surfaces use focused transitions and accessible target sizes", async () => {
  const sources = await Promise.all(
    ["take-action-list.tsx", "take-action-editor.tsx", "app-map-capture-review.tsx"].map((file) =>
      readFile(new URL(file, import.meta.url), "utf8"),
    ),
  );
  assert.ok(sources.every((source) => !source.includes("transition-all")));
  assert.match(sources[0]!, /size-11/);
  assert.match(sources[1]!, /h-11/);
  // The label and action must read the same current signal. Binding one
  // handler at mount made an "Approve" button keep replaying forever.
  assert.match(
    sources[2]!,
    /onClick=\{\(\) => \(canApprove\(\) \? props\.onKeep\(\) : props\.onReplay\(\)\)\}/,
  );
});

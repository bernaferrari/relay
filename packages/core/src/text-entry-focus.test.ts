import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device-capabilities.js";
import { planTextEntryFocus } from "./text-entry-focus.js";

/** Grok's composer on a 1080×2340 Galaxy: one EditText holding the chips. */
const composer: SnapshotNode[] = [
  { index: 0, type: "android.widget.FrameLayout", rect: { x: 0, y: 0, width: 1080, height: 2340 } },
  {
    index: 48,
    parentIndex: 0,
    type: "android.widget.EditText",
    identifier: "chat_text_input",
    value: "",
    editable: true,
    hittable: true,
    rect: { x: 24, y: 1884, width: 1032, height: 288 },
  },
  {
    index: 49,
    parentIndex: 48,
    label: "Launch gallery selector",
    hittable: true,
    rect: { x: 30, y: 2028, width: 144, height: 144 },
  },
  {
    index: 51,
    parentIndex: 48,
    hittable: true,
    rect: { x: 174, y: 2028, width: 341, height: 144 },
  },
  { index: 52, parentIndex: 51, label: "Heavy", rect: { x: 288, y: 2072, width: 131, height: 56 } },
  {
    index: 59,
    parentIndex: 48,
    hittable: true,
    rect: { x: 776, y: 2028, width: 256, height: 144 },
  },
  {
    index: 63,
    parentIndex: 48,
    label: "Ask anything",
    rect: { x: 72, y: 1920, width: 948, height: 64 },
  },
];

function inside(point: { x: number; y: number }, rect: SnapshotNode["rect"]): boolean {
  return Boolean(
    rect &&
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height,
  );
}

test("the caret lands on the composer's text line, not a nested chip", () => {
  const plan = planTextEntryFocus(composer, { identifier: "chat_text_input" });
  assert.deepEqual(plan.resolution.point, { x: 546, y: 1952 });
  assert.deepEqual(plan.resolution.bounds, composer[1]!.rect);
  for (const chip of composer.filter((node) => node.hittable && node.index !== 48)) {
    assert.equal(inside(plan.resolution.point, chip.rect), false);
  }
});

test("the hint label resolves to its owning editable", () => {
  const plan = planTextEntryFocus(composer, { label: "Ask anything" });
  assert.equal(plan.field?.identifier, "chat_text_input");
  assert.equal(inside(plan.resolution.point, composer[6]!.rect), true);
});

test("a missing field is a grounding error, not a blind tap", () => {
  assert.throws(
    () => planTextEntryFocus(composer, { identifier: "search" }),
    /No text field matched/,
  );
});

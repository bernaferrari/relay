import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import { resolveNamedControlOutcome } from "./device-target-resolution.js";

function imagineLink(index: number, y: number): SnapshotNode[] {
  return [
    {
      index,
      role: "a",
      type: "a",
      label: "Imagine",
      hittable: true,
      rect: { x: 10, y, width: 236, height: 36 },
    },
    {
      index: index + 1,
      parentIndex: index,
      role: "text",
      type: "text",
      label: "Imagine",
      hittable: false,
      rect: { x: 48, y: y + 7.5, width: 52, height: 21 },
    },
  ];
}

test("a browser link and its nested text resolve to the link's activation bounds", () => {
  const result = resolveNamedControlOutcome(imagineLink(11, 98), { label: "Imagine" });
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.deepEqual(result.resolution.point, { x: 128, y: 116 });
  }
});

test("two separate browser links with nested text remain ambiguous", () => {
  const result = resolveNamedControlOutcome([...imagineLink(11, 98), ...imagineLink(21, 198)], {
    label: "Imagine",
  });
  assert.equal(result.status, "ambiguous");
});

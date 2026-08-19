import assert from "node:assert/strict";
import test from "node:test";
import { grokHeaderAffordances, semanticTargetAtPoint } from "./discovery-semantic-tap.js";

test("Grok header icons follow Ask/Imagine even when the bar is reversed", () => {
  const ltr = grokHeaderAffordances([
    {
      label: "Ask",
      visibleToUser: true,
      hittable: true,
      rect: { x: 400, y: 140, width: 80, height: 40 },
    },
    {
      label: "Imagine",
      visibleToUser: true,
      hittable: true,
      rect: { x: 520, y: 140, width: 100, height: 40 },
    },
    { hittable: true, visibleToUser: true, rect: { x: 40, y: 140, width: 72, height: 72 } },
    { hittable: true, visibleToUser: true, rect: { x: 960, y: 140, width: 72, height: 72 } },
  ]);
  assert.equal(ltr[0]?.label, "Menu");
  assert.equal(ltr[1]?.label, "Private");

  const rtl = grokHeaderAffordances([
    {
      label: "Imagine",
      visibleToUser: true,
      hittable: true,
      rect: { x: 200, y: 140, width: 100, height: 40 },
    },
    {
      label: "Ask",
      visibleToUser: true,
      hittable: true,
      rect: { x: 400, y: 140, width: 80, height: 40 },
    },
    { hittable: true, visibleToUser: true, rect: { x: 40, y: 140, width: 72, height: 72 } },
    { hittable: true, visibleToUser: true, rect: { x: 960, y: 140, width: 72, height: 72 } },
  ]);
  // Ask is to the right of Imagine → reversed bar; Menu sits outside Ask's side.
  assert.equal(rtl[0]?.label, "Menu");
  assert.ok((rtl[0]?.target.point?.x ?? 0) > 400);
});

test("point taps record identifiers instead of raw pixels when available", () => {
  const target = semanticTargetAtPoint(
    [
      {
        identifier: "profile_section",
        hittable: true,
        visibleToUser: true,
        rect: { x: 10, y: 10, width: 100, height: 100 },
      },
    ],
    { x: 40, y: 40 },
  );
  assert.deepEqual(target, { identifier: "profile_section" });
});

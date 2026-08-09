import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dismissTowardParent,
  exploreControls,
  isExploreChromeLabel,
  isUnsafeExploreControlText,
  scrollCollectControls,
} from "./explore.js";
import type { Device, SnapshotNode } from "./device.js";

test("explore chrome filters sheet affordances and language switcher", () => {
  assert.equal(isExploreChromeLabel("Close"), true);
  assert.equal(isExploreChromeLabel("App Language, English"), true);
  assert.equal(isExploreChromeLabel("APP"), true);
  assert.equal(isExploreChromeLabel("Appearance"), false);
  assert.equal(isExploreChromeLabel("grok-arrow-left"), true);
  assert.equal(isExploreChromeLabel("Vertical scroll bar, 1 page"), true);
});

test("unsafe explore text catches destructive rows", () => {
  assert.equal(isUnsafeExploreControlText("Delete account"), true);
  assert.equal(isUnsafeExploreControlText("Sign Out"), true);
  assert.equal(isUnsafeExploreControlText("Storage"), false);
});

test("exploreControls keeps SwiftUI cells via ref", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      type: "Button",
      label: "Close",
      hittable: true,
      visibleToUser: true,
    },
    {
      index: 1,
      type: "Cell",
      label: "Appearance",
      hittable: false,
      visibleToUser: true,
      ref: "e17",
    },
  ];
  const controls = exploreControls(nodes);
  assert.deepEqual(
    controls.map((control) => control.label),
    ["Appearance"],
  );
  assert.equal(controls[0]?.target.ref, "e17");
});

test("dismissTowardParent and scrollCollect wrap target context themselves", async () => {
  const device = {
    interactions: {
      find: () => Promise.reject(new Error("missing")),
      press: () => Promise.reject(new Error("missing")),
      swipe: () => Promise.reject(new Error("missing")),
    },
    command: {
      back: () => Promise.resolve({}),
      wait: () => Promise.resolve({}),
    },
    capture: { snapshot: () => Promise.resolve({ nodes: [] }) },
  } as unknown as Device;

  const dismissed = await dismissTowardParent({
    serial: "explore-stub",
    platform: "ios",
    device,
    parentTitles: [],
  });
  assert.equal(dismissed, "key");

  const collected = await scrollCollectControls({
    serial: "explore-stub",
    platform: "ios",
    device,
    maxScrolls: 0,
    extract: () => [],
  });
  assert.deepEqual(collected.controls, []);
});

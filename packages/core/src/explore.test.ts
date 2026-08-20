import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dismissTowardParent,
  exploreControls,
  isExploreChromeLabel,
  isExploreChromeNode,
  isExploreStateChangingNode,
  isUnsafeExploreControlText,
  scrollContentFitsViewport,
  scrollCollectControls,
} from "./explore.js";
import { IosMutationOutcomeUnknownError, type Device, type SnapshotNode } from "./device.js";

test("explore chrome filters sheet affordances and language switcher", () => {
  assert.equal(isExploreChromeLabel("Close"), true);
  assert.equal(isExploreChromeLabel("Home"), true);
  assert.equal(isExploreChromeLabel("App Language, English"), true);
  assert.equal(
    isExploreChromeNode({
      label: "Nav",
      identifier: "com.android.systemui:id/home",
      bundleId: "com.android.systemui",
    }),
    true,
  );
  assert.equal(isExploreChromeLabel("APP"), true);
  assert.equal(isExploreChromeLabel("Appearance"), false);
  assert.equal(isExploreChromeLabel("grok-arrow-left"), true);
  assert.equal(isExploreChromeLabel("Vertical scroll bar, 1 page"), true);
});

test("unsafe explore text catches destructive rows", () => {
  assert.equal(isUnsafeExploreControlText("Delete account"), true);
  assert.equal(isUnsafeExploreControlText("Sign Out"), true);
  assert.equal(isUnsafeExploreControlText("Update"), true);
  assert.equal(isUnsafeExploreControlText("Storage"), false);
});

test("automatic exploration excludes state-changing accessibility controls", () => {
  assert.equal(isExploreStateChangingNode({ role: "switch", label: "Dark mode" }), true);
  assert.equal(isExploreStateChangingNode({ type: "android.widget.SeekBar" }), true);
  assert.equal(isExploreStateChangingNode({ role: "button", label: "Appearance" }), false);
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

test("scrollCollect restores every viewport it traverses", async () => {
  const directions: string[] = [];
  const snapshots = [
    [{ type: "Button", label: "First", hittable: true }],
    [{ type: "Button", label: "Second", hittable: true }],
    [{ type: "Button", label: "Second", hittable: true }],
    [{ type: "Button", label: "First", hittable: true }],
    [{ type: "Button", label: "First", hittable: true }],
    [{ type: "Button", label: "First", hittable: true }],
  ];
  let snapshotIndex = 0;
  const device = {
    interactions: {
      scroll: (input: { direction: string }) => {
        directions.push(input.direction);
        return Promise.resolve({});
      },
    },
    command: { wait: () => Promise.resolve({}) },
    capture: {
      snapshot: () =>
        Promise.resolve({ nodes: snapshots[Math.min(snapshotIndex++, snapshots.length - 1)] }),
    },
  } as unknown as Device;

  const collected = await scrollCollectControls({
    serial: "explore-scroll-restore",
    platform: "ios",
    device,
    maxScrolls: 2,
    extract: (nodes) =>
      nodes.map((node) => ({ label: node.label ?? "", stableKey: node.label ?? "" })),
  });

  assert.deepEqual(directions, ["down", "down", "up", "up"]);
  assert.deepEqual(
    collected.controls.map((control) => control.label),
    ["First", "Second"],
  );
});

test("an unknown iOS collection scroll is terminal before inverse-scroll cleanup", async () => {
  const directions: string[] = [];
  const device = {
    interactions: {
      scroll: (input: { direction: string }) => {
        directions.push(input.direction);
        return Promise.reject(new Error("lost native acknowledgement"));
      },
    },
    command: { wait: () => Promise.resolve({}) },
    capture: {
      snapshot: () => Promise.resolve({ nodes: [{ type: "Button", label: "First" }] }),
    },
  } as unknown as Device;

  await assert.rejects(
    scrollCollectControls({
      serial: "explore-scroll-unknown",
      platform: "ios",
      device,
      maxScrolls: 2,
      extract: (nodes) =>
        nodes.map((node) => ({ label: node.label ?? "", stableKey: node.label ?? "" })),
    }),
    IosMutationOutcomeUnknownError,
  );

  assert.deepEqual(directions, ["down"]);
});

test("an unknown iOS dismiss press never falls through to another dismissal target", async () => {
  const commands: string[] = [];
  const device = {
    interactions: {
      find: (input: { action?: string }) => {
        commands.push(input.action === "exists" ? "exists-back" : "find-fallback");
        return Promise.resolve({});
      },
      press: () => {
        commands.push("press-back");
        return Promise.reject(new Error("lost native acknowledgement"));
      },
    },
    command: {
      back: () => {
        commands.push("key-back");
        return Promise.resolve({});
      },
      wait: () => Promise.resolve({}),
    },
    capture: {
      snapshot: () =>
        Promise.resolve({
          nodes: [{ type: "Button", label: "Back", hittable: true, visibleToUser: true }],
        }),
    },
  } as unknown as Device;

  await assert.rejects(
    dismissTowardParent({
      serial: "explore-dismiss-unknown",
      platform: "ios",
      device,
      parentTitles: [],
    }),
    IosMutationOutcomeUnknownError,
  );

  assert.deepEqual(commands, ["exists-back", "press-back"]);
});

test("scrollCollect does not scroll an Android list whose final row is already visible", async () => {
  const directions: string[] = [];
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      type: "android.widget.ScrollView",
      rect: { x: 0, y: 280, width: 1080, height: 1900 },
      visibleToUser: true,
    },
    {
      index: 1,
      parentIndex: 0,
      type: "android.view.View",
      label: "Buy More",
      rect: { x: 50, y: 1100, width: 980, height: 90 },
      visibleToUser: true,
      hittable: true,
    },
    {
      index: 2,
      parentIndex: 0,
      type: "android.view.View",
      label: "Set Up Auto Top-Up",
      rect: { x: 50, y: 1260, width: 980, height: 90 },
      visibleToUser: true,
      hittable: true,
    },
  ];
  assert.equal(scrollContentFitsViewport(nodes), true);
  const device = {
    interactions: {
      scroll: (input: { direction: string }) => {
        directions.push(input.direction);
        return Promise.resolve({});
      },
    },
    command: { wait: () => Promise.resolve({}) },
    capture: { snapshot: () => Promise.resolve({ nodes }) },
  } as unknown as Device;

  const collected = await scrollCollectControls({
    serial: "usage-screen",
    platform: "android",
    device,
    maxScrolls: 4,
    extract: (snapshotNodes) =>
      snapshotNodes
        .filter((node) => node.label)
        .map((node) => ({ label: node.label!, stableKey: node.label! })),
  });

  assert.deepEqual(directions, []);
  assert.deepEqual(
    collected.controls.map((control) => control.label),
    ["Buy More", "Set Up Auto Top-Up"],
  );
});

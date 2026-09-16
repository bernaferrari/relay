import assert from "node:assert/strict";
import test from "node:test";
import {
  visualIgnoreRegionsFromIdentityArtifacts,
  withIdentityIgnoreRegions,
} from "./visual-identity-ignore-regions.js";
import type { VisualComparisonPolicy } from "@relay/protocol";

const policy: VisualComparisonPolicy = {
  schemaVersion: 1,
  id: "policy-1",
  recipeId: "chat",
  projectKey: "local",
  targetKey: "grok-com",
  revision: 0,
  changeThreshold: 0.0035,
  pixelThreshold: 16,
  regions: [],
  updatedAt: 0,
  updatedBy: { id: "relay-default", kind: "system" },
};

test("unscoped identity-ignore does not leak onto later frames", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [
      {
        kind: "identity-ignore",
        data: { name: "reply body", x: 0, y: 80, width: 1280, height: 640 },
      },
    ],
    [
      { index: 0, width: 1280, height: 800, stepId: "chat" },
      { index: 1, width: 1280, height: 800, stepId: "settings" },
    ],
  );
  assert.equal(regions.length, 0);
});

test("unscoped identity-ignore is not a visual exclusion on a single-frame run", () => {
  const merged = withIdentityIgnoreRegions(
    policy,
    [
      {
        kind: "identity-ignore",
        data: { name: "reply body", x: 0, y: 80, width: 1280, height: 640 },
      },
    ],
    [{ index: 0, width: 1280, height: 800, stepId: "chat" }],
  );
  assert.equal(merged.regions.length, 0);
  assert.equal(merged, policy);
});

test("unscoped identity-ignore is not a visual exclusion on a Settings-only run", () => {
  const merged = withIdentityIgnoreRegions(
    policy,
    [
      {
        kind: "identity-ignore",
        data: { name: "reply body", x: 0, y: 80, width: 1280, height: 640 },
      },
    ],
    [{ index: 0, width: 1280, height: 800, stepId: "settings" }],
  );
  assert.equal(merged.regions.length, 0);
  assert.equal(merged, policy);
});

test("identity-ignore is not a visual exclusion on its bound frame", () => {
  const merged = withIdentityIgnoreRegions(
    policy,
    [
      {
        kind: "identity-ignore",
        data: {
          name: "reply body",
          x: 0,
          y: 80,
          width: 1280,
          height: 640,
          stepId: "chat",
          frameIndex: 0,
        },
      },
    ],
    [
      { index: 0, width: 1280, height: 800, stepId: "chat" },
      { index: 1, width: 1280, height: 800, stepId: "settings" },
    ],
  );
  assert.equal(merged.regions.length, 0);
  assert.equal(merged, policy);
});

test("identity-ignore bound to a frame stays off later Settings", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [
      {
        kind: "identity-ignore",
        data: { name: "reply body", x: 0, y: 80, width: 1280, height: 640, frameIndex: 0 },
      },
    ],
    [
      { index: 0, width: 1280, height: 800, stepId: "chat" },
      { index: 1, width: 1280, height: 800, stepId: "settings" },
    ],
  );
  assert.equal(regions.length, 0);
});

const chatChromeTree = {
  kind: "ui-tree" as const,
  data: {
    stepId: "chat",
    nodes: [
      { role: "article", label: "You", rect: { x: 80, y: 80, width: 40, height: 40 } },
      { role: "article", label: "Grok", rect: { x: 80, y: 200, width: 400, height: 120 } },
      {
        role: "div",
        identifier: "chat-input",
        label: "Ask Grok anything",
        rect: { x: 275, y: 232, width: 726, height: 42 },
      },
      {
        role: "dialog",
        label: "Introducing Build Mode",
        rect: { x: 824, y: 339, width: 320, height: 301 },
      },
    ],
  },
};

test("grok.com ui-tree composer intro and reply-body are not visual exclusions", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [chatChromeTree],
    [{ index: 0, width: 1280, height: 800, stepId: "chat" }],
  );
  assert.equal(regions.length, 0);
});

test("Settings-only compare does not inherit Chat ui-tree chrome as a visual ignore", () => {
  const merged = withIdentityIgnoreRegions(
    policy,
    [chatChromeTree],
    [{ index: 0, width: 1280, height: 800, stepId: "settings" }],
  );
  assert.equal(merged.regions.length, 0);
  assert.equal(merged, policy);
});

test("unscoped Chat ui-tree is not a visual exclusion on a Settings-only run", () => {
  const merged = withIdentityIgnoreRegions(
    policy,
    [{ kind: "ui-tree", data: { nodes: chatChromeTree.data.nodes } }],
    [{ index: 0, width: 1280, height: 800, stepId: "settings" }],
  );
  assert.equal(merged.regions.length, 0);
  assert.equal(merged, policy);
});

test("Chat ui-tree chrome stays off later Settings for visual compare", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [chatChromeTree],
    [
      { index: 0, width: 1280, height: 800, stepId: "chat" },
      { index: 1, width: 1280, height: 800, stepId: "settings" },
    ],
  );
  assert.equal(regions.length, 0);
});

test("already-normalized identity-ignore regions are not visual exclusions", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [{ kind: "identity-ignore", data: { x: 0, y: 0.2, width: 1, height: 0.6, name: "reply" } }],
    [{ index: 0, width: 1280, height: 800 }],
  );
  assert.equal(regions.length, 0);
});

test("identity-ignore never overwrites a reviewed visual policy id", () => {
  const merged = withIdentityIgnoreRegions(
    {
      ...policy,
      regions: [
        {
          id: "identity-ignore:reply body:0",
          name: "reviewed",
          mode: "ignore",
          frameIndex: 0,
          x: 0,
          y: 0,
          width: 1,
          height: 0.5,
        },
      ],
    },
    [{ kind: "identity-ignore", data: { name: "reply body", x: 0, y: 0, width: 1, height: 1 } }],
    [{ index: 0, width: 10, height: 10 }],
  );
  assert.equal(merged.regions.length, 1);
  assert.equal(merged.regions[0]?.name, "reviewed");
});

test("explicit comparison ignore stays off a later Settings frame", () => {
  const merged = withIdentityIgnoreRegions(
    {
      ...policy,
      regions: [
        {
          id: "chat-reply",
          name: "reply body",
          mode: "ignore",
          frameIndex: 0,
          x: 0,
          y: 0.1,
          width: 1,
          height: 0.8,
        },
      ],
    },
    [
      {
        kind: "identity-ignore",
        data: { name: "reply body", x: 0, y: 80, width: 1280, height: 640, frameIndex: 0 },
      },
    ],
    [
      { index: 0, width: 1280, height: 800, stepId: "chat" },
      { index: 1, width: 1280, height: 800, stepId: "settings" },
    ],
  );
  assert.equal(merged.regions.length, 1);
  assert.equal(merged.regions[0]?.id, "chat-reply");
  assert.equal(merged.regions[0]?.frameIndex, 0);
});

test("a grok.com ui-tree does not auto-save leftover-chat chrome as a visual ignore", () => {
  const merged = withIdentityIgnoreRegions(
    policy,
    [chatChromeTree, { ...chatChromeTree, data: { ...chatChromeTree.data, stepId: undefined } }],
    [{ index: 0, width: 1280, height: 800, stepId: "chat" }],
  );
  assert.equal(merged.regions.length, 0);
  assert.equal(merged, policy);
});

test("human comparison policy still ignores reply-body pixels after it is updated", () => {
  const reviewed: VisualComparisonPolicy = {
    ...policy,
    regions: [
      {
        id: "reply-body",
        name: "reply body",
        mode: "ignore",
        frameIndex: 0,
        x: 0,
        y: 0.1,
        width: 1,
        height: 0.8,
      },
    ],
  };
  const merged = withIdentityIgnoreRegions(
    reviewed,
    [chatChromeTree],
    [
      { index: 0, width: 1280, height: 800, stepId: "chat" },
      { index: 1, width: 1280, height: 800, stepId: "settings" },
    ],
  );
  assert.equal(merged.regions.length, 1);
  assert.equal(merged.regions[0]?.id, "reply-body");
  assert.equal(merged.regions[0]?.frameIndex, 0);
});

test("paywall ui-tree leftover chrome is not a visual exclusion", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [
      {
        kind: "ui-tree",
        data: {
          nodes: [
            { role: "button", label: "Sign in", rect: { x: 1100, y: 11, width: 76, height: 40 } },
            { role: "article", label: "You", rect: { x: 926, y: 80, width: 65, height: 54 } },
            { role: "p", label: "hello", rect: { x: 942, y: 88, width: 33, height: 38 } },
            {
              role: "h2",
              label: "Continue your conversation",
              rect: { x: 297, y: 165, width: 427, height: 22 },
            },
            {
              role: "div",
              identifier: "chat-input",
              label: "Ask Grok anything",
              rect: { x: 275, y: 232, width: 726, height: 42 },
            },
          ],
        },
      },
    ],
    [{ index: 0, width: 1280, height: 800 }],
  );
  assert.equal(regions.length, 0);
});

test("authored cookie banner is not a visual exclusion", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [
      {
        kind: "identity-ignore",
        data: { name: "cookie banner", x: 0.57, y: 0.8, width: 0.43, height: 0.2 },
      },
    ],
    [{ index: 0, width: 1280, height: 800 }],
  );
  assert.equal(regions.length, 0);
});

test("authored heading caret is not a visual exclusion", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [
      {
        kind: "identity-ignore",
        data: { name: "heading caret", x: 0.53, y: 0.25, width: 0.08, height: 0.01 },
      },
    ],
    [{ index: 0, width: 1280, height: 800 }],
  );
  assert.equal(regions.length, 0);
});

test("cookie identity-ignore plus a Chat ui-tree still adds no visual exclusion", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [
      {
        kind: "identity-ignore",
        data: { name: "cookie banner", x: 0.57, y: 0.8, width: 0.43, height: 0.2 },
      },
      chatChromeTree,
    ],
    [{ index: 0, width: 1280, height: 800, stepId: "chat" }],
  );
  assert.equal(regions.length, 0);
});

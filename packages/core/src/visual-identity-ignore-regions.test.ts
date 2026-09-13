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

test("pixel identity-ignore regions normalize onto every frame", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [
      {
        kind: "identity-ignore",
        data: { name: "reply body", x: 0, y: 80, width: 1280, height: 640 },
      },
    ],
    [
      { index: 0, width: 1280, height: 800 },
      { index: 1, width: 1280, height: 800 },
    ],
  );
  assert.equal(regions.length, 2);
  assert.equal(regions[0]?.mode, "ignore");
  assert.equal(regions[0]?.name, "reply body");
  assert.equal(regions[0]?.y, 0.1);
  assert.equal(regions[0]?.height, 0.8);
  assert.equal(regions[1]?.frameIndex, 1);
});

test("already-normalized identity-ignore regions stay unit rectangles", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [{ kind: "identity-ignore", data: { x: 0, y: 0.2, width: 1, height: 0.6, name: "reply" } }],
    [{ index: 0, width: 1280, height: 800 }],
  );
  assert.equal(regions[0]?.y, 0.2);
  assert.equal(regions[0]?.height, 0.6);
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

test("a grok.com ui-tree covers the reply body without a recipe identity-ignore step", () => {
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
              role: "dialog",
              label: "Cookie notice",
              rect: { x: 736, y: 647, width: 528, height: 136 },
            },
          ],
        },
      },
    ],
    [{ index: 0, width: 1280, height: 800 }],
  );
  assert.equal(regions[0]?.name, "reply body");
  assert.equal(regions[0]?.mode, "ignore");
  assert.ok((regions[0]?.y ?? 1) < 0.15);
  assert.ok((regions[0]?.y ?? 0) + (regions[0]?.height ?? 0) < 0.85);
  assert.ok((regions[0]?.x ?? 0) > 0);
});

test("ui-tree ignore stays off screens that are not a conversation", () => {
  const regions = visualIgnoreRegionsFromIdentityArtifacts(
    [
      {
        kind: "ui-tree",
        data: {
          nodes: [
            { role: "button", label: "Imagine", rect: { x: 900, y: 11, width: 80, height: 40 } },
          ],
        },
      },
    ],
    [{ index: 0, width: 1280, height: 800 }],
  );
  assert.equal(regions.length, 0);
});

test("duplicate conversation ui-trees still produce one ignore region per frame", () => {
  const tree = {
    kind: "ui-tree" as const,
    data: {
      nodes: [{ role: "article", label: "You", rect: { x: 80, y: 80, width: 40, height: 40 } }],
    },
  };
  const merged = withIdentityIgnoreRegions(
    policy,
    [tree, tree],
    [{ index: 0, width: 1280, height: 800 }],
  );
  assert.equal(merged.regions.length, 1);
  assert.equal(merged.regions[0]?.name, "reply body");
});

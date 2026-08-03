import assert from "node:assert/strict";
import test from "node:test";
import type { MapGroup } from "@relay/protocol";
import { mapGroupGeometry, nextGroupName } from "./app-map-groups";

const group = { id: "settings", screenIds: ["root", "account"] } as MapGroup;
const positions = { root: { x: 100, y: 100 }, account: { x: 340, y: 140 } };

test("groups auto-wrap every member with a label gutter", () => {
  assert.deepEqual(mapGroupGeometry(group, positions), {
    id: "settings",
    left: 72,
    top: 48,
    right: 548,
    bottom: 518,
    width: 476,
    height: 470,
  });
});

test("a Group follows a member moved far away without changing membership", () => {
  assert.deepEqual(mapGroupGeometry(group, { ...positions, root: { x: 900, y: 900 } }), {
    id: "settings",
    left: 312,
    top: 88,
    right: 1108,
    bottom: 1278,
    width: 796,
    height: 1190,
  });
  assert.deepEqual(group.screenIds, ["root", "account"]);
});

test("new Groups use familiar Figma-style names without collisions", () => {
  assert.equal(nextGroupName([]), "Group");
  assert.equal(nextGroupName([{ ...group, name: "Group" } as MapGroup]), "Group 2");
});

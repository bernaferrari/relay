import assert from "node:assert/strict";
import test from "node:test";
import type { MapGroup } from "@relay/protocol";
import {
  groupAtPoint,
  groupsAfterScreenDrag,
  mapGroupGeometry,
  nextGroupName,
} from "./app-map-groups";

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

test("drag targeting can ignore the moving member without losing a one-item group", () => {
  assert.equal(
    groupAtPoint([group], positions, { x: 400, y: 200 }, new Set(["root"]))?.id,
    "settings",
  );
  assert.equal(
    groupAtPoint(
      [{ ...group, screenIds: ["root"] }],
      positions,
      { x: 200, y: 200 },
      new Set(["root"]),
    )?.id,
    "settings",
  );
  assert.equal(groupAtPoint([group], positions, { x: 900, y: 900 }), undefined);
});

test("individual screens can leave and re-enter a Group while whole-Group moves preserve it", () => {
  const persisted = {
    ...group,
    organizationId: "local",
    projectId: "default",
    appMapId: "map",
    name: "Settings",
    createdAt: 1,
    updatedAt: 1,
  };
  const detached = groupsAfterScreenDrag(
    [persisted],
    ["root"],
    positions,
    { ...positions, root: { x: 900, y: 900 } },
    2,
  );
  assert.deepEqual(detached[0]?.screenIds, ["account"]);
  assert.equal(detached[0]?.updatedAt, 2);

  const reattached = groupsAfterScreenDrag(
    detached,
    ["root"],
    { ...positions, root: { x: 900, y: 900 } },
    { ...positions, root: { x: 360, y: 160 } },
    3,
  );
  assert.deepEqual(reattached[0]?.screenIds, ["account", "root"]);

  const movedTogether = groupsAfterScreenDrag(
    [persisted],
    ["root", "account"],
    positions,
    { root: { x: 200, y: 200 }, account: { x: 440, y: 240 } },
    4,
  );
  assert.deepEqual(movedTogether[0], persisted);
});

test("new Groups use familiar Figma-style names without collisions", () => {
  assert.equal(nextGroupName([]), "Group");
  assert.equal(nextGroupName([{ ...group, name: "Group" } as MapGroup]), "Group 2");
});

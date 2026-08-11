import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasConnectionPresentation,
  crossGroupConnectionRepresentatives,
} from "./app-map-connection-visibility";

const connections = [
  { id: "settings-account", fromScreenId: "settings", toScreenId: "account" },
  { id: "settings-profile", fromScreenId: "settings", toScreenId: "profile" },
  { id: "account-profile", fromScreenId: "account", toScreenId: "profile" },
];
const groups = new Map([
  ["settings", "app"],
  ["appearance", "app"],
  ["account", "account"],
  ["profile", "account"],
]);
const idle = {
  selectedConnectionId: null,
  selectedGroupId: null,
  selectedScreenIds: new Set<string>(),
};
const representatives = crossGroupConnectionRepresentatives(connections, groups);

test("local and ungrouped paths remain fully visible", () => {
  assert.equal(
    canvasConnectionPresentation(
      { id: "local", fromScreenId: "settings", toScreenId: "appearance" },
      groups,
      idle,
    ),
    "full",
  );
  assert.equal(
    canvasConnectionPresentation(
      { id: "ungrouped", fromScreenId: "settings", toScreenId: "new" },
      groups,
      idle,
    ),
    "full",
  );
});

test("one canonical connection identifies every connected group pair", () => {
  assert.deepEqual([...representatives], ["settings-account"]);
});

test("cross-group paths collapse into a compound summary at rest", () => {
  assert.equal(canvasConnectionPresentation(connections[0]!, groups, idle), "summary");
  assert.equal(canvasConnectionPresentation(connections[1]!, groups, idle), "summary");
});

test("screen and path focus reveal exact cross-group routes without group wire explosions", () => {
  assert.equal(
    canvasConnectionPresentation(connections[1]!, groups, {
      ...idle,
      selectedScreenIds: new Set(["profile"]),
    }),
    "full",
  );
  assert.equal(
    canvasConnectionPresentation(connections[1]!, groups, { ...idle, selectedGroupId: "account" }),
    "summary",
  );
  assert.equal(
    canvasConnectionPresentation(connections[1]!, groups, {
      ...idle,
      selectedConnectionId: connections[1]!.id,
    }),
    "full",
  );
});

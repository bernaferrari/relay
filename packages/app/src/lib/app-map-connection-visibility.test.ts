import assert from "node:assert/strict";
import test from "node:test";
import { shouldDisplayCanvasConnection } from "./app-map-connection-visibility";

const connection = { id: "settings-account", fromScreenId: "settings", toScreenId: "account" };
const groups = new Map([
  ["settings", "app"],
  ["appearance", "app"],
  ["account", "account"],
]);
const idle = {
  selectedConnectionId: null,
  selectedGroupId: null,
  selectedScreenIds: new Set<string>(),
};

test("local and ungrouped paths remain visible in the overview", () => {
  assert.equal(
    shouldDisplayCanvasConnection(
      { id: "local", fromScreenId: "settings", toScreenId: "appearance" },
      groups,
      idle,
    ),
    true,
  );
  assert.equal(
    shouldDisplayCanvasConnection(
      { id: "ungrouped", fromScreenId: "settings", toScreenId: "new" },
      groups,
      idle,
    ),
    true,
  );
});

test("cross-section paths use contextual progressive disclosure", () => {
  assert.equal(shouldDisplayCanvasConnection(connection, groups, idle), false);
  assert.equal(
    shouldDisplayCanvasConnection(connection, groups, {
      ...idle,
      selectedScreenIds: new Set(["settings"]),
    }),
    true,
  );
  assert.equal(
    shouldDisplayCanvasConnection(connection, groups, {
      ...idle,
      selectedGroupId: "account",
    }),
    true,
  );
  assert.equal(
    shouldDisplayCanvasConnection(connection, groups, {
      ...idle,
      selectedConnectionId: connection.id,
    }),
    true,
  );
});

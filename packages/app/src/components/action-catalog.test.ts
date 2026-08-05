import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RecipeStep } from "../context/server";
import { ACTION_GROUPS, filterActionGroups } from "./action-catalog";

const expectedKinds: RecipeStep["kind"][] = [
  "tap",
  "type",
  "scroll",
  "swipe",
  "key",
  "expect",
  "expect-set",
  "wait-for",
  "sleep",
  "pause",
  "wait-response",
  "assert-content",
  "evaluate-semantic",
  "screenshot",
  "extract",
  "clipboard",
  "network",
  "logs",
  "flow",
  "module",
  "branch",
  "repeat",
  "review",
  "script",
  "app",
  "device",
  "rotate",
  "settings",
  "location",
  "permission",
  "alert",
];

describe("action catalog", () => {
  it("places every editable action in exactly one understandable group", () => {
    const kinds = ACTION_GROUPS.flatMap((group) => group.actions.map((action) => action.kind));
    assert.deepEqual([...kinds].sort(), [...expectedKinds].sort());
    assert.equal(new Set(kinds).size, kinds.length);
    assert.ok(ACTION_GROUPS.every((group) => group.actions.every((action) => action.description)));
  });

  it("searches labels, explanations, and group names", () => {
    assert.deepEqual(
      filterActionGroups("requests").flatMap((group) => group.actions.map((action) => action.kind)),
      ["network"],
    );
    assert.deepEqual(
      filterActionGroups("device").map((group) => group.label),
      ["Capture data", "Device"],
    );
  });
});

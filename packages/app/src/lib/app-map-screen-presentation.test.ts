import assert from "node:assert/strict";
import test from "node:test";
import {
  screenCardActionsVisible,
  screenCardStartMarkerVisible,
} from "./app-map-screen-presentation";

test("screen actions appear only when the selected screen has a real contextual action", () => {
  assert.equal(
    screenCardActionsVisible({
      selected: true,
      showActions: true,
      editing: false,
      hasRunAction: true,
    }),
    true,
  );
  assert.equal(
    screenCardActionsVisible({
      selected: true,
      showActions: true,
      editing: false,
      hasRunAction: false,
    }),
    false,
  );
  assert.equal(
    screenCardActionsVisible({
      selected: false,
      showActions: true,
      editing: false,
      hasRunAction: true,
    }),
    false,
  );
  assert.equal(
    screenCardActionsVisible({
      selected: true,
      showActions: true,
      editing: true,
      hasRunAction: true,
    }),
    false,
  );
});

test("a start screen does not repeat Start as both its title and marker", () => {
  assert.equal(screenCardStartMarkerVisible("Start", true), false);
  assert.equal(screenCardStartMarkerVisible(" start ", true), false);
  assert.equal(screenCardStartMarkerVisible("Settings", true), true);
  assert.equal(screenCardStartMarkerVisible("Settings", false), false);
});

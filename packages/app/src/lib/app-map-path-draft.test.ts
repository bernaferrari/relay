import assert from "node:assert/strict";
import test from "node:test";
import { pathDraftClick } from "./app-map-path-draft";

test("path draft is idle until a source screen is chosen", () => {
  assert.deepEqual(pathDraftClick({ sourceScreenId: null, clickedScreenId: "home" }), {
    kind: "idle",
  });
});

test("clicking empty canvas or the source screen cancels the draft", () => {
  assert.deepEqual(pathDraftClick({ sourceScreenId: "home", clickedScreenId: null }), {
    kind: "cancel",
  });
  assert.deepEqual(pathDraftClick({ sourceScreenId: "home", clickedScreenId: "home" }), {
    kind: "cancel",
  });
});

test("clicking another screen connects from the draft source", () => {
  assert.deepEqual(pathDraftClick({ sourceScreenId: "home", clickedScreenId: "settings" }), {
    kind: "connect",
    fromScreenId: "home",
    toScreenId: "settings",
  });
});

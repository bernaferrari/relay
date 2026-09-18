import assert from "node:assert/strict";
import test from "node:test";
import { destIdentityHistoryCaption } from "./dest-identity-history.js";

test("TUI history dest caption is dest wait-for, not leftover Close last-frame", () => {
  assert.equal(
    destIdentityHistoryCaption([
      { path: "frames/003.png", caption: "Observe" },
      { path: "frames/004.png", caption: "after · Run saved Test" },
    ]),
    "Observe",
  );
  assert.equal(
    destIdentityHistoryCaption([
      { path: "frames/004.png", caption: "Close" },
      { path: "frames/003.png", caption: "Observe" },
    ]),
    "Observe",
  );
});

test("TUI history drops leftover Transition executed / Inspect setup skipped", () => {
  assert.equal(
    destIdentityHistoryCaption([
      { path: "frames/002.png", caption: "after · Transition executed" },
      { path: "frames/003.png", caption: "step:step-observe:Observe" },
      {
        path: "frames/004.png",
        caption: "after · Inspect setup skipped — already on this view",
      },
      { path: "frames/005.png", caption: "after · Run saved Test" },
    ]),
    "step:step-observe:Observe",
  );
});

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

import assert from "node:assert/strict";
import test from "node:test";
import { edgeDashesRead } from "./connection-presentation";

test("keeps the draft dash while its marks still cover a pixel", () => {
  // The draft pattern is 4 canvas units on, so it resolves down to a quarter.
  assert.equal(edgeDashesRead("draft", 1), true);
  assert.equal(edgeDashesRead("draft", 0.55), true);
  assert.equal(edgeDashesRead("draft", 0.25), true);
});

test("drops the draft dash at the zoom a fitted crawl lands on", () => {
  // A tidy 44-screen map fits at 0.12-0.20. Its edges are almost all drafts,
  // and at that scale the pattern is under a pixel: a fuzzy rail rather than a
  // dashed one. The line stays, as one quiet hairline.
  assert.equal(edgeDashesRead("draft", 0.2), false);
  assert.equal(edgeDashesRead("draft", 0.12), false);
});

test("drops the finer return dash sooner than the draft dash", () => {
  // A return dash is 2 canvas units on against the draft dash's 4, so there is
  // a band of zooms where a draft edge is still dashed and a return is not.
  assert.equal(edgeDashesRead("return", 0.5), true);
  assert.equal(edgeDashesRead("return", 0.3), false);
  assert.equal(edgeDashesRead("draft", 0.3), true);
});

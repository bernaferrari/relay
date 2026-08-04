import assert from "node:assert/strict";
import test from "node:test";
import { canApproveVisualBaseline, hasVisualRunFrames } from "./visual-run-readiness";

test("visual review requires an actual PNG frame", () => {
  assert.equal(hasVisualRunFrames([]), false);
  assert.equal(hasVisualRunFrames([{ path: "video/run.mp4", mime: "video/mp4" }]), false);
  assert.equal(hasVisualRunFrames([{ path: "frames/1.png" }]), true);
  assert.equal(hasVisualRunFrames([{ path: "frame", mime: "image/png" }]), true);
});

test("only completed successful runs can become a baseline", () => {
  const frames = [{ path: "frames/1.png" }];
  assert.equal(canApproveVisualBaseline("ok", frames), true);
  assert.equal(canApproveVisualBaseline("healed", frames), true);
  assert.equal(canApproveVisualBaseline("error", frames), false);
  assert.equal(canApproveVisualBaseline("ok", []), false);
});

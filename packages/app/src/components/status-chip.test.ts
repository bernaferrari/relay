import assert from "node:assert/strict";
import test from "node:test";
import { authoringProofStatusChip } from "./status-chip";

test("authoring proof chips do not overstate pixels-only or unresolved evidence", () => {
  assert.deepEqual(authoringProofStatusChip({ status: "verified" }), {
    tone: "pass",
    label: "Verified",
  });
  assert.deepEqual(authoringProofStatusChip({ status: "pixels-only" }), {
    tone: "attention",
    label: "Pixels only",
  });
  assert.deepEqual(authoringProofStatusChip({ status: "unresolved" }), {
    tone: "attention",
    label: "Needs capture",
  });
  assert.deepEqual(
    authoringProofStatusChip({
      status: "pixels-only",
      outcome: "passed",
      transition: "unchanged",
    }),
    { tone: "attention", label: "No screen change" },
  );
  assert.deepEqual(authoringProofStatusChip({ status: "unresolved", outcome: "failed" }), {
    tone: "fail",
    label: "Replay failed",
  });
});

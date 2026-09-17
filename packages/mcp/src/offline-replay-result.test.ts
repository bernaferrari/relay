import { CAPTURE_REVIEW_DEST_PHASE } from "@relay/protocol";
import assert from "node:assert/strict";
import test from "node:test";
import {
  compactOfflineReplayResource,
  compactOfflineReplayToolResult,
} from "./offline-replay-result.js";

const leftoverReport = {
  schemaVersion: 1,
  mode: "offline-evidence-replay",
  runId: "4b93702b",
  destIdentity: [
    { path: "frames/003.png", caption: "Observe" },
    { path: "frames/004.png", caption: "Close" },
  ],
  captureReview: [
    {
      caption: "Observe",
      framePath: "frames/003.png",
      phase: CAPTURE_REVIEW_DEST_PHASE,
    },
    { caption: "Close", framePath: "frames/004.png" },
  ],
};

test("compact offline replay keeps dest wait-for 003 and drops leftover Close 004", () => {
  const compact = compactOfflineReplayResource({
    destIdentity: leftoverReport.destIdentity,
    report: leftoverReport,
  }) as {
    destIdentity?: Array<{ path?: string; caption?: string }>;
    report?: { mode?: string; destIdentity?: unknown };
  };
  assert.equal(compact.report?.mode, "offline-evidence-replay");
  assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
  assert.equal(compact.report?.destIdentity, undefined);
});

test("compact offline replay falls back to report destIdentity and still drops leftover Close", () => {
  const compact = compactOfflineReplayToolResult({
    report: leftoverReport,
  }) as { destIdentity?: Array<{ path?: string }> };
  assert.deepEqual(
    compact.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  combineExecutionCaseId,
  combineProfileTargetExecutionCaseId,
} from "./combine-campaign-case-identity.js";

test("omitting account keeps the historical execution identity", () => {
  const cellId = "c" + "a".repeat(32);
  assert.equal(
    combineExecutionCaseId({ cellId, targetProfileId: "grok-com" }),
    combineProfileTargetExecutionCaseId(cellId, { profileId: "grok-com" }),
  );
});

test("six accounts on one browser stay six execution cases", () => {
  const cellId = "c" + "b".repeat(32);
  const ids = ["a", "b", "c", "d", "e", "f"].map((letter) =>
    combineProfileTargetExecutionCaseId(cellId, {
      profileId: "grok-com",
      engine: "chromium",
      account: { kind: "fixture", accountId: `acct-${letter}`, accountRevision: "1" },
    }),
  );
  assert.equal(new Set(ids).size, 6);
  assert.notEqual(
    ids[0],
    combineExecutionCaseId({ cellId, targetProfileId: "grok-com" }),
  );
});

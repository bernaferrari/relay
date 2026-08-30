import assert from "node:assert/strict";
import test from "node:test";
import {
  changeRefSchema,
  changeRequestedHeadSha,
  changeTestedSha,
  changeVerificationChangeSchema,
  materializeChangeRef,
} from "./change-verification-change-schemas.js";

const baseTipSha = "1".repeat(40);
const mergeBaseSha = "2".repeat(40);
const requestedHeadSha = "3".repeat(40);
const testedSha = "4".repeat(40);

test("merge-group identity keeps requested and exactly tested revisions distinct", () => {
  const change = materializeChangeRef({
    repository: "owner/repository",
    baseTipSha,
    mergeBaseSha,
    requestedHeadSha,
    testedSha,
    testedKind: "merge-group",
    mergeGroupId: "merge-queue/main/pr-42",
  });

  assert.equal(change.baseSha, mergeBaseSha);
  assert.equal(change.headSha, testedSha);
  assert.equal(changeRequestedHeadSha(change), requestedHeadSha);
  assert.equal(changeTestedSha(change), testedSha);
  assert.notEqual(change.requestedHeadSha, change.testedSha);
});

test("change identity fails closed for incomplete or contradictory tested revisions", () => {
  assert.throws(() =>
    changeRefSchema.parse({
      baseTipSha,
      mergeBaseSha,
      requestedHeadSha,
      testedSha,
      testedKind: "merge-group",
    }),
  );
  assert.throws(() =>
    changeRefSchema.parse({
      baseTipSha,
      mergeBaseSha,
      requestedHeadSha,
      testedSha,
      testedKind: "head",
    }),
  );
  assert.throws(() =>
    changeVerificationChangeSchema.parse({
      repository: "owner/repository",
      baseSha: mergeBaseSha,
      headSha: testedSha,
      baseTipSha,
      mergeBaseSha,
      requestedHeadSha,
      testedSha,
      testedKind: "merge-group",
    }),
  );
});

test("legacy change identity materializes one exact head Proof", () => {
  const legacy = materializeChangeRef({
    repository: "owner/repository",
    baseSha: mergeBaseSha,
    headSha: requestedHeadSha,
  });

  assert.equal(legacy.baseTipSha, mergeBaseSha);
  assert.equal(legacy.mergeBaseSha, mergeBaseSha);
  assert.equal(legacy.requestedHeadSha, requestedHeadSha);
  assert.equal(legacy.testedSha, requestedHeadSha);
  assert.equal(legacy.testedKind, "head");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  changeProofRunHumanEvidenceInputSchema,
  changeProofExecutionHumanEvidenceAttachmentSchema,
} from "./change-proof-execution.js";

const identity = {
  proofId: "proof-1",
  executionId: "execution-1",
  cellId: "cell-1",
  stepId: "step-1",
  confirm: true as const,
};

test("human evidence accepts a server-owned attachment without a digest", () => {
  const attachment = {
    kind: "snapshot" as const,
    encoding: "utf8" as const,
    data: '{"reviewed":true}',
    capturedAt: 100,
  };
  assert.deepEqual(
    changeProofRunHumanEvidenceInputSchema.parse({ ...identity, attachment }),
    { ...identity, attachment },
  );
});

test("human evidence keeps digest-only input backward compatible but rejects ambiguity", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  assert.deepEqual(
    changeProofRunHumanEvidenceInputSchema.parse({ ...identity, evidenceDigest: digest }),
    { ...identity, evidenceDigest: digest },
  );
  assert.throws(
    () =>
      changeProofRunHumanEvidenceInputSchema.parse({
        ...identity,
        evidenceDigest: digest,
        attachment: {
          kind: "snapshot",
          encoding: "utf8",
          data: "reviewed",
          capturedAt: 100,
        },
      }),
    /exactly one/u,
  );
  assert.throws(
    () => changeProofRunHumanEvidenceInputSchema.parse(identity),
    /exactly one/u,
  );
});

test("binary human evidence requires canonical encoding and matching media", () => {
  assert.throws(
    () =>
      changeProofExecutionHumanEvidenceAttachmentSchema.parse({
        kind: "screenshot",
        encoding: "utf8",
        data: "pixels",
        capturedAt: 100,
      }),
    /base64/u,
  );
  assert.throws(
    () =>
      changeProofExecutionHumanEvidenceAttachmentSchema.parse({
        kind: "screenshot",
        encoding: "base64",
        data: "not-base64",
        mime: "video/mp4",
        capturedAt: 100,
      }),
    /image\//u,
  );
});

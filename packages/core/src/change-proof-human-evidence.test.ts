import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  changeProofHumanEvidenceScopeDigest,
  persistChangeProofHumanEvidence,
} from "./change-proof-human-evidence.js";
import { readAuthoringEvidence } from "./authoring-evidence.js";

const scope = {
  organizationId: "acme",
  projectId: "relay",
  proofId: "proof-1",
  executionId: "execution-1",
  cellId: "cell-1",
  stepId: "step-1",
} as const;

test("human evidence is durably persisted and bound to the exact Proof boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-human-evidence-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    const persisted = await persistChangeProofHumanEvidence({
      scope,
      attachment: {
        kind: "snapshot",
        encoding: "utf8",
        data: '{"reviewed":true}',
        capturedAt: 100,
      },
    });
    assert.match(persisted.evidenceDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(
      (await readAuthoringEvidence(persisted.evidence.sha256!))?.toString("utf8"),
      '{"reviewed":true}',
    );
    assert.notEqual(
      persisted.scopeDigest,
      changeProofHumanEvidenceScopeDigest({
        scope: { ...scope, stepId: "another-step" },
        evidenceDigest: persisted.evidenceDigest,
      }),
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("human evidence rejects malformed binary attachments before persistence", async () => {
  await assert.rejects(
    persistChangeProofHumanEvidence({
      scope,
      attachment: {
        kind: "screenshot",
        encoding: "base64",
        data: "not-base64",
        capturedAt: 100,
      },
    }),
    /canonical base64/u,
  );
});

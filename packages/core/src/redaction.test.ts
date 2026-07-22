import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  REDACTED,
  getRedactionPolicy,
  loadRedactionPolicy,
  redactResolvedInputs,
  redactValue,
  setRedactionEnabled,
  visualEvidenceAllowed,
} from "./redaction.js";
import { initializeRunEvidence } from "./run-evidence.js";
import type { TestJob } from "./session.js";

test("redaction defaults off, persists changes, and can be environment-locked", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-redaction-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previousMode = process.env.RELAY_REDACTION_MODE;
  process.env.RELAY_WORKSPACE_ROOT = root;
  delete process.env.RELAY_REDACTION_MODE;
  try {
    assert.deepEqual(await loadRedactionPolicy(), {
      enabled: false,
      source: "default",
      locked: false,
    });

    const sentinel = "relay-secret-sentinel";
    const evidence = {
      authorization: `Bearer ${sentinel}`,
      clipboard: sentinel,
      url: `https://example.test/path?token=${sentinel}`,
      nested: { cookie: sentinel },
    };
    assert.equal(redactValue(evidence), evidence);
    assert.deepEqual(redactResolvedInputs({ password: sentinel }), { password: sentinel });

    await setRedactionEnabled(true);
    assert.equal(visualEvidenceAllowed(), false);
    const redacted = redactValue(evidence);
    assert.equal(JSON.stringify(redacted).includes(sentinel), false);
    assert.equal((redacted as { clipboard: string }).clipboard, REDACTED);
    assert.equal(redactResolvedInputs({ password: sentinel }).password?.includes(sentinel), false);
    const job = {
      id: "redacted-run",
      targetKind: "device",
      platform: "android",
      evidencePolicy: { schemaVersion: 1, sensitive: {} },
    } as TestJob;
    const manifest = initializeRunEvidence(job).manifest;
    for (const channel of ["screenshot", "video", "ui-tree"] as const) {
      assert.equal(manifest.channels[channel].status, "redacted");
      assert.equal(manifest.channels[channel].redactions, 1);
    }

    await setRedactionEnabled(false);
    assert.equal(visualEvidenceAllowed(), true);
    assert.equal(redactValue(evidence), evidence);
    assert.deepEqual(redactResolvedInputs({ password: sentinel }), { password: sentinel });
    assert.equal((await loadRedactionPolicy()).enabled, false);
    assert.equal(getRedactionPolicy().source, "workspace");

    process.env.RELAY_REDACTION_MODE = "on";
    assert.deepEqual(await loadRedactionPolicy(), {
      enabled: true,
      source: "environment",
      locked: true,
    });
    await assert.rejects(setRedactionEnabled(false), /controls this setting/);
  } finally {
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    if (previousMode === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previousMode;
    await loadRedactionPolicy();
    await rm(root, { recursive: true, force: true });
  }
});

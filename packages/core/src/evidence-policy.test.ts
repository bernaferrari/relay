import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getEvidenceCollectionPolicy,
  hasSensitiveEvidenceConsent,
  loadEvidenceCollectionPolicy,
  setSensitiveEvidenceConsent,
} from "./evidence-policy.js";

test("sensitive evidence consent is explicit, persisted, and revocable", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-evidence-policy-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    assert.deepEqual(await loadEvidenceCollectionPolicy(), {
      schemaVersion: 1,
      sensitive: {},
      redaction: { enabled: false, source: "default", locked: false },
    });
    const enabled = await setSensitiveEvidenceConsent({
      channel: "network-body",
      enabled: true,
      grantedBy: "qa-owner",
      reason: "Controlled trial",
    });
    assert.equal(hasSensitiveEvidenceConsent(enabled, "network-body"), true);
    assert.equal(enabled.sensitive["network-body"]?.grantedBy, "qa-owner");
    assert.equal(
      hasSensitiveEvidenceConsent(await loadEvidenceCollectionPolicy(), "network-body"),
      true,
    );
    const rawEnabled = await setSensitiveEvidenceConsent({
      channel: "network-raw",
      enabled: true,
      grantedBy: "qa-owner",
      reason: "Dedicated emulator packet investigation",
    });
    assert.equal(hasSensitiveEvidenceConsent(rawEnabled, "network-raw"), true);
    assert.equal(
      rawEnabled.sensitive["network-raw"]?.reason,
      "Dedicated emulator packet investigation",
    );
    await setSensitiveEvidenceConsent({
      channel: "network-body",
      enabled: false,
      grantedBy: "qa-owner",
    });
    assert.equal(hasSensitiveEvidenceConsent(getEvidenceCollectionPolicy(), "network-body"), false);
    assert.equal(hasSensitiveEvidenceConsent(getEvidenceCollectionPolicy(), "network-raw"), true);
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await loadEvidenceCollectionPolicy();
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getEvidenceCollectionPolicy,
  hasSensitiveEvidenceConsent,
  loadEvidenceCollectionPolicy,
  setSensitiveEvidenceConsent,
  setEvidenceCollectionMode,
  automaticVideoAllowed,
} from "./evidence-policy.js";

test("sensitive evidence consent is explicit, persisted, and revocable", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-evidence-policy-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    assert.deepEqual(await loadEvidenceCollectionPolicy(), {
      schemaVersion: 1,
      sensitive: {},
      mode: "lightweight",
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

test("collection mode survives consent updates and old workspace settings adopt lightweight", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-evidence-mode-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    await mkdir(join(root, ".relay"));
    await writeFile(
      join(root, ".relay", "evidence.json"),
      JSON.stringify({
        schemaVersion: 1,
        sensitive: { audio: { grantedAt: 1, grantedBy: "qa-owner", reason: "Existing consent" } },
      }),
    );
    assert.equal((await loadEvidenceCollectionPolicy()).mode, "lightweight");
    assert.equal(hasSensitiveEvidenceConsent(getEvidenceCollectionPolicy(), "audio"), true);
    const frozen = getEvidenceCollectionPolicy();
    await setEvidenceCollectionMode("full");
    await setSensitiveEvidenceConsent({ channel: "crash", enabled: true, grantedBy: "qa-owner" });
    assert.equal((await loadEvidenceCollectionPolicy()).mode, "full");
    assert.equal(hasSensitiveEvidenceConsent(getEvidenceCollectionPolicy(), "audio"), true);
    assert.equal(hasSensitiveEvidenceConsent(getEvidenceCollectionPolicy(), "crash"), true);
    assert.equal(frozen.mode, "lightweight");
    assert.equal(automaticVideoAllowed(frozen), false);
    assert.equal(automaticVideoAllowed({ schemaVersion: 1, sensitive: {}, mode: "full" }), true);
    assert.equal(automaticVideoAllowed({ schemaVersion: 1, sensitive: {} }), true);
    assert.equal(
      JSON.parse(await readFile(join(root, ".relay", "evidence.json"), "utf8")).mode,
      "full",
    );
    for (const mode of ["auto", null, false]) {
      await writeFile(
        join(root, ".relay", "evidence.json"),
        JSON.stringify({ schemaVersion: 1, sensitive: {}, mode }),
      );
      await assert.rejects(loadEvidenceCollectionPolicy(), /mode must be lightweight or full/);
    }
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await loadEvidenceCollectionPolicy();
    await rm(root, { recursive: true, force: true });
  }
});

test("changing storage mode cannot overwrite a concurrent consent revocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-evidence-concurrent-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    await loadEvidenceCollectionPolicy();
    await setSensitiveEvidenceConsent({
      channel: "network-body",
      enabled: true,
      grantedBy: "qa-owner",
    });
    await Promise.all([
      setSensitiveEvidenceConsent({
        channel: "network-body",
        enabled: false,
        grantedBy: "qa-owner",
      }),
      setEvidenceCollectionMode("full"),
    ]);
    const saved = await loadEvidenceCollectionPolicy();
    assert.equal(saved.mode, "full");
    assert.equal(hasSensitiveEvidenceConsent(saved, "network-body"), false);
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await loadEvidenceCollectionPolicy();
    await rm(root, { recursive: true, force: true });
  }
});

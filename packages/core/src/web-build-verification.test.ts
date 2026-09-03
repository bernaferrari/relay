import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resetControlDatabaseCache, saveBuild } from "./collaboration.js";
import {
  assertAuthoritativeWebDeploymentMatches,
  issueWebBuildProviderReceipt,
  issueWebBuildProviderReceiptFromAuthority,
  webBuildProviderReceiptIsValid,
} from "./web-build-verification.js";

const expected = {
  deploymentId: "web-preview",
  sourceUrl: "https://preview.example.test/pr-184",
  sourceSha: "a".repeat(40),
  deploymentDigest: `sha256:${"b".repeat(64)}` as const,
  configuration: "web.production",
  environmentRevision: "preview-v12",
};

test("web provider receipts authenticate exact deployment provenance", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "relay-web-receipt-test-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = stateRoot;
  resetControlDatabaseCache();
  try {
    const result = await issueWebBuildProviderReceiptFromAuthority({
      expected,
      lookup: async (request) => ({ provider: "fixture-host", ...request }),
    });
    const saved = await saveBuild({
      id: expected.deploymentId,
      projectId: "project",
      name: "Web preview",
      platform: "web",
      webProviderReceipt: result.receipt,
      status: "ready",
    });
    assert.equal(saved.webDeploymentMode, "provider-verified");
    assert.equal(saved.sourceUrl, expected.sourceUrl);
    assert.equal(saved.sourceSha, expected.sourceSha);
    assert.equal(saved.deploymentDigest, expected.deploymentDigest);
    assert.equal(saved.configuration, expected.configuration);
    assert.equal(saved.environmentRevision, expected.environmentRevision);
    assert.equal(webBuildProviderReceiptIsValid(result.receipt, result.deployment), true);
    assert.equal(
      webBuildProviderReceiptIsValid(result.receipt, {
        ...result.deployment,
        sourceSha: "c".repeat(40),
      }),
      false,
    );
    assert.equal(
      webBuildProviderReceiptIsValid({ ...result.receipt, deploymentDigest: expected.sourceSha }),
      false,
    );
    await assert.rejects(
      issueWebBuildProviderReceiptFromAuthority({
        expected,
        lookup: async (request) => ({
          provider: "fixture-host",
          ...request,
          deploymentDigest: `sha256:${"c".repeat(64)}`,
        }),
      }),
      /changed deploymentDigest/u,
    );
    assert.throws(
      () =>
        assertAuthoritativeWebDeploymentMatches(expected, {
          provider: "fixture-host",
          ...expected,
          sourceUrl: "http://localhost:4173",
        }),
      /changed sourceUrl/u,
    );
  } finally {
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("provider receipts cannot be issued for loopback development URLs", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "relay-web-receipt-loopback-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = stateRoot;
  resetControlDatabaseCache();
  try {
    await assert.rejects(
      issueWebBuildProviderReceipt({
        provider: "fixture-host",
        deploymentId: expected.deploymentId,
        sourceUrl: "http://localhost:4173",
        sourceSha: expected.sourceSha,
        deploymentDigest: expected.deploymentDigest,
        configuration: expected.configuration,
        environmentRevision: expected.environmentRevision,
      }),
      /invalid web deployment provider receipt/u,
    );
  } finally {
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(stateRoot, { recursive: true, force: true });
  }
});

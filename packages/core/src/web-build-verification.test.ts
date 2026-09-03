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
  createVercelWebDeploymentProvider,
  vercelWebDeploymentProviderFromEnvironment,
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
      lookup: async (request) => ({
        provider: "fixture-host",
        ...request,
        deploymentId: request.deploymentId ?? expected.deploymentId,
        deploymentDigest: request.deploymentDigest ?? expected.deploymentDigest,
        environmentRevision: request.environmentRevision ?? expected.environmentRevision,
      }),
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
          deploymentId: request.deploymentId ?? expected.deploymentId,
          environmentRevision: request.environmentRevision ?? expected.environmentRevision,
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

test("Vercel adapter resolves an immutable deployment and never echoes caller identity", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const provider = createVercelWebDeploymentProvider({
    token: "vercel-secret-that-must-not-appear-in-output",
    projectId: "prj_relay",
    repository: "Acme/Relay.git",
    teamId: "team_relay",
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(
        JSON.stringify({
          id: "dpl_immutable_123",
          url: "relay-abc.vercel.app",
          projectId: "prj_relay",
          readyState: "READY",
          target: "preview",
          createdAt: 1_728_000_000_000,
          meta: {
            githubCommitOrg: "acme",
            githubCommitRepo: "relay",
            githubCommitSha: expected.sourceSha,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const deployment = await provider({
    sourceUrl: "https://relay-abc.vercel.app",
    sourceSha: expected.sourceSha,
    configuration: "web.production",
  });
  assert.equal(deployment.provider, "vercel");
  assert.equal(deployment.deploymentId, "dpl_immutable_123");
  assert.equal(deployment.sourceUrl, "https://relay-abc.vercel.app");
  assert.equal(deployment.environmentRevision, "vercel:dpl_immutable_123");
  assert.match(deployment.deploymentDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /v13\/deployments/u);
  assert.equal(new URL(calls[0]!.url).pathname, "/v13/deployments/relay-abc.vercel.app");
  assert.match(calls[0]!.url, /teamId=team_relay/u);
  assert.equal(calls[0]!.authorization, "Bearer vercel-secret-that-must-not-appear-in-output");
});

test("Vercel adapter fails closed for wrong repository, project, commit, aliases, or readiness", async () => {
  const record = {
    id: "dpl_immutable_123",
    url: "relay-abc.vercel.app",
    projectId: "prj_relay",
    readyState: "READY",
    meta: {
      githubCommitOrg: "acme",
      githubCommitRepo: "relay",
      githubCommitSha: expected.sourceSha,
    },
  };
  let current = { ...record };
  const provider = createVercelWebDeploymentProvider({
    token: "secret",
    projectId: "prj_relay",
    repository: "acme/relay",
    fetch: async () => new Response(JSON.stringify(current), { status: 200 }),
  });
  const request = {
    sourceUrl: "https://relay-abc.vercel.app",
    sourceSha: expected.sourceSha,
    configuration: "web.production",
  };
  current = {
    ...record,
    meta: {
      githubCommitOrg: "other",
      githubCommitRepo: "repo",
      githubCommitSha: expected.sourceSha,
    },
  };
  await assert.rejects(provider(request), /repository/u);
  current = { ...record, projectId: "prj_other" };
  await assert.rejects(provider(request), /project/u);
  current = {
    ...record,
    meta: {
      githubCommitOrg: "acme",
      githubCommitRepo: "relay",
      githubCommitSha: "c".repeat(40),
    },
  };
  await assert.rejects(provider(request), /commit/u);
  current = { ...record, url: "relay-branch.vercel.app" };
  await assert.rejects(provider(request), /immutable URL/u);
  current = { ...record, readyState: "BUILDING" };
  await assert.rejects(provider(request), /ready immutable/u);
});

test("Vercel adapter hides provider credentials when the deployment service is unavailable", async () => {
  const token = "do-not-leak-this-vercel-token";
  const provider = createVercelWebDeploymentProvider({
    token,
    projectId: "prj_relay",
    repository: "acme/relay",
    fetch: async () => {
      throw new Error(`upstream rejected ${token}`);
    },
  });
  await assert.rejects(
    provider({
      sourceUrl: "https://relay-abc.vercel.app",
      sourceSha: expected.sourceSha,
      configuration: "web.production",
    }),
    (error: unknown) => {
      assert.equal((error as Error).message, "Vercel web deployment lookup is unavailable");
      assert.doesNotMatch((error as Error).message, new RegExp(token, "u"));
      return true;
    },
  );
});

test("Vercel environment setup is optional but partial configuration fails closed", () => {
  const names = [
    "RELAY_VERCEL_TOKEN",
    "RELAY_VERCEL_PROJECT_ID",
    "RELAY_VERCEL_REPOSITORY",
    "RELAY_VERCEL_TEAM_ID",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.equal(vercelWebDeploymentProviderFromEnvironment(), undefined);
    process.env.RELAY_VERCEL_TOKEN = "token";
    assert.throws(
      () => vercelWebDeploymentProviderFromEnvironment(),
      /needs RELAY_VERCEL_TOKEN, RELAY_VERCEL_PROJECT_ID, and RELAY_VERCEL_REPOSITORY/u,
    );
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

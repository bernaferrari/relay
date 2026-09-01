import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChangeVerification, VerificationPlan } from "@relay/protocol";
import { startServer } from "./index.js";
import {
  githubProofWebhookConfigurationFromEnvironment,
  GitHubProofIntakeError,
  processGitHubPullRequestWebhook,
  verifyGitHubPullRequest,
  verifyGitHubWebhookSignature,
  type GitHubProofIntakeRuntime,
  type VerifiedGitHubPullRequest,
} from "./github-proof-intake.js";

const secret = "github-webhook-test-secret";
const oldHead = "1".repeat(40);
const head = "2".repeat(40);
const scope = { organizationId: "org", projectId: "project" };

function body(action: "opened" | "synchronize" | "closed", sha = head): Buffer {
  return Buffer.from(
    JSON.stringify({
      action,
      repository: { full_name: "acme/mobile" },
      pull_request: { number: 17, head: { sha } },
    }),
  );
}

function headers(value: Buffer, deliveryId = "delivery-1") {
  return {
    "x-github-event": "pull_request",
    "x-github-delivery": deliveryId,
    "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(value).digest("hex")}`,
  };
}

function proof(id: string, sha: string, state = "planning"): ChangeVerification {
  return {
    id,
    state,
    change: { repository: "acme/mobile", baseSha: oldHead, headSha: sha, pullRequest: 17 },
    updatedAt: 10,
  } as ChangeVerification;
}

function plan(sha = head): VerificationPlan {
  return {
    change: { repository: "acme/mobile", baseSha: oldHead, headSha: sha, pullRequest: 17 },
  } as VerificationPlan;
}

function runtime(overrides: Partial<GitHubProofIntakeRuntime> = {}) {
  const deliveries = new Map<string, string>();
  const calls = { cancelled: [] as string[], superseded: [] as string[], created: [] as string[] };
  const verified: VerifiedGitHubPullRequest = {
    repository: "acme/mobile",
    pullRequest: 17,
    headSha: head,
    baseRef: "main",
    state: "open",
  };
  const value: GitHubProofIntakeRuntime = {
    verifyPullRequest: async () => verified,
    prepareExactHead: async () => plan(),
    activeProofs: async () => [],
    cancel: async ({ proof: current }) => {
      calls.cancelled.push(current.id);
      return proof(current.id, current.change.headSha, "cancelled");
    },
    supersede: async ({ proof: current, replacementId }) => {
      calls.superseded.push(current.id);
      return proof(replacementId, head);
    },
    create: async ({ proofId }) => {
      calls.created.push(proofId);
      return proof(proofId, head);
    },
    deliveryDigest: async (id) => deliveries.get(id),
    recordDelivery: async (id, digest) => {
      deliveries.set(id, digest);
    },
    ...overrides,
  };
  return { value, calls, deliveries };
}

test("rejects a missing, malformed, or mismatched signature before parsing payload", () => {
  const value = body("opened");
  for (const signature of [undefined, "sha256=bad", `sha256=${"0".repeat(64)}`]) {
    assert.throws(
      () => verifyGitHubWebhookSignature({ body: value, signature, secret }),
      (error) =>
        error instanceof GitHubProofIntakeError && error.code === "WEBHOOK_SIGNATURE_INVALID",
    );
  }
});

test("rejects a signed payload head that GitHub no longer verifies", async () => {
  const value = body("synchronize");
  const fixture = runtime({
    verifyPullRequest: async () => ({
      repository: "acme/mobile",
      pullRequest: 17,
      headSha: "3".repeat(40),
      baseRef: "main",
      state: "open",
    }),
  });
  await assert.rejects(
    processGitHubPullRequestWebhook({
      body: value,
      headers: headers(value),
      secret,
      configuredRepository: "acme/mobile",
      scope,
      runtime: fixture.value,
    }),
    (error) =>
      error instanceof GitHubProofIntakeError &&
      error.code === "PULL_REQUEST_VERIFICATION_MISMATCH",
  );
  assert.deepEqual(fixture.calls, { cancelled: [], superseded: [], created: [] });
});

test("GitHub API verification binds the configured base repository and exact head", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const verified = await verifyGitHubPullRequest({
    repository: "acme/mobile",
    pullRequest: 17,
    config: {
      owner: "acme",
      repository: "mobile",
      token: "github-token",
      apiBaseUrl: "http://127.0.0.1:4321",
    },
    fetchImpl: async (request, init) => {
      requests.push({
        url: String(request),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({
        number: 17,
        state: "open",
        head: { sha: head },
        base: { ref: "main", sha: oldHead, repo: { full_name: "acme/mobile" } },
      });
    },
  });
  assert.deepEqual(verified, {
    repository: "acme/mobile",
    pullRequest: 17,
    headSha: head,
    baseRef: oldHead,
    state: "open",
  });
  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:4321/repos/acme/mobile/pulls/17",
      authorization: "Bearer github-token",
    },
  ]);
});

test("rejects local preparation when it is not the GitHub-verified exact head", async () => {
  const value = body("opened");
  const fixture = runtime({ prepareExactHead: async () => plan("4".repeat(40)) });
  await assert.rejects(
    processGitHubPullRequestWebhook({
      body: value,
      headers: headers(value),
      secret,
      configuredRepository: "acme/mobile",
      scope,
      runtime: fixture.value,
    }),
    (error) => error instanceof GitHubProofIntakeError && error.code === "PREPARED_HEAD_MISMATCH",
  );
  assert.deepEqual(fixture.calls.created, []);
});

test("a synchronize delivery cancels active stale Proofs and supersedes the latest terminal Proof", async () => {
  const value = body("synchronize");
  const fixture = runtime({
    activeProofs: async () => [
      proof("active-old", oldHead),
      proof("terminal-old", oldHead, "rejected"),
    ],
  });
  const result = await processGitHubPullRequestWebhook({
    body: value,
    headers: headers(value),
    secret,
    configuredRepository: "acme/mobile",
    scope,
    runtime: fixture.value,
  });
  assert.equal(result.disposition, "updated");
  assert.deepEqual(result.cancelledProofIds, ["active-old"]);
  assert.deepEqual(fixture.calls.cancelled, ["active-old"]);
  assert.deepEqual(fixture.calls.superseded, ["terminal-old"]);
  assert.deepEqual(fixture.calls.created, []);
  assert.equal(result.proof?.change.headSha, head);
});

test("identical delivery replay is inert and changed reuse is rejected", async () => {
  const value = body("opened");
  const fixture = runtime();
  const input = {
    body: value,
    headers: headers(value),
    secret,
    configuredRepository: "acme/mobile",
    scope,
    runtime: fixture.value,
  };
  assert.equal((await processGitHubPullRequestWebhook(input)).disposition, "created");
  assert.equal((await processGitHubPullRequestWebhook(input)).disposition, "replayed");
  assert.equal(fixture.calls.created.length, 1);

  const changed = body("closed");
  await assert.rejects(
    processGitHubPullRequestWebhook({ ...input, body: changed, headers: headers(changed) }),
    (error) => error instanceof GitHubProofIntakeError && error.code === "WEBHOOK_REPLAY_CONFLICT",
  );
});

test("durable delivery claim prevents concurrent webhook side effects", async () => {
  const value = body("opened");
  const fixture = runtime();
  let deliveryState: "none" | "pending" | "completed" = "none";
  let releaseVerification!: () => void;
  const verificationGate = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
  fixture.value.claimDelivery = async () => {
    if (deliveryState === "completed") return "completed";
    if (deliveryState === "pending") return "pending";
    deliveryState = "pending";
    return "claimed";
  };
  fixture.value.completeDelivery = async () => {
    deliveryState = "completed";
  };
  fixture.value.verifyPullRequest = async () => {
    await verificationGate;
    return {
      repository: "acme/mobile",
      pullRequest: 17,
      headSha: head,
      baseRef: "main",
      state: "open",
    };
  };
  const input = {
    body: value,
    headers: headers(value, "delivery-concurrent"),
    secret,
    configuredRepository: "acme/mobile",
    scope,
    runtime: fixture.value,
  };
  const first = processGitHubPullRequestWebhook(input);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = await processGitHubPullRequestWebhook(input);
  assert.equal(second.disposition, "pending");
  releaseVerification();
  assert.equal((await first).disposition, "created");
  assert.equal(fixture.calls.created.length, 1);
});

test("an expired claim retries after a completion crash without creating a duplicate Proof", async () => {
  const value = body("opened");
  const fixture = runtime();
  let deliveryState: "none" | "pending" | "completed" = "none";
  let leaseExpiresAt = 1_100;
  let now = 1_000;
  let completeAttempts = 0;
  let storedProof: ChangeVerification | undefined;
  fixture.value.claimDelivery = async () => {
    if (deliveryState === "completed") return "completed";
    if (deliveryState === "pending" && now < leaseExpiresAt) return "pending";
    deliveryState = "pending";
    leaseExpiresAt = now + 100;
    return "claimed";
  };
  fixture.value.completeDelivery = async () => {
    completeAttempts += 1;
    if (completeAttempts === 1) throw new Error("injected completion crash");
    deliveryState = "completed";
  };
  fixture.value.activeProofs = async () => (storedProof ? [storedProof] : []);
  fixture.value.create = async ({ proofId }) => {
    fixture.calls.created.push(proofId);
    storedProof = proof(proofId, head);
    return storedProof;
  };
  const input = {
    body: value,
    headers: headers(value, "delivery-crash-retry"),
    secret,
    configuredRepository: "acme/mobile",
    scope,
    runtime: fixture.value,
  };
  await assert.rejects(processGitHubPullRequestWebhook(input), /injected completion crash/u);
  assert.equal(fixture.calls.created.length, 1);
  now = 1_101;
  const retried = await processGitHubPullRequestWebhook(input);
  assert.equal(retried.disposition, "updated");
  assert.equal(fixture.calls.created.length, 1);
  assert.equal(deliveryState, "completed");
});

test("startServer exposes only the configured raw-body signed route", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-github-webhook-http-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const fixture = runtime();
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    token: "relay-service-token-at-least-24-characters",
    githubProofWebhook: {
      secret,
      repository: "acme/mobile",
      scope,
      runtime: fixture.value,
    },
  });
  try {
    const value = body("opened");
    const invalid = await fetch(`http://127.0.0.1:${server.port}/webhooks/github`, {
      method: "POST",
      headers: { ...headers(value), "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
      body: value.toString("utf8"),
    });
    assert.equal(invalid.status, 401);
    assert.equal(fixture.calls.created.length, 0);

    const accepted = await fetch(`http://127.0.0.1:${server.port}/webhooks/github`, {
      method: "POST",
      headers: headers(value),
      body: value.toString("utf8"),
    });
    assert.equal(accepted.status, 202);
    assert.equal((await accepted.json()).disposition, "created");
    assert.equal(fixture.calls.created.length, 1);
  } finally {
    await server.close();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("webhook environment configuration is all-or-nothing", () => {
  const names = [
    "RELAY_GITHUB_WEBHOOK_SECRET",
    "RELAY_GITHUB_REPOSITORY",
    "RELAY_GITHUB_TOKEN",
    "RELAY_GITHUB_ORGANIZATION_ID",
    "RELAY_GITHUB_PROJECT_ID",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.equal(githubProofWebhookConfigurationFromEnvironment(), undefined);
    process.env.RELAY_GITHUB_WEBHOOK_SECRET = secret;
    assert.throws(githubProofWebhookConfigurationFromEnvironment, /requires RELAY_GITHUB/u);
    process.env.RELAY_GITHUB_REPOSITORY = "acme/mobile";
    process.env.RELAY_GITHUB_TOKEN = "token";
    process.env.RELAY_GITHUB_ORGANIZATION_ID = "org";
    process.env.RELAY_GITHUB_PROJECT_ID = "project";
    const configured = githubProofWebhookConfigurationFromEnvironment();
    assert.equal(configured?.repository, "acme/mobile");
    assert.deepEqual(configured?.scope, scope);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

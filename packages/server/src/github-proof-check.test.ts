import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeProofProviderCheck } from "@relay/protocol";
import { ProofCheckPublishError, publishGitHubProofCheck } from "./github-proof-check.js";

const headSha = "2".repeat(40);
const check: ChangeProofProviderCheck = {
  schemaVersion: 1,
  name: "Relay Proof",
  externalId: "proof-184",
  headSha,
  status: "completed",
  conclusion: "action-required",
  title: "Relay Proof — INSUFFICIENT EVIDENCE",
  summary: "Run the smallest missing required case.",
  text: "Required cases: 2/3 passed",
  detailsUrl: "https://relay.example.com/proofs/proof-184",
};

test("posts one exact-head GitHub check with action_required uncertainty", async () => {
  let calledUrl = "";
  let request: RequestInit | undefined;
  const published = await publishGitHubProofCheck({
    check,
    config: { owner: "acme", repository: "settings", token: "github-app-install-token" },
    fetchImpl: async (url, init) => {
      calledUrl = String(url);
      request = init;
      return new Response(
        JSON.stringify({
          id: 42,
          head_sha: headSha,
          external_id: "proof-184",
          html_url: "https://github.com/acme/settings/runs/42",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
  });
  assert.equal(calledUrl, "https://api.github.com/repos/acme/settings/check-runs");
  assert.equal((request?.headers as Record<string, string>)["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal(
    (request?.headers as Record<string, string>).Authorization,
    "Bearer github-app-install-token",
  );
  assert.deepEqual(JSON.parse(String(request?.body)), {
    name: "Relay Proof",
    head_sha: headSha,
    status: "completed",
    conclusion: "action_required",
    external_id: "proof-184",
    details_url: "https://relay.example.com/proofs/proof-184",
    output: {
      title: "Relay Proof — INSUFFICIENT EVIDENCE",
      summary: "Run the smallest missing required case.",
      text: "Required cases: 2/3 passed",
    },
  });
  assert.deepEqual(published, {
    provider: "github",
    checkRunId: 42,
    externalId: "proof-184",
    headSha,
    htmlUrl: "https://github.com/acme/settings/runs/42",
  });
});

test("maps proved and rejected conclusions without changing the frozen head", async () => {
  const conclusions: string[] = [];
  for (const conclusion of ["success", "failure"] as const) {
    await publishGitHubProofCheck({
      check: { ...check, conclusion },
      config: { owner: "acme", repository: "settings", token: "token" },
      fetchImpl: async (_url, init) => {
        conclusions.push(JSON.parse(String(init?.body)).conclusion);
        return new Response(
          JSON.stringify({ id: conclusions.length, head_sha: headSha, external_id: "proof-184" }),
          { status: 201 },
        );
      },
    });
  }
  assert.deepEqual(conclusions, ["success", "failure"]);
});

test("invalid configuration performs no network I/O", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response();
  };
  for (const config of [
    { owner: "../acme", repository: "settings", token: "token" },
    { owner: "acme", repository: "settings/other", token: "token" },
    { owner: "acme", repository: "settings", token: "" },
    {
      owner: "acme",
      repository: "settings",
      token: "token",
      apiBaseUrl: "http://github.example.com/api/v3",
    },
  ]) {
    await assert.rejects(publishGitHubProofCheck({ check, config, fetchImpl }));
  }
  assert.equal(calls, 0);
});

test("provider failures expose only safe status and request identity", async () => {
  const token = "secret-github-install-token";
  await assert.rejects(
    publishGitHubProofCheck({
      check,
      config: { owner: "acme", repository: "settings", token },
      fetchImpl: async () =>
        new Response(JSON.stringify({ message: `bad token ${token}` }), {
          status: 403,
          headers: { "x-github-request-id": "request-safe-1" },
        }),
    }),
    (error) => {
      assert.ok(error instanceof ProofCheckPublishError);
      assert.equal(error.status, 403);
      assert.equal(error.requestId, "request-safe-1");
      assert.doesNotMatch(error.message, new RegExp(token));
      return true;
    },
  );
});

test("a response for another head or Proof is never acknowledged", async () => {
  await assert.rejects(
    publishGitHubProofCheck({
      check,
      config: { owner: "acme", repository: "settings", token: "token" },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ id: 42, head_sha: "3".repeat(40), external_id: "other-proof" }),
          { status: 201 },
        ),
    }),
    /did not confirm the exact Proof head and identity/,
  );
});

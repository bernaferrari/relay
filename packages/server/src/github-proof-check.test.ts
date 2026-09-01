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
  classification: "insufficient-evidence",
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
  assert.ok(request);
  assert.equal((request.headers as Record<string, string>)["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal(
    (request.headers as Record<string, string>).Authorization,
    "Bearer github-app-install-token",
  );
  assert.deepEqual(JSON.parse(String(request.body)), {
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

test("publishes queued and in-progress updates without a premature conclusion", async () => {
  const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (_url: URL | RequestInfo, init?: RequestInit) => {
    requests.push({
      method: String(init?.method),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({ id: 42, head_sha: headSha, external_id: check.externalId }),
      { status: init?.method === "POST" ? 201 : 200 },
    );
  };
  const queued = {
    ...check,
    status: "queued",
    conclusion: undefined,
    classification: "queued",
  } as const;
  const published = await publishGitHubProofCheck({
    check: queued,
    config: { owner: "acme", repository: "settings", token: "token" },
    fetchImpl,
  });
  await publishGitHubProofCheck({
    check: { ...queued, status: "in_progress", classification: "in-progress" },
    existing: published,
    config: { owner: "acme", repository: "settings", token: "token" },
    fetchImpl,
  });

  assert.deepEqual(
    requests.map(({ method }) => method),
    ["POST", "PATCH"],
  );
  assert.equal(requests[0]!.body.status, "queued");
  assert.equal(requests[1]!.body.status, "in_progress");
  assert.equal("conclusion" in requests[0]!.body, false);
  assert.equal("conclusion" in requests[1]!.body, false);
  assert.equal("head_sha" in requests[1]!.body, false);
});

test("rejects a conclusion on progress before provider network access", async () => {
  let calls = 0;
  await assert.rejects(
    publishGitHubProofCheck({
      check: { ...check, status: "queued", classification: "queued" },
      config: { owner: "acme", repository: "settings", token: "token" },
      fetchImpl: async () => {
        calls += 1;
        return new Response();
      },
    }),
  );
  assert.equal(calls, 0);
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

test("updates a previously published check run instead of creating a duplicate", async () => {
  let calledUrl = "";
  let request: RequestInit | undefined;
  const published = await publishGitHubProofCheck({
    check: { ...check, conclusion: "success", title: "Relay Proof — PROVED" },
    existing: {
      provider: "github",
      checkRunId: 42,
      externalId: check.externalId,
      headSha,
      htmlUrl: "https://github.com/acme/settings/runs/42",
    },
    config: { owner: "acme", repository: "settings", token: "github-app-install-token" },
    fetchImpl: async (url, init) => {
      calledUrl = String(url);
      request = init;
      return new Response(
        JSON.stringify({
          id: 42,
          head_sha: headSha,
          external_id: check.externalId,
          html_url: "https://github.com/acme/settings/runs/42",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  assert.equal(calledUrl, "https://api.github.com/repos/acme/settings/check-runs/42");
  assert.equal(request?.method, "PATCH");
  const body = JSON.parse(String(request?.body));
  assert.equal(body.conclusion, "success");
  assert.equal(body.head_sha, undefined);
  assert.equal(published.checkRunId, 42);
  assert.equal(published.headSha, headSha);
});

test("does not update a receipt from another Proof or acknowledge another check run", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ id: 43, head_sha: headSha, external_id: check.externalId }),
      { status: 200 },
    );
  };
  await assert.rejects(
    publishGitHubProofCheck({
      check,
      existing: {
        provider: "github",
        checkRunId: 42,
        externalId: "other-proof",
        headSha,
      },
      config: { owner: "acme", repository: "settings", token: "token" },
      fetchImpl,
    }),
    /existing GitHub Proof receipt does not match/,
  );
  assert.equal(calls, 0);

  await assert.rejects(
    publishGitHubProofCheck({
      check,
      existing: {
        provider: "github",
        checkRunId: 42,
        externalId: check.externalId,
        headSha,
      },
      config: { owner: "acme", repository: "settings", token: "token" },
      fetchImpl,
    }),
    /did not confirm the exact Proof head and identity/,
  );
  assert.equal(calls, 1);
});

test("reconciles an unacknowledged exact Proof check before creating", async () => {
  const methods: string[] = [];
  const published = await publishGitHubProofCheck({
    check,
    reconcileUnacknowledged: true,
    config: { owner: "acme", repository: "settings", token: "token" },
    fetchImpl: async (_url, init) => {
      methods.push(String(init?.method));
      if (init?.method === "GET") {
        return new Response(
          JSON.stringify({
            total_count: 1,
            check_runs: [{ id: 42, head_sha: headSha, external_id: check.externalId }],
          }),
          { status: 200 },
        );
      }
      const body = JSON.parse(String(init?.body));
      assert.equal(body.head_sha, undefined);
      return new Response(
        JSON.stringify({ id: 42, head_sha: headSha, external_id: check.externalId }),
        { status: 200 },
      );
    },
  });
  assert.deepEqual(methods, ["GET", "PATCH"]);
  assert.equal(published.checkRunId, 42);
});

test("incomplete reconciliation fails closed before creating a duplicate", async () => {
  let calls = 0;
  await assert.rejects(
    publishGitHubProofCheck({
      check,
      reconcileUnacknowledged: true,
      config: { owner: "acme", repository: "settings", token: "token" },
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ total_count: 101, check_runs: [] }), { status: 200 });
      },
    }),
    /will not risk a duplicate/u,
  );
  assert.equal(calls, 1);
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

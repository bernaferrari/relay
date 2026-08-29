import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  advanceChangeVerification,
  createChangeVerification,
  readChangeProofPublications,
  resetControlDatabaseCache,
  supersedeChangeVerification,
} from "@relay/core";
import { publishChangeProofToGitHub } from "./change-proof-github-publisher.js";

const scope = { organizationId: "acme", projectId: "relay" } as const;
const headSha = "2".repeat(40);
const digest = `sha256:${"a".repeat(64)}` as const;

async function withStateRoot(operation: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-github-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    await operation();
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function createTerminalProof() {
  const created = await createChangeVerification({
    ...scope,
    id: "proof-1",
    change: { repository: "acme/settings", baseSha: "1".repeat(40), headSha },
    policy: { id: "relay.verify-change", version: 1 },
    requestedBy: "agent:coder",
    actorId: "agent:coder",
    requestId: "start",
    requestDigest: digest,
    at: 100,
  });
  return advanceChangeVerification({
    ...scope,
    proofId: created.id,
    expectedVersion: created.version,
    state: "insufficient-evidence",
    actorId: "system:relay",
    requestId: "decision",
    requestDigest: `sha256:${"b".repeat(64)}`,
    action: "record-decision",
    at: 200,
    coverageGaps: ["Exact build evidence is missing."],
    smallestNextVerification: { kind: "provide-build", reason: "Bind the exact head build." },
  });
}

test("publishes once, updates the acknowledged check, and reuses an identical receipt", async () => {
  await withStateRoot(async () => {
    await createTerminalProof();
    const methods: string[] = [];
    const urls: string[] = [];
    const fetchImpl = async (url: URL | RequestInfo, init?: RequestInit) => {
      methods.push(String(init?.method));
      urls.push(String(url));
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ total_count: 0, check_runs: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: 42,
          head_sha: headSha,
          external_id: "proof-1",
          html_url: "https://github.com/acme/settings/runs/42",
        }),
        { status: init?.method === "POST" ? 201 : 200 },
      );
    };
    await publishChangeProofToGitHub({
      ...scope,
      proofId: "proof-1",
      config: { owner: "acme", repository: "settings", token: "installation-token" },
      fetchImpl,
      now: () => 300,
    });
    const repeated = await publishChangeProofToGitHub({
      ...scope,
      proofId: "proof-1",
      config: { owner: "acme", repository: "settings", token: "installation-token" },
      fetchImpl,
      now: () => 400,
    });

    assert.deepEqual(methods, ["GET", "POST", "PATCH"]);
    assert.match(urls[0]!, /\/commits\/[a-f0-9]+\/check-runs\?/u);
    assert.match(urls[1]!, /\/check-runs$/u);
    assert.match(urls[2]!, /\/check-runs\/42$/u);
    const receipts = await readChangeProofPublications(scope, "proof-1");
    assert.deepEqual(
      receipts.map(({ sequence, checkRunId }) => [sequence, checkRunId]),
      [[1, 42]],
    );
    assert.equal(repeated.receipt.sequence, 1);
  });
});

test("a repository mismatch fails before provider network access", async () => {
  await withStateRoot(async () => {
    await createTerminalProof();
    let calls = 0;
    await assert.rejects(
      publishChangeProofToGitHub({
        ...scope,
        proofId: "proof-1",
        config: { owner: "acme", repository: "other", token: "installation-token" },
        fetchImpl: async () => {
          calls += 1;
          return new Response();
        },
      }),
      /does not match the exact Proof repository/u,
    );
    assert.equal(calls, 0);
  });
});

test("restart publication acknowledges the exact queued historical Proof version", async () => {
  await withStateRoot(async () => {
    const terminal = await createTerminalProof();
    await supersedeChangeVerification({
      ...scope,
      proofId: terminal.id,
      expectedVersion: terminal.version,
      actorId: "agent:coder",
      requestId: "rerun",
      requestDigest: `sha256:${"c".repeat(64)}`,
      at: 250,
      replacement: {
        id: "proof-2",
        change: {
          repository: "acme/settings",
          baseSha: headSha,
          headSha: "3".repeat(40),
        },
        policy: { id: "relay.verify-change", version: 1 },
        requestedBy: "agent:coder",
        actorId: "agent:coder",
        requestId: "rerun",
        requestDigest: `sha256:${"c".repeat(64)}`,
        action: "rerun-affected",
        at: 250,
      },
    });
    let publishedHead: string | undefined;
    await publishChangeProofToGitHub({
      ...scope,
      proofId: terminal.id,
      proofVersion: terminal.version,
      config: { owner: "acme", repository: "settings", token: "installation-token" },
      fetchImpl: async (_url, init) => {
        if (init?.method === "GET") {
          return new Response(JSON.stringify({ total_count: 0, check_runs: [] }), { status: 200 });
        }
        const body = JSON.parse(String(init?.body)) as { head_sha?: string };
        publishedHead = body.head_sha;
        return new Response(
          JSON.stringify({ id: 84, head_sha: headSha, external_id: terminal.id }),
          { status: 201 },
        );
      },
      now: () => 300,
    });

    assert.equal(publishedHead, headSha);
    const receipt = (await readChangeProofPublications(scope, terminal.id)).at(-1);
    assert.equal(receipt?.proofVersion, terminal.version);
    assert.equal(receipt?.conclusion, "action-required");
  });
});

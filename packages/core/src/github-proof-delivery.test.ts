import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GITHUB_PROOF_DELIVERY_LEASE_MS,
  claimGitHubProofDelivery,
  completeGitHubProofDelivery,
  readGitHubProofDeliveryDigest,
  recordGitHubProofDeliveryDigest,
} from "./github-proof-delivery.js";

test("GitHub delivery digest survives restart and conflicting replay cannot overwrite it", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-github-delivery-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const input = {
    organizationId: "org",
    projectId: "project",
    deliveryId: "delivery-1",
    digest: `sha256:${"1".repeat(64)}` as const,
  };
  try {
    assert.equal(await recordGitHubProofDeliveryDigest(input), "recorded");
    assert.equal(await recordGitHubProofDeliveryDigest(input), "existing");
    assert.equal(await readGitHubProofDeliveryDigest({ ...input }), input.digest);
    await assert.rejects(
      recordGitHubProofDeliveryDigest({ ...input, digest: `sha256:${"2".repeat(64)}` }),
      /already bound/u,
    );
    assert.equal(await readGitHubProofDeliveryDigest(input), input.digest);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("delivery claim is atomic, leases crashed work, and completed replay is inert", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-github-delivery-claim-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const base = {
    organizationId: "org",
    projectId: "project",
    deliveryId: "delivery-claim",
    digest: `sha256:${"3".repeat(64)}` as const,
  };
  try {
    const claims = await Promise.all([
      claimGitHubProofDelivery({ ...base, now: 1_000, leaseMs: 100 }),
      claimGitHubProofDelivery({ ...base, now: 1_001, leaseMs: 100 }),
    ]);
    assert.deepEqual(claims.map((claim) => claim.disposition).sort(), ["claimed", "pending"]);
    await assert.rejects(
      claimGitHubProofDelivery({
        ...base,
        digest: `sha256:${"4".repeat(64)}`,
        now: 1_002,
        leaseMs: 100,
      }),
      /already bound/u,
    );

    // A worker that lost the process after its external work can be retried
    // only after its durable lease expires; the state remains across calls.
    const retry = await claimGitHubProofDelivery({ ...base, now: 1_101, leaseMs: 100 });
    assert.equal(retry.disposition, "claimed");
    await assert.rejects(
      completeGitHubProofDelivery({
        ...base,
        claimToken: claims.find((claim) => claim.disposition === "claimed")!.state.claimToken,
        now: 1_102,
      }),
      /no longer owned/u,
    );
    assert.equal(
      await completeGitHubProofDelivery({
        ...base,
        claimToken: retry.state.claimToken,
        now: 1_103,
      }),
      "completed",
    );
    assert.equal(
      await completeGitHubProofDelivery({
        ...base,
        claimToken: retry.state.claimToken,
        now: 1_104,
      }),
      "existing",
    );
    assert.equal(
      (
        await claimGitHubProofDelivery({
          ...base,
          now: 1_104,
          leaseMs: GITHUB_PROOF_DELIVERY_LEASE_MS,
        })
      ).disposition,
      "completed",
    );
    assert.equal(await readGitHubProofDeliveryDigest(base), base.digest);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

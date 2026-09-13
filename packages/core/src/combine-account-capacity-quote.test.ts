import assert from "node:assert/strict";
import test from "node:test";
import type { CombineProfileTargetInput } from "@relay/protocol";
import { quoteBrowserAccountPackDuration } from "./combine-account-capacity-quote.js";

function fixtureLane(reference: string): CombineProfileTargetInput {
  return {
    profileId: "grok-com",
    engine: "chromium",
    account: {
      kind: "fixture",
      accountId: reference.split(":")[1]!,
      accountRevision: "1",
      reference,
    },
    target: { targetKind: "browser", browserTargetId: "grok-com", platform: "browser" },
  };
}

test("three grok-com fixture lanes quote one-wave duration within 20% of the live 3-account pack", () => {
  const quote = quoteBrowserAccountPackDuration({
    checks: 1,
    profileTargets: [
      fixtureLane("authfx:a00050ff-c0c2-4a0f-ba9c-1418e16cf28d:1"),
      fixtureLane("authfx:1d9054ec-7169-4f14-88e3-838fd159057e:1"),
      fixtureLane("authfx:d969bd0d-4b45-4525-9ef5-3d3638f8a43b:1"),
    ],
    observed: {
      durationMs: 14_868,
      provenance: "observed-sample",
      sampleCount: 1,
      workItemCount: 1,
      campaignIds: ["live-3-account"],
    },
  });
  assert.equal(quote?.estimatedParallelDurationMs, 14_868);
  assert.equal(quote?.laneCount, 3);
  assert.equal(quote?.workItems, 3);
  assert.ok(
    quote !== undefined && Math.abs(quote.estimatedParallelDurationMs - 14_869) / 14_869 <= 0.2,
  );
});

test("one grok-com signed-out target still serializes three account cells", () => {
  const signedOut: CombineProfileTargetInput = {
    profileId: "grok-com",
    engine: "chromium",
    account: { kind: "signed-out", attested: true },
    target: { targetKind: "browser", browserTargetId: "grok-com", platform: "browser" },
  };
  const quote = quoteBrowserAccountPackDuration({
    checks: 1,
    profileTargets: [signedOut, signedOut, signedOut],
    observed: {
      durationMs: 14_868,
      provenance: "observed-sample",
      sampleCount: 1,
      workItemCount: 1,
      campaignIds: ["serial"],
    },
  });
  assert.equal(quote?.laneCount, 1);
  assert.equal(quote?.estimatedParallelDurationMs, 14_868 * 3);
});

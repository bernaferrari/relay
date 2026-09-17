import assert from "node:assert/strict";
import test from "node:test";
import type { CombineProfileTargetInput } from "@relay/protocol";
import {
  quoteBrowserAccountPackDuration,
  quoteSuperGrokAccountPackDuration,
  requestedFixtureReferences,
} from "./combine-account-capacity-quote.js";

const SUPERGROK = "authfx:7189423f-193e-45ed-b674-154505cc5107:1";

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

function signedOutLane(): CombineProfileTargetInput {
  return {
    profileId: "grok-com",
    engine: "chromium",
    account: { kind: "signed-out", attested: true },
    target: { targetKind: "browser", browserTargetId: "grok-com", platform: "browser" },
  };
}

const observedSample = {
  durationMs: 14_868,
  provenance: "observed-sample" as const,
  sampleCount: 1,
  workItemCount: 1,
  campaignIds: ["lane-isolation"],
};

test("one SuperGrok fixture cannot produce a 3-account SuperGrok duration quote", () => {
  const invented = [
    "authfx:a00050ff-c0c2-4a0f-ba9c-1418e16cf28d:1",
    "authfx:1d9054ec-7169-4f14-88e3-838fd159057e:1",
  ];
  const profileTargets = [fixtureLane(SUPERGROK), ...invented.map(fixtureLane)];
  assert.deepEqual(requestedFixtureReferences(profileTargets), [SUPERGROK, ...invented]);
  assert.equal(
    quoteSuperGrokAccountPackDuration({
      checks: 1,
      profileTargets,
      observed: { ...observedSample, campaignIds: ["live-3-account"] },
      liveFixtureReferences: [SUPERGROK],
    }),
    undefined,
  );
  assert.equal(
    quoteBrowserAccountPackDuration({
      checks: 1,
      profileTargets,
      observed: { ...observedSample, campaignIds: ["live-3-account"] },
      liveFixtureReferences: [SUPERGROK],
    }),
    undefined,
  );
  assert.equal(
    quoteBrowserAccountPackDuration({
      checks: 1,
      profileTargets,
      observed: { ...observedSample, campaignIds: ["live-3-account"] },
    }),
    undefined,
  );
});

test("grok-lab SuperGrok plus unsigned and auth Lanes is isolation, not 3 SuperGrok accounts", () => {
  const profileTargets = [fixtureLane(SUPERGROK), signedOutLane(), signedOutLane()];
  assert.deepEqual(requestedFixtureReferences(profileTargets), [SUPERGROK]);
  assert.equal(
    quoteSuperGrokAccountPackDuration({
      checks: 1,
      profileTargets,
      observed: observedSample,
      liveFixtureReferences: [SUPERGROK],
    }),
    undefined,
  );
  const isolation = quoteBrowserAccountPackDuration({
    checks: 1,
    profileTargets,
    observed: observedSample,
    liveFixtureReferences: [SUPERGROK],
  });
  assert.equal(isolation?.laneCount, 2);
  assert.notEqual(isolation?.laneCount, 3);
});

test("three live fixtures may quote one-wave scheduler math, not a measured SuperGrok pack", () => {
  const live = [
    SUPERGROK,
    "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1",
    "authfx:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:1",
  ];
  const quote = quoteSuperGrokAccountPackDuration({
    checks: 1,
    profileTargets: live.map(fixtureLane),
    observed: observedSample,
    liveFixtureReferences: live,
  });
  assert.equal(quote?.estimatedParallelDurationMs, 14_868);
  assert.equal(quote?.laneCount, 3);
  assert.equal(quote?.workItems, 3);
});

test("one grok-com signed-out target still serializes three account cells", () => {
  const signedOut = signedOutLane();
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

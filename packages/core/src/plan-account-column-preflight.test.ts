import assert from "node:assert/strict";
import { test } from "node:test";
import type { CombineProfileTargetInput } from "@relay/protocol";
import { preflightRequestedPlanColumns } from "./plan-account-column-preflight.js";

function fixtureAccount(letter: string): CombineProfileTargetInput {
  return {
    profileId: "grok-com",
    engine: "chromium",
    account: {
      kind: "fixture",
      accountId: `acct-${letter}`,
      accountRevision: "1",
    },
    target: { targetKind: "browser", browserTargetId: "grok-com", platform: "browser" },
  };
}

function androidColumn(serial?: string): CombineProfileTargetInput {
  return {
    profileId: "pixel-8",
    target: {
      targetKind: "device",
      platform: "android",
      ...(serial ? { serial } : {}),
    },
  };
}

function iosColumn(serial?: string): CombineProfileTargetInput {
  return {
    profileId: "ipad-pro",
    target: {
      targetKind: "device",
      platform: "ios",
      ...(serial ? { serial } : {}),
    },
  };
}

test("six accounts plus Android and iOS stay eight requested columns when inventory is missing", () => {
  const profileTargets = [
    ...["a", "b", "c", "d", "e", "f"].map(fixtureAccount),
    androidColumn("pixel-8"),
    iosColumn("ipad-pro"),
  ];
  assert.equal(profileTargets.length, 8);
  const blockers = preflightRequestedPlanColumns({
    profileTargets,
    liveFixtureCount: 1,
    connectedSerials: [],
  });
  assert.equal(profileTargets.length, 8);
  assert.match(blockers[0]?.message ?? "", /asked for 6 live sign-ins/u);
  assert.match(blockers[0]?.message ?? "", /This Mac has 1/u);
  assert.match(blockers[0]?.message ?? "", /not a 1-column pass/u);
  assert.equal(blockers[0]?.code, "missing-binding");
  assert.equal(blockers.filter((item) => item.code === "target-missing").length, 2);
});

test("a signed-out browser column does not demand live fixtures", () => {
  const blockers = preflightRequestedPlanColumns({
    profileTargets: [
      {
        profileId: "grok-com",
        engine: "chromium",
        account: { kind: "signed-out", attested: true },
        target: { targetKind: "browser", browserTargetId: "grok-com", platform: "browser" },
      },
    ],
    liveFixtureCount: 1,
    connectedSerials: [],
  });
  assert.deepEqual(blockers, []);
});

test("six live fixtures and connected phones pass column preflight", () => {
  const blockers = preflightRequestedPlanColumns({
    profileTargets: [
      ...["a", "b", "c", "d", "e", "f"].map(fixtureAccount),
      androidColumn("pixel-8"),
      iosColumn("ipad-pro"),
    ],
    liveFixtureCount: 6,
    connectedSerials: ["pixel-8", "ipad-pro"],
  });
  assert.deepEqual(blockers, []);
});

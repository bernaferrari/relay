import assert from "node:assert/strict";
import test from "node:test";
import { scheduledCombineStartInput } from "./scheduler-combine.js";

test("scheduled Plan start freezes every account column", () => {
  const input = scheduledCombineStartInput({
    id: "sched-1",
    recipeId: "",
    combineId: "grok-web-daily",
    appMapId: "grok-web",
    targetKind: "browser",
    targetId: "grok-com",
    platform: "browser",
    intervalMinutes: 1_440,
    repetitions: 1,
    enabled: true,
    projectId: "default",
    createdAt: 1,
    updatedAt: 1,
    nextRunAt: 1,
    profileTargets: [
      {
        profileId: "grok-com",
        engine: "chromium",
        account: { kind: "fixture", accountId: "acct-a", accountRevision: "1" },
        target: { targetKind: "browser", browserTargetId: "grok-com" },
      },
      {
        profileId: "grok-com",
        engine: "chromium",
        account: { kind: "fixture", accountId: "acct-b", accountRevision: "1" },
        target: { targetKind: "browser", browserTargetId: "grok-com" },
      },
      {
        profileId: "pixel-8",
        target: { targetKind: "device", serial: "pixel-8", platform: "android" },
      },
    ],
  });
  assert.equal(input.combineId, "grok-web-daily");
  assert.equal(input.profileTargets?.length, 3);
  assert.equal(input.browserTargetId, "grok-com");
  assert.equal(input.profileTargets?.[0]?.account?.kind, "fixture");
});

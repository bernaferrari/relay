import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  deleteSchedule,
  listSchedules,
  markScheduleFailure,
  markScheduleRun,
  resolveScheduledTargetProfile,
  saveSchedule,
} from "./schedules.js";

test("scheduled profiles match both target identity and target kind", () => {
  const profile = resolveScheduledTargetProfile({ targetKind: "browser", targetId: "chat" }, [
    {
      id: "device:chat",
      targetId: "chat",
      source: "device",
      platform: "android",
      name: "Wrong source",
      capabilities: ["tap"],
      observedAt: 10,
    },
    {
      id: "browser:chat",
      targetId: "chat",
      source: "browser",
      platform: "browser",
      name: "Chat fixture",
      capabilities: ["tap"],
      observedAt: 10,
    },
  ]);
  assert.equal(profile?.id, "browser:chat");
});

test("local schedules persist and advance after a run", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-schedules-"));
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const saved = await saveSchedule({
      recipeId: "smoke",
      targetKind: "device",
      targetId: "device-1",
      platform: "android",
      intervalMinutes: 60,
    });
    await markScheduleRun(saved.id, 1_000);
    const [updated] = await listSchedules();
    assert.equal(updated?.lastRunAt, 1_000);
    assert.equal(updated?.nextRunAt, 3_601_000);
    await deleteSchedule(saved.id);
    assert.deepEqual(await listSchedules(), []);
  } finally {
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("scheduled admission failures stay visible until a successful occurrence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-schedule-failures-"));
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const saved = await saveSchedule({
      recipeId: "combine",
      targetKind: "device",
      targetId: "device-1",
      platform: "android",
      intervalMinutes: 10,
    });
    await markScheduleFailure(saved.id, "missing private Variable", 2_000);
    const [failed] = await listSchedules();
    assert.equal(failed?.lastFailureAt, 2_000);
    assert.equal(failed?.lastFailure, "missing private Variable");
    assert.equal(failed?.nextRunAt, 602_000);

    await markScheduleRun(saved.id, 3_000);
    const [recovered] = await listSchedules();
    assert.equal(recovered?.lastFailureAt, undefined);
    assert.equal(recovered?.lastFailure, undefined);
    assert.equal(recovered?.lastRunAt, 3_000);
  } finally {
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("local schedules preserve a managed browser target", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-schedules-"));
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const saved = await saveSchedule({
      recipeId: "chat-smoke",
      targetKind: "browser",
      targetId: "browser-workspace",
      platform: "browser",
      intervalMinutes: 1_440,
      repetitions: 3,
    });
    const [stored] = await listSchedules();
    assert.deepEqual(
      {
        targetKind: stored?.targetKind,
        targetId: stored?.targetId,
        platform: stored?.platform,
        repetitions: stored?.repetitions,
      },
      {
        targetKind: "browser",
        targetId: "browser-workspace",
        platform: "browser",
        repetitions: 3,
      },
    );
    await deleteSchedule(saved.id);
  } finally {
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("Plan schedules persist combineId, hour, and account columns after a disk reread", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-plan-schedule-"));
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const saved = await saveSchedule({
      combineId: "grok-web-daily",
      appMapId: "grok-web",
      targetKind: "browser",
      targetId: "grok-com",
      platform: "browser",
      intervalMinutes: 1_440,
      hour: 8,
      timezone: "UTC",
      profileTargets: [
        {
          profileId: "grok-com",
          engine: "chromium",
          account: { kind: "fixture", accountId: "acct-a", accountRevision: "1" },
          target: { targetKind: "browser", browserTargetId: "grok-com" },
        },
        {
          profileId: "pixel-8",
          target: { targetKind: "device", serial: "pixel-8", platform: "android" },
        },
      ],
    });
    const [stored] = await listSchedules();
    assert.equal(saved.recipeId, "");
    assert.equal(stored?.combineId, "grok-web-daily");
    assert.equal(stored?.appMapId, "grok-web");
    assert.equal(stored?.hour, 8);
    assert.equal(stored?.timezone, "UTC");
    assert.equal(stored?.profileTargets?.length, 2);
    assert.equal(stored?.profileTargets?.[0]?.account?.kind, "fixture");
    await deleteSchedule(saved.id);
  } finally {
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
});

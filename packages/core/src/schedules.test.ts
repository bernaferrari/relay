import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  deleteSchedule,
  listSchedules,
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

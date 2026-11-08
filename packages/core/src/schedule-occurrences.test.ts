import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ScheduleOccurrence } from "@relay/protocol";
import {
  beginScheduleOccurrence,
  finishScheduleOccurrenceAdmission,
  listScheduleOccurrences,
  projectScheduleOccurrence,
  saveScheduleOccurrence,
} from "./schedule-occurrences.js";
import type { PersistedRun } from "./runs.js";

const occurrence: ScheduleOccurrence = {
  id: "schedule:one:1000",
  scheduleId: "one",
  projectId: "project",
  scheduledAt: 1000,
  createdAt: 1000,
  updatedAt: 1000,
  expectedCaseCount: 2,
  state: "running",
  jobs: [
    { id: "a", testId: "chat" },
    { id: "b", testId: "chat" },
  ],
};
function run(
  id: string,
  outcome: PersistedRun["outcome"],
): Pick<PersistedRun, "id" | "projectId" | "schemaVersion" | "status" | "outcome"> {
  return {
    schemaVersion: 5,
    id,
    projectId: "project",
    status: outcome === "product-failure" ? "error" : "ok",
    outcome,
  };
}

test("a cycle requires every exact committed case and never hides a failing sibling", () => {
  const passed = { run: run("a", "passed"), active: false };
  assert.equal(
    projectScheduleOccurrence(occurrence, [passed, { run: null, active: true }]).state,
    "running",
  );
  assert.equal(
    projectScheduleOccurrence(occurrence, [passed, { run: null, active: false }]).state,
    "interrupted",
  );
  assert.equal(
    projectScheduleOccurrence(occurrence, [
      passed,
      { run: run("b", "product-failure"), active: false },
    ]).verdict,
    "failed",
  );
  assert.equal(
    projectScheduleOccurrence(occurrence, [passed, { run: run("b", "passed"), active: false }])
      .verdict,
    "passed",
  );
  assert.equal(
    projectScheduleOccurrence(occurrence, [passed, { run: run("b", "uncertain"), active: false }])
      .verdict,
    "review-required",
  );
  assert.equal(
    projectScheduleOccurrence({ ...occurrence, expectedCaseCount: 3 }, [passed, passed]).state,
    "interrupted",
  );
});

test("occurrences survive reload, remain project-scoped, and uncertain admission cannot replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-occurrences-"));
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const input = {
      id: "one",
      recipeId: "test",
      targetKind: "browser" as const,
      targetId: "browser",
      platform: "browser" as const,
      projectId: "project",
      enabled: true,
      intervalMinutes: 30,
      repetitions: 1,
      nextRunAt: 1000,
      createdAt: 0,
      updatedAt: 0,
    };
    const pending = await beginScheduleOccurrence(input, 1001);
    assert.equal(
      (await listScheduleOccurrences({ projectId: "project", scheduleId: "one" }))[0]?.state,
      "admitting",
    );
    finishScheduleOccurrenceAdmission(pending.id);
    assert.equal(
      (await listScheduleOccurrences({ projectId: "project", scheduleId: "one" }))[0]?.state,
      "interrupted",
    );
    await assert.rejects(beginScheduleOccurrence(input, 1002), /already exists/);
    await saveScheduleOccurrence({ ...pending, state: "blocked", detail: "Needs login" });
    assert.equal(
      (await listScheduleOccurrences({ projectId: "project", scheduleId: "one" }))[0]?.detail,
      "Needs login",
    );
    assert.deepEqual(await listScheduleOccurrences({ projectId: "other", scheduleId: "one" }), []);
  } finally {
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
});

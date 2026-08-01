import assert from "node:assert/strict";
import { appendFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { OperationContext } from "./operation-context.js";
import { ActivityCursorError, ActivityLog } from "./activity-log.js";

function operation(
  projectId: string,
  requestId: string,
  overrides: Partial<OperationContext> = {},
): OperationContext {
  return {
    schemaVersion: 1,
    actorId: "agent:indexer",
    actorKind: "agent",
    organizationId: "acme",
    projectId,
    operationId: "journey.update",
    requestId,
    idempotencyKey: requestId,
    issuedAt: 100,
    ...overrides,
  };
}

const activity = (summary: string, timestamp: number) => ({
  eventType: "journey.updated",
  resourceKind: "journey",
  resourceId: "checkout",
  summary,
  timestamp,
});

test("Activity history survives a new store instance with semantic attribution intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-activity-restart-"));
  try {
    const first = new ActivityLog({ rootDirectory: root });
    const context = operation("mobile", "request-1", {
      correlationId: "correlation-1",
      causationId: "causation-1",
      authoringSessionId: "session-1",
      leaseId: "lease-1",
    });
    await first.append(
      {
        ...activity("Updated checkout", 1_000),
        beforeRevision: 4,
        afterRevision: 5,
        evidenceIds: ["screenshot-a", "screenshot-a", "video-a"],
      },
      context,
    );

    const restarted = new ActivityLog({ rootDirectory: root });
    const page = await restarted.list({ organizationId: "acme", projectId: "mobile" });
    assert.equal(page.items.length, 1);
    assert.deepEqual(
      {
        actorId: page.items[0]?.actorId,
        actorKind: page.items[0]?.actorKind,
        operationId: page.items[0]?.operationId,
        requestId: page.items[0]?.requestId,
        correlationId: page.items[0]?.correlationId,
        causationId: page.items[0]?.causationId,
        sessionId: page.items[0]?.sessionId,
        leaseId: page.items[0]?.leaseId,
        beforeRevision: page.items[0]?.beforeRevision,
        afterRevision: page.items[0]?.afterRevision,
        evidenceIds: page.items[0]?.evidenceIds,
      },
      {
        actorId: "agent:indexer",
        actorKind: "agent",
        operationId: "journey.update",
        requestId: "request-1",
        correlationId: "correlation-1",
        causationId: "causation-1",
        sessionId: "session-1",
        leaseId: "lease-1",
        beforeRevision: 4,
        afterRevision: 5,
        evidenceIds: ["screenshot-a", "video-a"],
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Activity history is project-scoped, newest-first, paginated, and bounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-activity-pages-"));
  try {
    const log = new ActivityLog({ rootDirectory: root, maxPageSize: 2 });
    for (let index = 1; index <= 5; index++) {
      await log.append(
        activity(`Event ${index}`, index),
        operation("project-a", `request-${index}`),
      );
    }
    await log.append(activity("Other project", 6), operation("project-b", "request-b"));

    const first = await log.list({
      organizationId: "acme",
      projectId: "project-a",
      limit: 10_000,
    });
    assert.deepEqual(
      first.items.map((item) => item.summary),
      ["Event 5", "Event 4"],
    );
    assert.ok(first.nextCursor);

    const second = await log.list({
      organizationId: "acme",
      projectId: "project-a",
      cursor: first.nextCursor,
      limit: 2,
    });
    assert.deepEqual(
      second.items.map((item) => item.summary),
      ["Event 3", "Event 2"],
    );
    assert.ok(second.nextCursor);

    const third = await log.list({
      organizationId: "acme",
      projectId: "project-a",
      cursor: second.nextCursor,
      limit: 2,
    });
    assert.deepEqual(
      third.items.map((item) => item.summary),
      ["Event 1"],
    );
    assert.equal(third.nextCursor, undefined);
    assert.deepEqual(
      (await log.list({ organizationId: "acme", projectId: "project-b" })).items.map(
        (item) => item.summary,
      ),
      ["Other project"],
    );
    await assert.rejects(
      log.list({ organizationId: "acme", projectId: "project-a", cursor: "not-a-cursor" }),
      ActivityCursorError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Malformed and partial JSONL records do not hide valid Activity history", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-activity-malformed-"));
  try {
    const log = new ActivityLog({ rootDirectory: root });
    await log.append(activity("Still readable", 1), operation("project-a", "request-a"));
    const directory = join(root, "activity");
    const [file] = await readdir(directory);
    assert.ok(file);
    await appendFile(
      join(directory, file),
      '{"schemaVersion":2,"summary":"invalid record"}\n{"schemaVersion":1,"activityId":',
      "utf8",
    );

    const restarted = new ActivityLog({ rootDirectory: root });
    const page = await restarted.list({ organizationId: "acme", projectId: "project-a" });
    assert.deepEqual(
      page.items.map((item) => item.summary),
      ["Still readable"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

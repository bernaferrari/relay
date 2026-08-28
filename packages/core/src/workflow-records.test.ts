import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resetControlDatabaseCache } from "./collaboration-db.js";
import {
  createDurableWorkflow,
  parseLegacyWorkflowAdoption,
  readDurableWorkflow,
  transitionDurableWorkflow,
} from "./workflow-records.js";

async function withStateRoot(operation: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-workflow-record-"));
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

const scope = { organizationId: "acme", projectId: "mobile" };

test("server-owned workflow state survives restart with append-only audit", async () => {
  await withStateRoot(async () => {
    const created = await createDurableWorkflow({
      ...scope,
      workflowId: "workflow-1",
      kind: "run-test",
      frozenIdentity: { appMapId: "map", revision: 7, testId: "settings" },
      resource: { kind: "job", id: "job-1" },
      actorId: "agent:author",
      at: 100,
      expiresAt: 10_000,
    });
    assert.equal(created.status, "created");
    assert.equal(created.workflow.record.version, 1);

    const advanced = await transitionDurableWorkflow({
      ...scope,
      workflowId: "workflow-1",
      expectedVersion: 1,
      actorId: "human:reviewer",
      transition: "review-required",
      status: "needs-attention",
      at: 200,
    });
    assert.equal(advanced.status, "updated");
    assert.equal(advanced.workflow.record.version, 2);

    resetControlDatabaseCache();
    const restored = await readDurableWorkflow({ ...scope, workflowId: "workflow-1" });
    assert.equal(restored?.record.status, "needs-attention");
    assert.deepEqual(
      restored?.audit.map((event) => [event.sequence, event.actorId, event.transition]),
      [
        [1, "agent:author", "created"],
        [2, "human:reviewer", "review-required"],
      ],
    );
  });
});

test("project scope is authoritative and workflow ids are not credentials", async () => {
  await withStateRoot(async () => {
    await createDurableWorkflow({
      ...scope,
      workflowId: "scoped",
      kind: "author-test",
      frozenIdentity: { sessionId: "session-1" },
      actorId: "agent:author",
      at: 100,
      expiresAt: 10_000,
    });
    assert.equal(
      await readDurableWorkflow({
        organizationId: "acme",
        projectId: "other",
        workflowId: "scoped",
      }),
      undefined,
    );
    assert.deepEqual(
      await transitionDurableWorkflow({
        organizationId: "acme",
        projectId: "other",
        workflowId: "scoped",
        expectedVersion: 1,
        actorId: "agent:other",
        transition: "continue",
        status: "active",
        at: 200,
      }),
      { status: "missing" },
    );
  });
});

test("optimistic versions serialize clients and terminal state cannot advance", async () => {
  await withStateRoot(async () => {
    await createDurableWorkflow({
      ...scope,
      workflowId: "cas",
      kind: "repeat-test",
      frozenIdentity: { campaignId: "campaign-1", tuples: [["en"], ["pt"]] },
      actorId: "agent:author",
      at: 100,
      expiresAt: 10_000,
    });
    const completed = await transitionDurableWorkflow({
      ...scope,
      workflowId: "cas",
      expectedVersion: 1,
      actorId: "agent:author",
      transition: "completed",
      status: "terminal",
      resource: { kind: "campaign", id: "campaign-1" },
      at: 200,
    });
    assert.equal(completed.status, "updated");

    const stale = await transitionDurableWorkflow({
      ...scope,
      workflowId: "cas",
      expectedVersion: 1,
      actorId: "agent:other",
      transition: "continue",
      status: "active",
      at: 201,
    });
    assert.equal(stale.status, "terminal");
    assert.equal(stale.current.audit.length, 2);
  });
});

test("expired active workflows persist an explicit terminal audit boundary", async () => {
  await withStateRoot(async () => {
    await createDurableWorkflow({
      ...scope,
      workflowId: "expires",
      kind: "run-test",
      frozenIdentity: { run: "pending" },
      actorId: "agent:author",
      at: 100,
      expiresAt: 200,
    });
    const expired = await transitionDurableWorkflow({
      ...scope,
      workflowId: "expires",
      expectedVersion: 1,
      actorId: "system:expiry",
      transition: "continue",
      status: "active",
      at: 200,
    });
    assert.equal(expired.status, "expired");
    assert.equal(expired.current.record.status, "expired");
    assert.equal(expired.current.record.version, 2);
    assert.equal(expired.current.audit.at(-1)?.transition, "expired");
  });
});

test("legacy references are represented only by a digest and frozen JSON is bounded", async () => {
  await withStateRoot(async () => {
    const created = await createDurableWorkflow({
      ...scope,
      workflowId: "adopted",
      kind: "author-test",
      frozenIdentity: { sessionId: "session-1" },
      adoptedLegacyRefDigest: "sha256:abc123",
      actorId: "agent:author",
      at: 100,
      expiresAt: 10_000,
    });
    assert.notEqual(created.status, "conflict");
    if (created.status === "conflict") return;
    assert.equal(created.workflow.record.adoptedLegacyRefDigest, "sha256:abc123");
    assert.equal(JSON.stringify(created.workflow).includes("relay-workflow.v1"), false);

    await assert.rejects(
      createDurableWorkflow({
        ...scope,
        kind: "run-test",
        frozenIdentity: { huge: "x".repeat(70 * 1024) },
        actorId: "agent:author",
        at: 100,
        expiresAt: 10_000,
      }),
      /size limit/u,
    );
  });
});

test("request-id reuse is idempotent only for the same frozen workflow identity", async () => {
  await withStateRoot(async () => {
    const input = {
      ...scope,
      workflowId: "request-1",
      kind: "run-test" as const,
      frozenIdentity: { appMapId: "map", testId: "smoke" },
      actorId: "agent:first",
      at: 100,
      expiresAt: 10_000,
    };
    assert.equal((await createDurableWorkflow(input)).status, "created");
    assert.equal(
      (await createDurableWorkflow({ ...input, actorId: "agent:second", at: 101 })).status,
      "exists",
    );
    const attached = await transitionDurableWorkflow({
      ...scope,
      workflowId: "request-1",
      expectedVersion: 1,
      actorId: "agent:first",
      transition: "run-attached",
      status: "active",
      resource: { kind: "job", id: "job-1" },
      frozenIdentity: { ...input.frozenIdentity, rootRecipeId: "root" },
      at: 102,
    });
    assert.equal(attached.status, "updated");
    const replayAfterAttach = await createDurableWorkflow({
      ...input,
      actorId: "agent:second",
      at: 103,
    });
    assert.equal(replayAfterAttach.status, "exists");
    assert.equal(
      replayAfterAttach.status === "exists" ? replayAfterAttach.workflow.record.version : 0,
      2,
    );
    const conflict = await createDurableWorkflow({
      ...input,
      frozenIdentity: { appMapId: "map", testId: "different" },
      at: 104,
    });
    assert.equal(conflict.status, "conflict");
  });
});

test("legacy v1 adoption parses bounded identity and retains only its digest", () => {
  const raw = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      kind: "run-test",
      jobId: "job-legacy",
      frozen: { appMapId: "settings", appMapRevision: 7, testId: "smoke" },
    }),
    "utf8",
  ).toString("base64url");
  const legacyRef = `relay-workflow.v1.${raw}`;
  const adoption = parseLegacyWorkflowAdoption(legacyRef);
  assert.equal(adoption?.kind, "run-test");
  assert.deepEqual(adoption?.resource, { kind: "job", id: "job-legacy" });
  assert.match(adoption?.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(adoption).includes(legacyRef), false);
  assert.equal(parseLegacyWorkflowAdoption(`${legacyRef}x`.repeat(10_000)), undefined);
});

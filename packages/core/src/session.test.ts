import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JobRegistry } from "./job-registry.js";
import { leaseDevice } from "./collaboration.js";
import { runWithOperationContext } from "./operation-context.js";
import { enqueueJob, waitForJobCompletion } from "./session.js";

type RegistryJob = {
  id: string;
  status: "queued" | "running" | "paused" | "ok" | "error" | "healed" | "cancelled";
  persisted?: boolean;
};

for (const count of [101, 200, 500]) {
  test(`retains all ${count} queued jobs until they become terminal`, () => {
    const registry = new JobRegistry<RegistryJob>(100);
    const jobs = Array.from(
      { length: count },
      (_, index): RegistryJob => ({
        id: `job-${index}`,
        status: "queued",
      }),
    );
    for (const job of jobs) registry.remember(job);

    assert.equal(registry.size, count);
    assert.equal(registry.list(count).length, count);
    assert.ok(jobs.every((job) => registry.get(job.id) === job));

    const cancellable = registry.get("job-0");
    assert.ok(cancellable);
    cancellable.status = "cancelled";
    registry.pruneTerminalHistory();
    assert.equal(registry.get(cancellable.id), cancellable, "unpersisted cancellation is retained");

    for (const job of jobs) {
      job.status = "cancelled";
      job.persisted = true;
      registry.pruneTerminalHistory();
    }
    assert.equal(registry.size, Math.min(count, 100));
    assert.ok(registry.get(jobs.at(-1)!.id), "newest terminal job remains in history");
    if (count > 100) assert.equal(registry.get(jobs[0]!.id), undefined);
  });
}

test("bounds persisted terminal history without evicting active work", () => {
  const registry = new JobRegistry<RegistryJob>(100);
  const running: RegistryJob = { id: "running", status: "running" };
  registry.remember(running);
  for (let index = 0; index < 500; index += 1) {
    registry.remember({ id: `terminal-${index}`, status: "ok", persisted: true });
  }

  assert.equal(registry.size, 101, "the active job sits outside the terminal history bound");
  assert.equal(registry.get(running.id), running);
  assert.equal(registry.get("terminal-0"), undefined);
  assert.ok(registry.get("terminal-499"));
});

test("retains terminal jobs until persistence succeeds", () => {
  const registry = new JobRegistry<RegistryJob>(2);
  const failedWrite: RegistryJob = { id: "failed-write", status: "error" };
  registry.remember(failedWrite);
  registry.remember({ id: "durable-1", status: "ok", persisted: true });
  registry.remember({ id: "durable-2", status: "ok", persisted: true });

  assert.equal(registry.get(failedWrite.id), failedWrite);
  assert.equal(registry.size, 2);
  failedWrite.persisted = true;
  registry.remember({ id: "durable-3", status: "ok", persisted: true });
  assert.equal(registry.size, 2);
  assert.equal(registry.get(failedWrite.id), undefined);
});

test("an expired frozen lease fails before device execution starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-session-lease-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  try {
    const jobs = [];
    for (let index = 0; index < 20; index += 1) {
      const serial = `unreachable-device-${index}`;
      const lease = await leaseDevice({
        projectId: "project-a",
        poolId: "local",
        deviceSerial: serial,
        ownerId: "agent:runner",
        expiresAt: Date.now() - 1,
      });
      jobs.push(
        runWithOperationContext(
          {
            schemaVersion: 1,
            actorId: "agent:runner",
            actorKind: "agent",
            organizationId: "org-a",
            projectId: "project-a",
            operationId: "job.start",
            requestId: crypto.randomUUID(),
            idempotencyKey: crypto.randomUUID(),
            issuedAt: Date.now(),
            leaseId: lease.id,
          },
          () =>
            enqueueJob({
              recipe: "lease-preflight",
              serial,
              platform: "android",
              projectId: "project-a",
              ownerId: "agent:runner",
              recipeSnapshot: {
                id: "lease-preflight",
                title: "Lease preflight",
                source: "builtin",
                steps: [],
                createdAt: 1,
                updatedAt: 1,
              },
              recipeGraph: {},
            }),
        ),
      );
    }

    const completed = await Promise.all(jobs.map((job) => waitForJobCompletion(job.id)));
    for (const terminal of completed) {
      assert.equal(terminal.status, "error");
      assert.equal(terminal.error, "Job control lease is no longer valid");
      assert.equal(terminal.persisted, true, "completion includes durable run persistence");
      assert.equal(
        terminal.logs.some((line) => line.includes("device missing")),
        false,
        "device discovery never became the failure path",
      );
    }
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

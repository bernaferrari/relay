import assert from "node:assert/strict";
import test from "node:test";
import {
  reserveTargetControl,
  runTargetMutation,
  TargetControlReservedError,
} from "./target-control.js";
import { runWithOperationContext, setOperationIntervention } from "./operation-context.js";

test("target mutations serialize per target but not across targets", async () => {
  const order: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const first = runTargetMutation("ipad", null, async () => {
    order.push("first:start");
    await held;
    order.push("first:end");
  });
  const second = runTargetMutation("ipad", null, async () => order.push("second"));
  await runTargetMutation("pixel", null, async () => order.push("other"));
  assert.deepEqual(order, ["first:start", "other"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "other", "first:end", "second"]);
});

test("an automated run reservation rejects manual interleaving", async () => {
  const release = reserveTargetControl("ipad", "job-1");
  try {
    await assert.rejects(
      runTargetMutation("ipad", null, async () => undefined),
      TargetControlReservedError,
    );
    await runTargetMutation("ipad", "job-1", async () => undefined);
  } finally {
    release();
  }
  await runTargetMutation("ipad", null, async () => undefined);
});

test("an explicitly attributed intervention may enter only its reserved job lane", async () => {
  const release = reserveTargetControl("ipad", "job-1");
  const releaseOther = reserveTargetControl("other-target", "job-2");
  try {
    await runWithOperationContext(
      {
        schemaVersion: 1,
        organizationId: "org",
        projectId: "project",
        actorId: "agent:runner",
        actorKind: "agent",
        operationId: "target.interact",
        requestId: "request-1",
        idempotencyKey: "request-1",
        issuedAt: Date.now(),
      },
      async () => {
        setOperationIntervention("job-1", 1);
        await runTargetMutation("ipad", null, async () => undefined);
        await assert.rejects(
          runTargetMutation("other-target", null, async () => undefined),
          TargetControlReservedError,
        );
      },
    );
  } finally {
    release();
    releaseOther();
  }
});

test("queued jobs share occupancy so the next run still owns the target", async () => {
  const first = reserveTargetControl("ipad", "job-1");
  const second = reserveTargetControl("ipad", "job-2");
  try {
    await assert.rejects(
      runTargetMutation("ipad", null, async () => undefined),
      TargetControlReservedError,
    );
    await runTargetMutation("ipad", "job-1", async () => undefined);
    await runTargetMutation("ipad", "job-2", async () => undefined);
  } finally {
    first();
    second();
  }
});

test("a composite mutation can call target-aware device helpers without deadlocking", async () => {
  const order: string[] = [];
  await runTargetMutation("ipad", null, async () => {
    order.push("outer");
    await runTargetMutation("ipad", null, async () => order.push("inner"));
  });
  assert.deepEqual(order, ["outer", "inner"]);
});

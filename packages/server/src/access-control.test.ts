import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  currentOperationContext,
  leaseDevice,
  runWithOperationContext,
  type TestJob,
} from "@relay/core";
import {
  assertTargetControl,
  humanInterventionControlGrant,
  localControlSessionOwner,
} from "./access-control.js";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";

const scope: RequestContext = {
  subject: "local-user",
  organizationId: "relay",
  projectId: "control-help",
  allowedProjects: ["control-help"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

function asActor<T>(actorId: string, operation: () => Promise<T>): Promise<T> {
  return runWithOperationContext(
    {
      schemaVersion: 1,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      actorId,
      actorKind: actorId.startsWith("agent:") ? "agent" : "human",
      operationId: "target.interact",
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      issuedAt: Date.now(),
    },
    operation,
  );
}

test("target control failures provide safe, machine-actionable lease recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-control-help-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    const remoteScope = { ...scope, localTrusted: false, tokenKind: "service" as const };
    await assert.rejects(
      asActor("agent:mapper", () => assertTargetControl(remoteScope, "ipad-1")),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 403);
        assert.equal(error.body?.code, "TARGET_CONTROL_LEASE_REQUIRED");
        assert.deepEqual(error.body?.recoveryAction, {
          operationId: "lease.create",
          input: { poolId: "local", deviceSerial: "ipad-1" },
          cli: {
            argv: ["lease", "create", "ipad-1", "--actor", "agent:mapper"],
          },
        });
        return true;
      },
    );

    const minted = await asActor("agent:local", () => assertTargetControl(scope, "ipad-1"));
    assert.equal(minted.ownerId, localControlSessionOwner(scope));
    assert.equal(minted.controlScope, "local-project");
    assert.equal(minted.deviceSerial, "ipad-1");
    const joined = await asActor("human:second-window", () => assertTargetControl(scope, "ipad-1"));
    assert.equal(joined.id, minted.id);
    await asActor("agent:attributed", async () => {
      const shared = await assertTargetControl(scope, "ipad-1");
      assert.equal(currentOperationContext()?.actorId, "agent:attributed");
      assert.equal(currentOperationContext()?.leaseOwnerId, shared.ownerId);
    });

    await assert.rejects(
      asActor("configured-service", () => assertTargetControl(remoteScope, "ipad-1")),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.body?.code, "TARGET_CONTROL_LEASE_CONFLICT");
        return true;
      },
    );

    const lease = await leaseDevice({
      projectId: scope.projectId,
      poolId: "local",
      deviceSerial: "ipad-2",
      ownerId: "human:owner",
      expiresAt: Date.now() + 60_000,
    });
    await assert.rejects(
      asActor("agent:mapper", () => assertTargetControl(scope, "ipad-2")),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.body?.code, "TARGET_CONTROL_LEASE_CONFLICT");
        assert.deepEqual(error.body?.activeLease, {
          id: lease.id,
          ownerId: "human:owner",
          expiresAt: lease.expiresAt,
        });
        assert.deepEqual(error.body?.recoveryAction, {
          operationId: "lease.takeover",
          input: { leaseId: lease.id },
        });
        return true;
      },
    );

    assert.equal(
      (await asActor("human:owner", () => assertTargetControl(scope, "ipad-2"))).id,
      lease.id,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("server grants only repair commands from the paused run's exact actor", () => {
  const owner = {
    id: "paused-job",
    projectId: scope.projectId,
    status: "paused",
    operationContext: {
      schemaVersion: 1,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      actorId: "agent:runner",
      actorKind: "agent",
      operationId: "job.start",
      requestId: "run-request",
      idempotencyKey: "run-request",
      issuedAt: 1,
    },
    waitingFor: {
      kind: "human",
      message: "Repair the target",
      reason: "review",
      resumeLabel: "Resume",
      since: 10,
    },
    artifacts: [{ kind: "human-intervention-requested", capturedAt: 9, data: {} }],
  } as TestJob;
  const exactActor = {
    ...owner.operationContext!,
    operationId: "target.interact",
    requestId: "repair-request",
  };
  assert.deepEqual(humanInterventionControlGrant(owner, exactActor), {
    requestCapturedAt: 9,
  });
  assert.equal(
    humanInterventionControlGrant(owner, { ...exactActor, actorId: "human:other" }),
    undefined,
  );
  assert.equal(
    humanInterventionControlGrant(owner, { ...exactActor, operationId: "job.matrix.start" }),
    undefined,
  );
});

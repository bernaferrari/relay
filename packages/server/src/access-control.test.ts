import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { leaseDevice, runWithOperationContext } from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";

const scope: RequestContext = {
  subject: "local-user",
  organizationId: "relay",
  projectId: "control-help",
  allowedProjects: ["control-help"],
  tokenKind: "local",
  localTrusted: true,
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
    await assert.rejects(
      asActor("agent:mapper", () => assertTargetControl(scope, "ipad-1")),
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

    const lease = await leaseDevice({
      projectId: scope.projectId,
      poolId: "local",
      deviceSerial: "ipad-1",
      ownerId: "human:owner",
      expiresAt: Date.now() + 60_000,
    });
    await assert.rejects(
      asActor("agent:mapper", () => assertTargetControl(scope, "ipad-1")),
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
      (await asActor("human:owner", () => assertTargetControl(scope, "ipad-1"))).id,
      lease.id,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

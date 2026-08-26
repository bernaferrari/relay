import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireRelayStateServerLease,
  recoverAbandonedLocalRelayStateServerLease,
  RelayStateDirectoryInUseError,
  relayStateServerLeasePath,
} from "./relay-state-server-lease.js";

async function withRoot(operation: (root: string) => void): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-server-state-lease-"));
  try {
    operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a live Relay process exclusively owns its durable state directory", async () => {
  await withRoot((root) => {
    const path = relayStateServerLeasePath(root);
    const first = acquireRelayStateServerLease({ path, acquiredAt: 1_000 });
    try {
      assert.throws(
        () => acquireRelayStateServerLease({ path, acquiredAt: 1_001 }),
        (error: unknown) =>
          error instanceof RelayStateDirectoryInUseError &&
          error.code === "RELAY_STATE_DIRECTORY_IN_USE" &&
          error.reason === "active-local-process" &&
          error.owner.pid === process.pid,
      );
    } finally {
      first.release();
    }

    const next = acquireRelayStateServerLease({ path, acquiredAt: 1_002 });
    next.release();
  });
});

test("a dead same-host owner can be reclaimed but a foreign host is refused", async () => {
  await withRoot((root) => {
    const path = relayStateServerLeasePath(root);
    const stale = acquireRelayStateServerLease({
      path,
      pid: 999_999_999,
      host: hostname(),
      acquiredAt: 2_000,
    });
    const reclaimed = acquireRelayStateServerLease({ path, acquiredAt: 2_001 });
    reclaimed.release();
    stale.release();

    const remote = acquireRelayStateServerLease({
      path,
      pid: 12_345,
      host: "another-relay-host",
      acquiredAt: 2_002,
    });
    try {
      assert.throws(
        () => acquireRelayStateServerLease({ path, acquiredAt: 2_003 }),
        (error: unknown) =>
          error instanceof RelayStateDirectoryInUseError && error.reason === "foreign-host",
      );
    } finally {
      remote.release();
    }
  });
});

test("an aged dead lease from the previous local hostname is transactionally recovered", async () => {
  await withRoot((root) => {
    const path = relayStateServerLeasePath(join(root, ".relay"));
    const stale = acquireRelayStateServerLease({
      path,
      pid: 999_999_999,
      host: "Bernardos-MacBook-Pro-4.local",
      acquiredAt: 1_000,
    });

    const recovery = recoverAbandonedLocalRelayStateServerLease({
      path,
      workspaceRoot: root,
      currentHost: "Bernardos-MacBook-Pro-5.local",
      now: 1_000 + 60 * 60_000,
      minimumAgeMs: 5 * 60_000,
      localPortHasListener: false,
    });

    assert.equal(recovery.status, "recovered");
    if (recovery.status !== "recovered") return;
    assert.equal(recovery.previousOwner.leaseId, stale.owner.leaseId);
    assert.equal(recovery.reason, "local-hostname-collision-renamed");

    const next = acquireRelayStateServerLease({
      path,
      host: "Bernardos-MacBook-Pro-5.local",
      acquiredAt: recovery.recoveredAt + 1,
    });
    next.release();
    stale.release();
  });
});

test("local lease recovery refuses live, young, listening, unrelated, and shared owners", async () => {
  await withRoot((root) => {
    const path = relayStateServerLeasePath(join(root, ".relay"));
    const common = {
      path,
      workspaceRoot: root,
      currentHost: "relay-workstation-5.local",
      now: 1_000_000,
      minimumAgeMs: 300_000,
      localPortHasListener: false,
    };

    const live = acquireRelayStateServerLease({
      path,
      pid: process.pid,
      host: "relay-workstation-4.local",
      acquiredAt: 1,
    });
    assert.deepEqual(recoverAbandonedLocalRelayStateServerLease(common), {
      status: "refused",
      reason: "owner-process-alive",
      owner: live.owner,
    });
    live.release();

    const young = acquireRelayStateServerLease({
      path,
      pid: 999_999_999,
      host: "relay-workstation-4.local",
      acquiredAt: common.now - 1_000,
    });
    assert.equal(
      recoverAbandonedLocalRelayStateServerLease(common).reason,
      "lease-not-old-enough",
    );
    young.release();

    const listening = acquireRelayStateServerLease({
      path,
      pid: 999_999_999,
      host: "relay-workstation-4.local",
      acquiredAt: 1,
    });
    assert.equal(
      recoverAbandonedLocalRelayStateServerLease({
        ...common,
        localPortHasListener: true,
      }).reason,
      "local-port-listener-present",
    );
    listening.release();

    const unrelated = acquireRelayStateServerLease({
      path,
      pid: 999_999_999,
      host: "another-relay-host.local",
      acquiredAt: 1,
    });
    assert.equal(
      recoverAbandonedLocalRelayStateServerLease(common).reason,
      "foreign-host-not-local-rename",
    );
    unrelated.release();

    const sharedPath = relayStateServerLeasePath(join(root, "shared-state"));
    const shared = acquireRelayStateServerLease({
      path: sharedPath,
      pid: 999_999_999,
      host: "relay-workstation-4.local",
      acquiredAt: 1,
    });
    assert.equal(
      recoverAbandonedLocalRelayStateServerLease({ ...common, path: sharedPath }).reason,
      "state-not-workspace-local",
    );
    shared.release();
  });
});

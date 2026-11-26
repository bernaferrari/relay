import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  acquireRelayStateServerLease,
  recoverAbandonedLocalRelayStateServerLease,
  relayStateServerLeaseRecoveryAudit,
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
    mkdirSync(join(root, ".relay"), { recursive: true });
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
      workspaceFilesystem: "local",
    });

    assert.equal(recovery.status, "recovered");
    if (recovery.status !== "recovered") return;
    assert.equal(recovery.previousOwner.leaseId, stale.owner.leaseId);
    assert.equal(recovery.reason, "local-hostname-collision-renamed");
    assert.match(recovery.auditId, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(relayStateServerLeaseRecoveryAudit({ path }), [
      {
        auditId: recovery.auditId,
        previousOwner: stale.owner,
        recoveredAt: recovery.recoveredAt,
        recoveredByHost: "Bernardos-MacBook-Pro-5.local",
        reason: "local-hostname-collision-renamed",
      },
    ]);

    const next = acquireRelayStateServerLease({
      path,
      host: "Bernardos-MacBook-Pro-5.local",
      acquiredAt: recovery.recoveredAt + 1,
    });
    next.release();
    stale.release();
  });
});

test("an aged dead lease from a legacy IP host is transactionally recovered with distinct provenance", async () => {
  for (const legacyHost of ["192.168.1.20", "2001:db8::20"]) {
    await withRoot((root) => {
      const path = relayStateServerLeasePath(join(root, ".relay"));
      mkdirSync(join(root, ".relay"), { recursive: true });
      const stale = acquireRelayStateServerLease({
        path,
        pid: 999_999_999,
        host: legacyHost,
        acquiredAt: 1_000,
      });

      const recovery = recoverAbandonedLocalRelayStateServerLease({
        path,
        workspaceRoot: root,
        currentHost: "relay-workstation.local",
        now: 1_000 + 60 * 60_000,
        minimumAgeMs: 5 * 60_000,
        localPortHasListener: false,
        workspaceFilesystem: "local",
      });

      assert.equal(recovery.status, "recovered");
      if (recovery.status !== "recovered") return;
      assert.equal(recovery.reason, "legacy-ip-host-recovered");
      assert.equal(recovery.previousOwner.leaseId, stale.owner.leaseId);
      assert.deepEqual(relayStateServerLeaseRecoveryAudit({ path }), [
        {
          auditId: recovery.auditId,
          previousOwner: stale.owner,
          recoveredAt: recovery.recoveredAt,
          recoveredByHost: "relay-workstation.local",
          reason: "legacy-ip-host-recovered",
        },
      ]);
      stale.release();
    });
  }
});

test("legacy IP recovery preserves live-owner, listener, age, storage, and identity refusals", async () => {
  await withRoot((root) => {
    const path = relayStateServerLeasePath(join(root, ".relay"));
    const common = {
      path,
      workspaceRoot: root,
      currentHost: "relay-workstation.local",
      now: 1_000_000,
      minimumAgeMs: 300_000,
      localPortHasListener: false,
      workspaceFilesystem: "local" as const,
    };
    const attempt = (
      host: string,
      acquiredAt: number,
      overrides: Partial<Parameters<typeof recoverAbandonedLocalRelayStateServerLease>[0]> = {},
      pid = 999_999_999,
    ) => {
      const stale = acquireRelayStateServerLease({ path, pid, host, acquiredAt });
      const result = recoverAbandonedLocalRelayStateServerLease({ ...common, ...overrides });
      stale.release();
      return result;
    };

    assert.equal(attempt("192.168.1.20", 1, {}, process.pid).reason, "owner-process-alive");
    assert.equal(
      attempt("192.168.1.20", 1, { localPortHasListener: true }).reason,
      "local-port-listener-present",
    );
    assert.equal(
      attempt("192.168.1.20", 1, { localPortHasListener: undefined }).reason,
      "local-port-listener-unknown",
    );
    assert.equal(attempt("192.168.1.20", common.now - 1_000).reason, "lease-not-old-enough");
    for (const workspaceFilesystem of ["shared", "unknown"] as const) {
      assert.equal(
        attempt("192.168.1.20", 1, { workspaceFilesystem }).reason,
        "workspace-filesystem-not-local",
      );
    }
    assert.equal(attempt("192.168.1.999", 1).reason, "foreign-host-not-local-rename");
    assert.equal(
      attempt("192.168.1.20", 1, { currentHost: "192.168.1.21" }).reason,
      "foreign-host-not-local-rename",
    );
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
      workspaceFilesystem: "local" as const,
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
    assert.equal(recoverAbandonedLocalRelayStateServerLease(common).reason, "lease-not-old-enough");
    young.release();

    for (const acquiredAt of [common.now - 1_000, 1]) {
      const sameHostOnSharedStorage = acquireRelayStateServerLease({
        path,
        pid: 999_999_999,
        host: common.currentHost,
        acquiredAt,
      });
      for (const workspaceFilesystem of ["shared", "unknown"] as const) {
        assert.equal(
          recoverAbandonedLocalRelayStateServerLease({
            ...common,
            workspaceFilesystem,
          }).reason,
          "workspace-filesystem-not-local",
        );
      }
      sameHostOnSharedStorage.release();
    }

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

    const listeningOnSharedStorage = acquireRelayStateServerLease({
      path,
      pid: 999_999_999,
      host: "relay-workstation-4.local",
      acquiredAt: 1,
    });
    assert.equal(
      recoverAbandonedLocalRelayStateServerLease({
        ...common,
        localPortHasListener: true,
        workspaceFilesystem: "shared",
      }).reason,
      "workspace-filesystem-not-local",
    );
    listeningOnSharedStorage.release();

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

    const unknownPort = acquireRelayStateServerLease({
      path,
      pid: 999_999_999,
      host: "relay-workstation-4.local",
      acquiredAt: 1,
    });
    assert.equal(
      recoverAbandonedLocalRelayStateServerLease({
        ...common,
        localPortHasListener: undefined,
      }).reason,
      "local-port-listener-unknown",
    );
    unknownPort.release();

    const unknownFilesystem = acquireRelayStateServerLease({
      path,
      pid: 999_999_999,
      host: "relay-workstation-4.local",
      acquiredAt: 1,
    });
    for (const workspaceFilesystem of ["shared", "unknown"] as const) {
      assert.equal(
        recoverAbandonedLocalRelayStateServerLease({
          ...common,
          workspaceFilesystem,
        }).reason,
        "workspace-filesystem-not-local",
      );
    }
    unknownFilesystem.release();
  });
});

test("a v1 lease document and database migrate before hostname recovery", async () => {
  await withRoot((root) => {
    const path = relayStateServerLeasePath(join(root, ".relay"));
    mkdirSync(join(root, ".relay"), { recursive: true });
    const database = new DatabaseSync(path);
    try {
      database.exec(`
        PRAGMA user_version = 1;
        CREATE TABLE relay_server_state_leases (slot TEXT PRIMARY KEY, document TEXT NOT NULL);
      `);
      database.prepare("INSERT INTO relay_server_state_leases(slot, document) VALUES(?, ?)").run(
        "relay-server",
        JSON.stringify({
          schemaVersion: 1,
          leaseId: "v1-abandoned-lease",
          pid: 999_999_999,
          host: "relay-workstation-4.local",
          acquiredAt: 1,
        }),
      );
    } finally {
      database.close();
    }

    const recovery = recoverAbandonedLocalRelayStateServerLease({
      path,
      workspaceRoot: root,
      currentHost: "relay-workstation-5.local",
      now: 1_000_000,
      minimumAgeMs: 300_000,
      localPortHasListener: false,
      workspaceFilesystem: "local",
    });

    assert.equal(recovery.status, "recovered");
    assert.equal(relayStateServerLeaseRecoveryAudit({ path }).length, 1);
    const migrated = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(
        Number(
          (migrated.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
        ),
        2,
      );
    } finally {
      migrated.close();
    }
  });
});

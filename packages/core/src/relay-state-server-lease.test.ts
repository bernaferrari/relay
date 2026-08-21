import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireRelayStateServerLease,
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

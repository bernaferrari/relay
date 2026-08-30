import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLeaseRecoveryResult,
  prepareDefaultRelayStateDirectory,
  prepareLeaseForFreshServer,
  recoverWorkspaceLeaseBeforeServerStart,
  workspaceFilesystemObservation,
} from "./ensure-server-lease-recovery.mjs";

test("ensure:serve refuses custom Relay state roots before process control", () => {
  assert.deepEqual(prepareDefaultRelayStateDirectory({ configuredStateDirectory: undefined }), {
    allowed: true,
  });
  assert.deepEqual(prepareDefaultRelayStateDirectory({ configuredStateDirectory: "  " }), {
    allowed: true,
  });
  assert.deepEqual(
    prepareDefaultRelayStateDirectory({ configuredStateDirectory: "/shared/relay-state" }),
    { allowed: false, reason: "custom-relay-state-directory-unsupported" },
  );
});

test("ensure:serve refuses a live or plausibly shared lease before freePort", () => {
  let recoveryCalls = 0;
  const prepared = prepareLeaseForFreshServer({
    root: "/workspace/relay",
    tsx: "/workspace/relay/node_modules/tsx/dist/cli.mjs",
    portProbe: { known: true, pids: [] },
    currentHost: "relay-workstation-5.local",
    recover(input) {
      recoveryCalls += 1;
      assert.equal(input.portListenerObservation, "absent");
      return {
        status: "refused",
        reason: "foreign-host-not-local-rename",
        owner: { pid: 42, host: "shared-relay-host" },
      };
    },
  });
  assert.equal(recoveryCalls, 1);
  assert.equal(prepared.allowed, false);
  assert.equal(prepared.recovery.reason, "foreign-host-not-local-rename");
});

test("ensure:serve replaces its exact live local Relay, but not an arbitrary listener", () => {
  const localOwner = prepareLeaseForFreshServer({
    root: "/workspace/relay",
    tsx: "/workspace/relay/node_modules/tsx/dist/cli.mjs",
    portProbe: { known: true, pids: ["4242"] },
    currentHost: "relay-workstation-5.local",
    relayHealth: { ok: true, product: "relay", pid: 4242 },
    recover() {
      return {
        status: "refused",
        reason: "owner-process-alive",
        owner: { pid: 4242, host: "relay-workstation-5.local" },
      };
    },
  });
  assert.equal(localOwner.allowed, true);
  assert.equal(localOwner.mode, "replace-known-local-relay");

  const arbitrary = prepareLeaseForFreshServer({
    root: "/workspace/relay",
    tsx: "/workspace/relay/node_modules/tsx/dist/cli.mjs",
    portProbe: { known: true, pids: ["1777"] },
    currentHost: "relay-workstation-5.local",
    relayHealth: null,
    recover() {
      return { status: "refused", reason: "no-existing-lease" };
    },
  });
  assert.equal(arbitrary.allowed, false);
  assert.equal(arbitrary.mode, "refused");

  const sameHostLeaseWithoutRelayIdentity = prepareLeaseForFreshServer({
    root: "/workspace/relay",
    tsx: "/workspace/relay/node_modules/tsx/dist/cli.mjs",
    portProbe: { known: true, pids: ["4242"] },
    currentHost: "relay-workstation-5.local",
    relayHealth: null,
    recover() {
      return {
        status: "refused",
        reason: "owner-process-alive",
        owner: { pid: 4242, host: "relay-workstation-5.local" },
      };
    },
  });
  assert.equal(sameHostLeaseWithoutRelayIdentity.allowed, false);
  assert.equal(sameHostLeaseWithoutRelayIdentity.mode, "refused");

  const foreignLease = prepareLeaseForFreshServer({
    root: "/workspace/relay",
    tsx: "/workspace/relay/node_modules/tsx/dist/cli.mjs",
    portProbe: { known: true, pids: ["5555"] },
    currentHost: "relay-workstation-5.local",
    relayHealth: { ok: true, product: "relay", pid: 5555 },
    recover() {
      return {
        status: "refused",
        reason: "foreign-host-not-local-rename",
        owner: { pid: 42, host: "shared-relay-host" },
      };
    },
  });
  assert.equal(foreignLease.allowed, false);
});

test("ensure:serve only permits a recovered lease or a verified empty state", () => {
  const cases = [
    {
      recovery: { status: "recovered", reason: "local-hostname-collision-renamed" },
      allowed: true,
    },
    { recovery: { status: "refused", reason: "no-existing-lease" }, allowed: true },
    { recovery: { status: "refused", reason: "owner-process-alive" }, allowed: false },
    { recovery: { status: "refused", reason: "local-port-listener-present" }, allowed: false },
    { recovery: { status: "refused", reason: "local-port-listener-unknown" }, allowed: false },
  ];
  for (const item of cases) {
    const prepared = prepareLeaseForFreshServer({
      root: "/workspace/relay",
      tsx: "/workspace/relay/node_modules/tsx/dist/cli.mjs",
      portProbe: { known: false, pids: [] },
      currentHost: "relay-workstation-5.local",
      relayHealth: null,
      recover(input) {
        assert.equal(input.portListenerObservation, "unknown");
        return item.recovery;
      },
    });
    // An empty state needs a positive (not unknown) port observation.
    assert.equal(
      prepared.allowed,
      item.recovery.status === "recovered" ? item.allowed : false,
      item.recovery.reason,
    );
  }

  const verifiedEmpty = prepareLeaseForFreshServer({
    root: "/workspace/relay",
    tsx: "/workspace/relay/node_modules/tsx/dist/cli.mjs",
    portProbe: { known: true, pids: [] },
    currentHost: "relay-workstation-5.local",
    relayHealth: null,
    recover() {
      return { status: "refused", reason: "no-existing-lease" };
    },
  });
  assert.equal(verifiedEmpty.allowed, true);
  assert.equal(verifiedEmpty.mode, "empty-state");

  const deadLocal = prepareLeaseForFreshServer({
    root: "/workspace/relay",
    tsx: "/workspace/relay/node_modules/tsx/dist/cli.mjs",
    portProbe: { known: true, pids: [] },
    currentHost: "relay-workstation-5.local",
    relayHealth: null,
    recover() {
      return {
        status: "refused",
        reason: "lease-not-old-enough",
        owner: { pid: 999_999, host: "relay-workstation-5.local" },
      };
    },
  });
  assert.equal(deadLocal.allowed, true);
  assert.equal(deadLocal.mode, "reacquire-dead-local-lease");

  const oldDeadLocal = prepareLeaseForFreshServer({
    root: "/workspace/relay",
    tsx: "/workspace/relay/node_modules/tsx/dist/cli.mjs",
    portProbe: { known: true, pids: [] },
    currentHost: "relay-workstation-5.local",
    relayHealth: null,
    recover() {
      return {
        status: "refused",
        reason: "foreign-host-not-local-rename",
        owner: { pid: 999_999, host: "relay-workstation-5.local" },
      };
    },
  });
  assert.equal(oldDeadLocal.allowed, true);
  assert.equal(oldDeadLocal.mode, "reacquire-dead-local-lease");
});

test("the adapter invokes the core bootstrap helper and preserves its JSON result", () => {
  const calls = [];
  const result = recoverWorkspaceLeaseBeforeServerStart({
    root: "/workspace/relay",
    tsx: "/workspace/relay/node_modules/tsx/dist/cli.mjs",
    portListenerObservation: "absent",
    workspaceFilesystem: "local",
    minimumAgeMs: 123_000,
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: `${JSON.stringify({ status: "refused", reason: "no-existing-lease" })}\n`,
        stderr: "",
      };
    },
  });
  assert.deepEqual(result, { status: "refused", reason: "no-existing-lease" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args.slice(1), [
    "/workspace/relay/packages/core/src/relay-state-server-lease-bootstrap.ts",
    "--workspace-root",
    "/workspace/relay",
    "--local-port-listener",
    "absent",
    "--workspace-filesystem",
    "local",
    "--minimum-age-ms",
    "123000",
  ]);
});

test("the adapter validates the complete recovery discriminant", () => {
  const owner = {
    schemaVersion: 1,
    leaseId: "lease-1",
    pid: 42,
    host: "relay-workstation-4.local",
    acquiredAt: 1,
  };
  assert.deepEqual(
    parseLeaseRecoveryResult(
      `${JSON.stringify({
        status: "recovered",
        reason: "local-hostname-collision-renamed",
        previousOwner: owner,
        recoveredAt: 2,
        auditId: "audit-1",
      })}\n`,
    ),
    {
      status: "recovered",
      reason: "local-hostname-collision-renamed",
      previousOwner: owner,
      recoveredAt: 2,
      auditId: "audit-1",
    },
  );
  for (const malformed of [
    { status: "recovered" },
    { status: "recovered", reason: "no-existing-lease" },
    { status: "refused", reason: "owner-process-alive" },
    { status: "refused", reason: "invented", owner },
    { status: "refused", reason: "no-existing-lease", owner },
  ]) {
    assert.throws(() => parseLeaseRecoveryResult(`${JSON.stringify(malformed)}\n`), /invalid/u);
  }
  assert.throws(
    () => parseLeaseRecoveryResult('{"status":"refused","reason":"no-existing-lease"}\n{}\n'),
    /exactly one/u,
  );
});

test("filesystem observation only calls an explicit allowlist local", () => {
  const workspaceRoot = "/workspace/relay";
  assert.equal(
    workspaceFilesystemObservation({
      root: workspaceRoot,
      platform: "darwin",
      execFileSync: () => "/dev/disk3s5 on /workspace (apfs, local, journaled)\n",
      realpathSync: (path) => path,
    }),
    "local",
  );
  assert.equal(
    workspaceFilesystemObservation({
      root: workspaceRoot,
      platform: "darwin",
      execFileSync: () => "//server/share on /workspace (smbfs, nodev, nosuid)\n",
      realpathSync: (path) => path,
    }),
    "shared",
  );
  assert.equal(
    workspaceFilesystemObservation({
      root: workspaceRoot,
      platform: "darwin",
      execFileSync: () => "mystery on /workspace (mysteryfs, nodev)\n",
      realpathSync: (path) => path,
    }),
    "unknown",
  );
  assert.equal(
    workspaceFilesystemObservation({
      root: workspaceRoot,
      platform: "darwin",
      execFileSync: () =>
        "/dev/disk3s5 on /workspace (apfs, local, journaled)\n//server/share on /Volumes/share (smbfs, nodev)\n",
      realpathSync: (path) => (path.endsWith("/.relay") ? "/Volumes/share/relay" : path),
    }),
    "shared",
  );
});

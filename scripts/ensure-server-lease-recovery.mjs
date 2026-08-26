/**
 * Shell-to-core adapter for `ensure:serve`.
 *
 * The server lease's safety policy is intentionally not reproduced here. This
 * module only passes the port observation to the narrow core bootstrap helper
 * and makes the boot decision explicit/testable.
 */
import { execFileSync as nodeExecFileSync, spawnSync as nodeSpawnSync } from "node:child_process";
import { realpathSync as nodeRealpathSync } from "node:fs";
import { join } from "node:path";

const REFUSAL_REASONS = new Set([
  "owner-process-alive",
  "lease-not-old-enough",
  "local-port-listener-present",
  "local-port-listener-unknown",
  "foreign-host-not-local-rename",
  "workspace-filesystem-not-local",
  "state-not-workspace-local",
  "no-existing-lease",
]);
const OWNERLESS_REFUSALS = new Set(["state-not-workspace-local", "no-existing-lease"]);
const LOCAL_FILESYSTEMS = new Set([
  "apfs",
  "hfs",
  "hfs+",
  "btrfs",
  "ext2/ext3",
  "ext2/ext3/ext4",
  "ext4",
  "tmpfs",
  "ufs",
  "xfs",
  "zfs",
]);
const SHARED_FILESYSTEMS = new Set([
  "afpfs",
  "cifs",
  "davfs",
  "fuse.sshfs",
  "nfs",
  "nfs4",
  "smb2",
  "smb3",
  "smbfs",
]);

function exactKeys(value, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function validOwner(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!exactKeys(value, ["schemaVersion", "leaseId", "pid", "host", "acquiredAt"])) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.leaseId === "string" &&
    value.leaseId.trim().length > 0 &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.host === "string" &&
    value.host.trim().length > 0 &&
    typeof value.acquiredAt === "number" &&
    Number.isFinite(value.acquiredAt) &&
    value.acquiredAt >= 0
  );
}

export function parseLeaseRecoveryResult(stdout) {
  const lines = stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  if (lines.length !== 1)
    throw new Error("Relay lease recovery helper must produce exactly one result");
  let result;
  try {
    result = JSON.parse(lines[0]);
  } catch {
    throw new Error("Relay lease recovery helper produced invalid JSON");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Relay lease recovery helper produced an invalid result");
  }
  if (result.status === "recovered") {
    if (
      !exactKeys(result, ["status", "reason", "previousOwner", "recoveredAt", "auditId"]) ||
      result.reason !== "local-hostname-collision-renamed" ||
      !validOwner(result.previousOwner) ||
      typeof result.recoveredAt !== "number" ||
      !Number.isFinite(result.recoveredAt) ||
      result.recoveredAt < 0 ||
      typeof result.auditId !== "string" ||
      result.auditId.trim().length === 0
    ) {
      throw new Error("Relay lease recovery helper produced an invalid recovered result");
    }
    return result;
  }
  if (result.status === "refused") {
    if (
      !exactKeys(result, ["status", "reason"], ["owner"]) ||
      !REFUSAL_REASONS.has(result.reason) ||
      (OWNERLESS_REFUSALS.has(result.reason)
        ? result.owner !== undefined
        : !validOwner(result.owner))
    ) {
      throw new Error("Relay lease recovery helper produced an invalid refused result");
    }
    return result;
  }
  throw new Error("Relay lease recovery helper produced an invalid status");
}

export function workspaceFilesystemObservation({
  root,
  platform = process.platform,
  execFileSync = nodeExecFileSync,
  realpathSync = nodeRealpathSync,
}) {
  try {
    const paths = [realpathSync(root), realpathSync(join(root, ".relay"))];
    if (platform === "darwin") {
      const mounts = String(execFileSync("/sbin/mount", [], { encoding: "utf8" }));
      const candidates = mounts.split("\n").flatMap((line) => {
        const match = /^.+ on (.+) \(([^,]+)(?:, (.*))?\)$/u.exec(line.trim());
        if (!match) return [];
        const mountPoint = match[1].replaceAll("\\040", " ");
        return [
          { mountPoint, type: match[2].toLowerCase(), options: (match[3] ?? "").split(", ") },
        ];
      });
      const localities = paths.map((path) => {
        const mount = candidates
          .filter(
            (candidate) =>
              path === candidate.mountPoint ||
              path.startsWith(`${candidate.mountPoint === "/" ? "" : candidate.mountPoint}/`),
          )
          .sort((left, right) => right.mountPoint.length - left.mountPoint.length)[0];
        if (!mount) return "unknown";
        if (SHARED_FILESYSTEMS.has(mount.type)) return "shared";
        return mount.options.includes("local") ? "local" : "unknown";
      });
      if (localities.includes("shared")) return "shared";
      return localities.every((locality) => locality === "local") ? "local" : "unknown";
    }
    const types = paths.map((path) =>
      String(execFileSync("stat", ["-f", "-c", "%T", path], { encoding: "utf8" }))
        .trim()
        .toLowerCase(),
    );
    if (types.some((type) => SHARED_FILESYSTEMS.has(type))) return "shared";
    if (types.every((type) => LOCAL_FILESYSTEMS.has(type))) return "local";
  } catch {
    // Missing or failed filesystem probes are deliberately untrusted.
  }
  return "unknown";
}

/** Invoke core's policy exactly once before any process is stopped. */
export function recoverWorkspaceLeaseBeforeServerStart({
  root,
  tsx,
  portListenerObservation,
  workspaceFilesystem = workspaceFilesystemObservation({ root }),
  minimumAgeMs = 5 * 60_000,
  spawnSync = nodeSpawnSync,
}) {
  const result = spawnSync(
    process.execPath,
    [
      tsx,
      join(root, "packages/core/src/relay-state-server-lease-bootstrap.ts"),
      "--workspace-root",
      root,
      "--local-port-listener",
      portListenerObservation,
      "--workspace-filesystem",
      workspaceFilesystem,
      "--minimum-age-ms",
      String(minimumAgeMs),
    ],
    { cwd: root, encoding: "utf8", env: process.env },
  );
  if (result.error || result.status !== 0) {
    const detail = `${result.stderr ?? ""}`.trim() || result.error?.message || "unknown failure";
    throw new Error(`Relay lease recovery helper failed: ${detail}`);
  }
  return parseLeaseRecoveryResult(result.stdout ?? "");
}

/** The pre-kill decision used by ensure-server. Kept free of process control
 * so tests can prove a refusal cannot reach `freePort`. */
export function prepareLeaseForFreshServer({
  root,
  tsx,
  portProbe,
  currentHost,
  relayHealth,
  recover = recoverWorkspaceLeaseBeforeServerStart,
}) {
  const portListenerObservation = portProbe.known
    ? portProbe.pids.length > 0
      ? "present"
      : "absent"
    : "unknown";
  const recovery = recover({ root, tsx, portListenerObservation });
  const ownerPid = Number(recovery.owner?.pid);
  const healthIdentifiesObservedRelay =
    portProbe.known &&
    portProbe.pids.length > 0 &&
    relayHealth?.ok === true &&
    relayHealth?.product === "relay" &&
    Number.isSafeInteger(Number(relayHealth.pid)) &&
    portProbe.pids.includes(String(relayHealth.pid));
  const ownsObservedRelay =
    recovery.status === "refused" &&
    recovery.reason === "owner-process-alive" &&
    recovery.owner?.host === currentHost &&
    Number.isSafeInteger(ownerPid) &&
    ownerPid === Number(relayHealth?.pid) &&
    healthIdentifiesObservedRelay;
  const healthyRelayOnObservedPort =
    recovery.status === "refused" &&
    (recovery.reason === "no-existing-lease" ||
      (recovery.reason === "lease-not-old-enough" && recovery.owner?.host === currentHost)) &&
    healthIdentifiesObservedRelay;
  const emptyAndVerified =
    recovery.status === "refused" &&
    recovery.reason === "no-existing-lease" &&
    portProbe.known &&
    portProbe.pids.length === 0;
  // Core's normal acquisition safely reclaims a dead same-host lease. This is
  // not foreign-host recovery, so a minimum-age rule would only make a local
  // hot restart unavailable. It is still gated on a proven empty port.
  const sameHostDeadLeaseCanBeReacquired =
    recovery.status === "refused" &&
    recovery.reason === "lease-not-old-enough" &&
    recovery.owner?.host === currentHost &&
    portProbe.known &&
    portProbe.pids.length === 0;
  return {
    recovery,
    // Default ensure:serve deliberately replaces a known, local Relay. It
    // never treats an arbitrary listener or a merely matching PID as ours.
    allowed:
      recovery.status === "recovered" ||
      ownsObservedRelay ||
      emptyAndVerified ||
      sameHostDeadLeaseCanBeReacquired ||
      healthyRelayOnObservedPort,
    mode:
      recovery.status === "recovered"
        ? "recovered-abandoned-lease"
        : ownsObservedRelay || healthyRelayOnObservedPort
          ? "replace-known-local-relay"
          : sameHostDeadLeaseCanBeReacquired
            ? "reacquire-dead-local-lease"
            : emptyAndVerified
              ? "empty-state"
              : "refused",
  };
}

import { targetExecutionReadiness } from "@relay/core/target-execution-readiness";
import type { AuthoringTarget, DeviceLease, DeviceSummary, OperationOutput } from "@relay/protocol";
import type { RelayOperationPort } from "./operation-port.js";

type TargetCatalogEntry = {
  identity: string;
  device: DeviceSummary;
  target?: AuthoringTarget;
  blockedReason?: string;
};

function matchesTargetId(device: DeviceSummary, targetId: string): boolean {
  return device.id === targetId || device.serial === targetId;
}

export function findTargetCatalogEntry(
  catalog: readonly TargetCatalogEntry[],
  targetId: string,
): TargetCatalogEntry | undefined {
  const matches = catalog.filter(({ device }) => matchesTargetId(device, targetId));
  if (matches.length > 1) {
    throw new TypeError(`Target ${targetId} is ambiguous: choose a unique device id or serial.`);
  }
  return matches[0];
}

function runnableTarget(device: DeviceSummary): AuthoringTarget | undefined {
  if (device.platform !== "android" && device.platform !== "ios") return undefined;
  const readiness = targetExecutionReadiness(device);
  if (!readiness.runnable) return undefined;
  return { kind: "device", platform: device.platform, targetId: device.serial || device.id };
}

function browserPreflightProblem(
  targetId: string,
  preflight: {
    targetId: string;
    ok: boolean;
    checks: readonly { status: string; message: string }[];
  },
): string | undefined {
  if (preflight.targetId !== targetId) {
    throw new TypeError("Relay returned browser readiness for a different managed target.");
  }
  if (preflight.ok) return undefined;
  const failures = preflight.checks
    .filter((check) => check.status === "fail")
    .map((check) => check.message.trim())
    .filter(Boolean);
  return failures.length > 0
    ? `Managed browser target is not ready: ${failures.join("; ").slice(0, 480)}`
    : "Managed browser target is not ready. Run target preflight again before recording.";
}

export async function targetCatalog(
  operations: RelayOperationPort,
  scope: {
    targetKind?: AuthoringTarget["kind"];
    targetId?: string;
    phase?: "android" | "ios";
  } = {},
): Promise<TargetCatalogEntry[]> {
  const output = await operations.invoke("target.devices.list", {
    ...(scope.targetKind ? { targetKind: scope.targetKind } : {}),
    ...(scope.targetId ? { targetId: scope.targetId } : {}),
    ...(scope.phase ? { phase: scope.phase } : {}),
  });
  const devices = output.devices.filter((device) => {
    if (scope.targetId && !matchesTargetId(device, scope.targetId)) return false;
    if (scope.phase && device.platform !== scope.phase) return false;
    if (!scope.targetKind) return true;
    return scope.targetKind === "browser"
      ? device.platform === "browser"
      : device.platform === "android" || device.platform === "ios";
  });
  const catalog: TargetCatalogEntry[] = devices.map((device) => ({
    identity: device.serial || device.id,
    device,
    target: runnableTarget(device),
  }));

  const browserEntries = catalog.filter(({ device }) => device.platform === "browser");
  if (browserEntries.length === 0) return catalog;

  let registered: OperationOutput<"target.list">;
  try {
    registered = await operations.invoke("target.list", {});
  } catch {
    for (const entry of browserEntries) {
      entry.blockedReason =
        "Relay could not verify this managed browser target. Refresh targets, then try again.";
    }
    return catalog;
  }

  await Promise.all(
    browserEntries.map(async (entry) => {
      const matches = registered.targets.filter(
        (target) => target.id === entry.identity && target.kind === "browser" && target.browser,
      );
      if (matches.length !== 1) {
        entry.blockedReason =
          matches.length === 0
            ? "This browser is no longer a registered managed target. Refresh targets before recording."
            : "This browser target has an ambiguous managed configuration. Refresh targets before recording.";
        return;
      }
      try {
        const { preflight } = await operations.invoke("target.preflight", {
          targetId: entry.identity,
        });
        const problem = browserPreflightProblem(entry.identity, preflight);
        if (problem) {
          entry.blockedReason = problem;
          return;
        }
        entry.target = { kind: "browser", platform: "browser", targetId: entry.identity };
      } catch {
        entry.blockedReason =
          "Relay could not prove browser readiness. Run target preflight again before recording.";
      }
    }),
  );
  return catalog;
}

export async function selectTarget(
  operations: RelayOperationPort,
  targetId?: string,
  targetKind?: AuthoringTarget["kind"],
  phase?: "android" | "ios",
): Promise<AuthoringTarget> {
  const catalog = await targetCatalog(operations, { targetId, targetKind, phase });
  const available = catalog.flatMap(({ target }) => (target ? [target] : []));
  if (targetId) {
    const blocked = findTargetCatalogEntry(catalog, targetId);
    if (blocked?.target) return blocked.target;
    if (blocked) {
      if (blocked.blockedReason) {
        throw new TypeError(`Target ${targetId} is not ready: ${blocked.blockedReason}`);
      }
      const readiness = targetExecutionReadiness(blocked.device);
      if (!readiness.runnable) {
        throw new TypeError(`Target ${targetId} is not ready: ${readiness.recovery}`);
      }
    }
    throw new TypeError(
      `Target ${targetId} is not a connected Android, iOS, or managed browser target.`,
    );
  }
  if (available.length === 1) return available[0]!;
  throw new TypeError(
    available.length === 0
      ? "No connected Android, iOS, or managed browser target is ready."
      : `Target selection is ambiguous: ${available.length} devices are ready. Choose one by id.`,
  );
}

export async function selectAppMap(
  operations: RelayOperationPort,
  requestedId: string | undefined,
  createForRecordingTitle?: string,
): Promise<string> {
  if (requestedId?.trim()) {
    await operations.invoke("app-map.get", { appMapId: requestedId });
    return requestedId;
  }
  const { appMaps } = await operations.invoke("app-map.list", {});
  if (appMaps.length === 1) return appMaps[0]!.id;
  if (appMaps.length === 0 && createForRecordingTitle) {
    const { appMap } = await operations.invoke("app-map.create", {
      appMapId: "default",
      name: createForRecordingTitle,
    });
    return appMap.id;
  }
  throw new TypeError(
    appMaps.length === 0
      ? "No App Map exists. Record the first Test before running one."
      : `App Map selection is ambiguous: ${appMaps.length} maps exist. Choose one by id.`,
  );
}

function activeLeaseForTarget(
  leases: readonly DeviceLease[],
  targetId: string,
): DeviceLease | undefined {
  return leases.find((lease) => lease.deviceSerial === targetId && lease.status === "leased");
}

function leaseIsUsableByActor(lease: DeviceLease, actorId: string): boolean {
  // The trusted localhost server deliberately owns target control at the
  // project boundary so browser, desktop, CLI, and MCP can share one local
  // control session. Remote scopes still require the exact actor owner.
  return lease.ownerId === actorId || lease.controlScope === "local-project";
}

export async function acquireOwnLease(
  operations: RelayOperationPort,
  actorId: string,
  targetId: string,
): Promise<string> {
  const { leases } = await operations.invoke("lease.list", { status: "active" });
  const active = activeLeaseForTarget(leases, targetId);
  if (active) {
    if (!leaseIsUsableByActor(active, actorId)) {
      throw new TypeError(
        `${targetId} is controlled by ${active.ownerId}. Relay will not take over that lease implicitly.`,
      );
    }
    return active.id;
  }
  const { lease } = await operations.invoke("lease.create", {
    poolId: "local",
    deviceSerial: targetId,
  });
  if (
    !leaseIsUsableByActor(lease, actorId) ||
    lease.deviceSerial !== targetId ||
    lease.status !== "leased"
  ) {
    throw new TypeError("Relay could not prove ownership of the acquired target lease.");
  }
  return lease.id;
}

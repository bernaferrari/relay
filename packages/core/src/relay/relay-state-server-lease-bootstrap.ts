#!/usr/bin/env node
/**
 * Narrow bootstrap boundary for scripts/ensure-server.mjs.
 *
 * Shell code may collect a port observation, but lease policy stays in core.
 * This process emits exactly one JSON result on stdout so a boot script cannot
 * accidentally reinterpret an error as permission to steal state.
 */
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import {
  recoverAbandonedLocalRelayStateServerLease,
  relayStateServerLeasePath,
} from "./relay-state-server-lease.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name: string): string {
  const value = option(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function portListenerObservation(value: string | undefined): boolean | undefined {
  if (value === "present") return true;
  if (value === "absent") return false;
  if (value === "unknown") return undefined;
  throw new Error("--local-port-listener must be present, absent, or unknown");
}

function filesystemObservation(value: string | undefined): "local" | "shared" | "unknown" {
  if (value === "local" || value === "shared" || value === "unknown") return value;
  throw new Error("--workspace-filesystem must be local, shared, or unknown");
}

try {
  const workspaceRoot = resolve(requiredOption("--workspace-root"));
  const localPortHasListener = portListenerObservation(requiredOption("--local-port-listener"));
  const workspaceFilesystem = filesystemObservation(requiredOption("--workspace-filesystem"));
  const minimumAgeMs = Number(option("--minimum-age-ms") ?? 5 * 60_000);
  if (!Number.isSafeInteger(minimumAgeMs) || minimumAgeMs < 1) {
    throw new Error("--minimum-age-ms must be a positive integer");
  }
  const path = relayStateServerLeasePath(join(workspaceRoot, ".relay"));
  const result = recoverAbandonedLocalRelayStateServerLease({
    path,
    workspaceRoot,
    currentHost: hostname(),
    minimumAgeMs,
    localPortHasListener,
    workspaceFilesystem,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

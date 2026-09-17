import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GROK_LAB_ELECTRON_PARTITION_DIR } from "@relay/protocol";

/** Probe existing Chromium partition dirs only. Never mkdir persist:lane:grok-lab. */
export function defaultElectronPartitionRoots(): string[] {
  const home = homedir();
  return [
    join(home, "Library/Application Support/Electron/Partitions"),
    join(home, "Library/Application Support/Grok Bot/Partitions"),
  ];
}

export function probeElectronGrokLabPartitionPresent(roots?: readonly string[]): boolean {
  const dirs = roots ?? defaultElectronPartitionRoots();
  return dirs.some((root) => existsSync(join(root, GROK_LAB_ELECTRON_PARTITION_DIR)));
}

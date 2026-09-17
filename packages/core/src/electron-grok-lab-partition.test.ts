import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { existsSync } from "node:fs";
import { GROK_LAB_ELECTRON_PARTITION_DIR } from "@relay/protocol";
import { probeElectronGrokLabPartitionPresent } from "./electron-grok-lab-partition.js";

test("Electron grok-lab probe never invents persist:lane:grok-lab", async () => {
  const empty = join(tmpdir(), `relay-no-electron-lab-${Date.now()}`);
  assert.equal(probeElectronGrokLabPartitionPresent([empty]), false);
  assert.equal(existsSync(join(empty, GROK_LAB_ELECTRON_PARTITION_DIR)), false);

  const root = join(tmpdir(), `relay-electron-lab-${Date.now()}`);
  await mkdir(join(root, GROK_LAB_ELECTRON_PARTITION_DIR), { recursive: true });
  try {
    assert.equal(probeElectronGrokLabPartitionPresent([root]), true);
    assert.equal(probeElectronGrokLabPartitionPresent([empty, root]), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

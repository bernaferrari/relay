import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyAndroidSnapshotHelper } from "./verify-android-snapshot-helper.mjs";

test("the shipped helper can support SDK snapshot and press after a clean checkout", async () => {
  await verifyAndroidSnapshotHelper();
});

test("missing and corrupt helper artifacts fail the build gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-helper-artifact-"));
  try {
    const vendor = join(root, "vendor/agent-device");
    const dist = join(vendor, "android/snapshot-helper/dist");
    await mkdir(dist, { recursive: true });
    await writeFile(join(vendor, "package.json"), JSON.stringify({ version: "1.0.0" }));
    await assert.rejects(verifyAndroidSnapshotHelper(root), { code: "ENOENT" });
    await writeFile(
      join(dist, "agent-device-android-snapshot-helper-1.0.0.manifest.json"),
      JSON.stringify({
        version: "1.0.0",
        assetName: "agent-device-android-snapshot-helper-1.0.0.apk",
        sha256: "incorrect",
      }),
    );
    await writeFile(join(dist, "agent-device-android-snapshot-helper-1.0.0.apk"), "corrupt");
    await assert.rejects(verifyAndroidSnapshotHelper(root), /checksum/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

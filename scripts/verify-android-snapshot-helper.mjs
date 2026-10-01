import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** A source checkout must ship the native artifact required by SDK snapshot and press. */
export async function verifyAndroidSnapshotHelper(repositoryRoot = root) {
  const vendor = resolve(repositoryRoot, "vendor/agent-device");
  const { version } = JSON.parse(await readFile(resolve(vendor, "package.json"), "utf8"));
  const directory = resolve(vendor, "android/snapshot-helper/dist");
  const name = `agent-device-android-snapshot-helper-${version}`;
  const manifest = JSON.parse(await readFile(resolve(directory, `${name}.manifest.json`), "utf8"));
  if (manifest.version !== version || manifest.assetName !== `${name}.apk`) {
    throw new Error("Android snapshot helper does not match the bundled SDK version.");
  }
  const apk = await readFile(resolve(directory, manifest.assetName));
  if (createHash("sha256").update(apk).digest("hex") !== manifest.sha256) {
    throw new Error("Android snapshot helper checksum does not match its manifest.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyAndroidSnapshotHelper();
  console.log("Bundled Android snapshot helper version and checksum verified.");
}

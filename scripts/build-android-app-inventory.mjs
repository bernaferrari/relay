import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = join(root, "packages/core/android-helpers/app-inventory");
const version = "1.0.0";
const assetName = `relay-android-app-inventory-${version}.apk`;
const sourceFiles = [
  "AndroidManifest.xml",
  "src/dev/relay/appinventory/InstalledAppsInstrumentation.java",
];
const manifestPath = join(directory, `relay-android-app-inventory-${version}.manifest.json`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function sourceDigest() {
  const digest = createHash("sha256");
  for (const path of sourceFiles) {
    digest
      .update(path)
      .update("\0")
      .update(await readFile(join(directory, path)));
  }
  return digest.digest("hex");
}

export async function verifyAndroidAppInventory() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.assetName !== assetName ||
    manifest.version !== version ||
    manifest.versionName !== `${version}-${manifest.sourceSha256?.slice(0, 12)}` ||
    manifest.packageName !== "dev.relay.appinventory" ||
    manifest.sha256 !== sha256(await readFile(join(directory, assetName))) ||
    manifest.sourceSha256 !== (await sourceDigest())
  ) {
    throw new Error("Bundled Android app inventory does not match its source and checksum.");
  }
  return manifest;
}

export async function buildAndroidAppInventory() {
  const sourceSha256 = await sourceDigest();
  const versionName = `${version}-${sourceSha256.slice(0, 12)}`;
  const configuredRoots = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME]
    .map((path) => path?.trim())
    .filter(Boolean)
    .map((path) => resolve(path));
  if (new Set(configuredRoots).size > 1)
    throw new Error("Android SDK roots must point to one installation.");
  const sdk = configuredRoots[0] ?? join(homedir(), "Library/Android/sdk");
  const tools = join(sdk, "build-tools/36.1.0");
  const androidJar = join(sdk, "platforms/android-36/android.jar");
  const temporary = await mkdtemp(join(tmpdir(), "relay-app-inventory-"));
  try {
    const classes = join(temporary, "classes");
    const dex = join(temporary, "dex");
    await mkdir(classes);
    await mkdir(dex);
    await exec("javac", [
      "--release",
      "11",
      "-classpath",
      androidJar,
      "-d",
      classes,
      join(directory, sourceFiles[1]),
    ]);
    await exec(join(tools, "d8"), [
      "--min-api",
      "23",
      "--classpath",
      androidJar,
      "--output",
      dex,
      join(classes, "dev/relay/appinventory/InstalledAppsInstrumentation.class"),
    ]);
    const unsigned = join(temporary, "unsigned.apk");
    const aligned = join(temporary, "aligned.apk");
    await exec(join(tools, "aapt2"), [
      "link",
      "--manifest",
      join(directory, "AndroidManifest.xml"),
      "-I",
      androidJar,
      "--min-sdk-version",
      "23",
      "--target-sdk-version",
      "36",
      "--version-code",
      "1000000",
      "--version-name",
      versionName,
      "-o",
      unsigned,
    ]);
    await exec("zip", ["-q", "-j", unsigned, join(dex, "classes.dex")]);
    await exec(join(tools, "zipalign"), ["-f", "4", unsigned, aligned]);
    // This is the repository's public fixture certificate, never a release signing credential.
    await exec(join(tools, "apksigner"), [
      "sign",
      "--ks",
      join(root, "fixtures/android-proof-app/relay-proof-fixture.keystore"),
      "--ks-key-alias",
      "relay-proof-fixture",
      "--ks-pass",
      "pass:relayfixture",
      "--key-pass",
      "pass:relayfixture",
      "--v4-signing-enabled",
      "false",
      "--out",
      join(directory, assetName),
      aligned,
    ]);
    await exec(join(tools, "apksigner"), [
      "verify",
      "--min-sdk-version",
      "23",
      join(directory, assetName),
    ]);
    const manifest = {
      version,
      versionName,
      assetName,
      packageName: "dev.relay.appinventory",
      instrumentationRunner: "dev.relay.appinventory/.InstalledAppsInstrumentation",
      sha256: sha256(await readFile(join(directory, assetName))),
      sourceSha256,
      statusProtocol: "relay-android-app-inventory-v1",
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = process.argv.includes("--check")
    ? await verifyAndroidAppInventory()
    : await buildAndroidAppInventory();
  console.log(JSON.stringify(manifest));
}

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildToolsVersion = "36.1.0";
export const androidProofFixtureRoot = join(repositoryRoot, "fixtures/android-proof-app");
export const androidProofFixtureArtifact = join(
  androidProofFixtureRoot,
  "artifacts/relay-android-proof-fixture-1.0.apk",
);
export const androidProofFixtureManifest = join(
  androidProofFixtureRoot,
  "artifacts/relay-android-proof-fixture-1.0.manifest.json",
);

const sourceFiles = [
  "settings.gradle",
  "build.gradle",
  "relay-proof-fixture.keystore",
  "app/build.gradle",
  "app/src/main/AndroidManifest.xml",
  "app/src/main/java/dev/relay/prooffixture/MainActivity.java",
  "app/src/main/java/dev/relay/prooffixture/LanguageActivity.java",
  "app/src/main/java/dev/relay/prooffixture/ArabicActivity.java",
  "app/src/main/res/drawable/proof_button.xml",
  "app/src/main/res/drawable/proof_card.xml",
  "app/src/main/res/drawable/reset_button.xml",
  "app/src/main/res/layout/activity_main.xml",
  "app/src/main/res/layout/activity_language.xml",
  "app/src/main/res/layout/activity_arabic.xml",
  "app/src/main/res/values/colors.xml",
  "app/src/main/res/values/strings.xml",
  "app/src/main/res/values/styles.xml",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sourceIdentity() {
  const hash = createHash("sha256");
  for (const path of sourceFiles) {
    const bytes = await readFile(join(androidProofFixtureRoot, path));
    hash.update(`file\0${path}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function proofDigest(bytes) {
  return `sha256:${createHash("sha256").update("file\0").update(bytes).digest("hex")}`;
}

function androidSdkRoot() {
  return (
    process.env.ANDROID_HOME?.trim() ||
    process.env.ANDROID_SDK_ROOT?.trim() ||
    join(homedir(), "Library/Android/sdk")
  );
}

function buildTool(tool) {
  return join(androidSdkRoot(), "build-tools", buildToolsVersion, tool);
}

async function buildOnce() {
  const temporary = await mkdtemp(join(androidProofFixtureRoot, ".relay-build-"));
  try {
    await execFileAsync(
      "gradle",
      [
        "--no-daemon",
        "--console=plain",
        "-PrelayUnsigned=true",
        ":app:clean",
        ":app:assembleRelease",
      ],
      {
        cwd: androidProofFixtureRoot,
        env: { ...process.env, ANDROID_HOME: androidSdkRoot(), ANDROID_SDK_ROOT: androidSdkRoot() },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const unsigned = join(
      androidProofFixtureRoot,
      "app/build/outputs/apk/release/app-release-unsigned.apk",
    );
    const aligned = join(temporary, "aligned.apk");
    const signed = join(temporary, "signed.apk");
    await execFileAsync(buildTool("zipalign"), ["-f", "4", unsigned, aligned]);
    await execFileAsync(buildTool("apksigner"), [
      "sign",
      "--ks",
      join(androidProofFixtureRoot, "relay-proof-fixture.keystore"),
      "--ks-key-alias",
      "relay-proof-fixture",
      "--ks-pass",
      "pass:relayfixture",
      "--key-pass",
      "pass:relayfixture",
      "--v1-signing-enabled",
      "true",
      "--v2-signing-enabled",
      "true",
      "--v3-signing-enabled",
      "false",
      "--v4-signing-enabled",
      "false",
      "--out",
      signed,
      aligned,
    ]);
    await execFileAsync(buildTool("apksigner"), ["verify", "--verbose", signed]);
    const bytes = await readFile(signed);
    const { stdout } = await execFileAsync(buildTool("aapt2"), ["dump", "badging", signed], {
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!/^package: name='dev\.relay\.prooffixture'/mu.test(stdout)) {
      throw new Error("Built Android Proof fixture has an unexpected application ID");
    }
    if (!/^launchable-activity: name='dev\.relay\.prooffixture\.MainActivity'/mu.test(stdout)) {
      throw new Error("Built Android Proof fixture has no canonical launcher activity");
    }
    return bytes;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyTrackedAndroidProofFixture() {
  const manifest = JSON.parse(await readFile(androidProofFixtureManifest, "utf8"));
  const bytes = await readFile(androidProofFixtureArtifact);
  const expected = {
    schemaVersion: 1,
    applicationId: "dev.relay.prooffixture",
    launchActivity: "dev.relay.prooffixture.MainActivity",
    versionCode: 1,
    versionName: "1.0",
    sourceFiles,
    sourceDigest: await sourceIdentity(),
    sourceSha256: sha256(bytes),
    artifactDigest: proofDigest(bytes),
    reproducible: true,
  };
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
    throw new Error("Tracked Android Proof fixture manifest does not match its source and APK");
  }
  return expected;
}

export async function buildAndroidProofFixture({ verifyReproducible = false } = {}) {
  const first = await buildOnce();
  if (verifyReproducible) {
    const second = await buildOnce();
    if (sha256(first) !== sha256(second)) {
      throw new Error("Android Proof fixture build is not byte-for-byte reproducible");
    }
  }
  await mkdir(dirname(androidProofFixtureArtifact), { recursive: true });
  await writeFile(androidProofFixtureArtifact, first);
  const bytes = first;
  const manifest = {
    schemaVersion: 1,
    applicationId: "dev.relay.prooffixture",
    launchActivity: "dev.relay.prooffixture.MainActivity",
    versionCode: 1,
    versionName: "1.0",
    sourceFiles,
    sourceDigest: await sourceIdentity(),
    sourceSha256: sha256(bytes),
    artifactDigest: proofDigest(bytes),
    reproducible: verifyReproducible,
  };
  await writeFile(androidProofFixtureManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--check")) {
    const manifest = await verifyTrackedAndroidProofFixture();
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return;
  }
  const manifest = await buildAndroidProofFixture({
    verifyReproducible: args.has("--verify-reproducible"),
  });
  process.stdout.write(
    `${JSON.stringify({ ...manifest, artifact: relative(repositoryRoot, androidProofFixtureArtifact) })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

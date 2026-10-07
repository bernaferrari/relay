import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ANDROID_SNAPSHOT_HELPER_COMPONENT,
  ANDROID_SNAPSHOT_HELPER_PACKAGE,
  bundledAndroidSnapshotHelper,
  ensureAndroidSnapshotHelperInstalled,
  type AndroidSnapshotHelperBundle,
  type SnapshotHelperAdb,
} from "./android-snapshot-helper.js";

const apk = Buffer.from("a bounded test APK fixture");
const sha256 = createHash("sha256").update(apk).digest("hex");
const assetName = "agent-device-android-snapshot-helper-0.21.22.apk";
const manifest = {
  name: "android-snapshot-helper",
  version: "0.21.22",
  versionCode: 21022,
  assetName,
  sha256,
  packageName: ANDROID_SNAPSHOT_HELPER_PACKAGE,
  instrumentationRunner: ANDROID_SNAPSHOT_HELPER_COMPONENT,
  statusProtocol: "android-snapshot-helper-v1",
  outputFormat: "uiautomator-xml",
};
const helper: AndroidSnapshotHelperBundle = {
  apkPath: `/fixture/${assetName}`,
  version: manifest.version,
  versionCode: manifest.versionCode,
  sha256,
};

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "relay-helper-"));
  try {
    await writeFile(join(directory, assetName), apk);
    await writeFile(
      join(directory, assetName.replace(".apk", ".manifest.json")),
      JSON.stringify(manifest),
    );
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("snapshot helper selection requires one exact manifest and matching APK digest", async () => {
  await fixture(async (directory) => {
    assert.deepEqual(await bundledAndroidSnapshotHelper([directory]), {
      ...helper,
      apkPath: join(directory, assetName),
    });
    await writeFile(join(directory, assetName), "corrupt bytes");
    assert.equal(await bundledAndroidSnapshotHelper([directory]), undefined);
  });
  await fixture(async (directory) => {
    await writeFile(join(directory, "agent-device-android-snapshot-helper-0.21.6.apk"), apk);
    assert.equal(
      await bundledAndroidSnapshotHelper([directory]),
      undefined,
      "ambiguous versions cannot pick the first file",
    );
  });
  await fixture(async (directory) => {
    await writeFile(
      join(directory, assetName.replace(".apk", ".manifest.json")),
      JSON.stringify({ ...manifest, assetName: "../other.apk" }),
    );
    assert.equal(await bundledAndroidSnapshotHelper([directory]), undefined);
  });
});

test("current installed snapshot helper is observed without a new installation", async () => {
  const calls: string[][] = [];
  const execute: SnapshotHelperAdb = async (args) => {
    calls.push(args);
    return { stdout: "  versionCode=21022 minSdk=23\n  versionName=0.21.22\n" };
  };
  assert.equal(await ensureAndroidSnapshotHelperInstalled("phone", execute, helper), true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.includes("dumpsys"));
});

test("stale helper installs once and must prove the intended version afterwards", async () => {
  const calls: string[][] = [];
  let installed = false;
  const execute: SnapshotHelperAdb = async (args) => {
    calls.push(args);
    if (args.includes("install")) {
      installed = true;
      return { stdout: "Success" };
    }
    return {
      stdout: installed
        ? "versionCode=21022\nversionName=0.21.22\n"
        : "versionCode=21006\nversionName=0.21.6\n",
    };
  };
  assert.equal(await ensureAndroidSnapshotHelperInstalled("phone", execute, helper), true);
  assert.equal(calls.filter((args) => args.includes("install")).length, 1);
  assert.equal(calls.filter((args) => args.includes("dumpsys")).length, 2);
  assert.ok(
    calls.every((args) => !args.includes("uiautomator") && !args.includes("instrument")),
    "install verification never competes for UiAutomation",
  );
});

test("missing bundle, failed install, or stale postinstall version cannot be marked ready", async () => {
  let calls = 0;
  assert.equal(
    await ensureAndroidSnapshotHelperInstalled("phone", async () => {
      calls += 1;
      throw Error("must not run");
    }),
    false,
  );
  assert.equal(calls, 0);
  assert.equal(
    await ensureAndroidSnapshotHelperInstalled(
      "phone",
      async (args) => {
        if (args.includes("install")) throw Error("installation failed");
        return { stdout: "versionCode=21006\nversionName=0.21.6\n" };
      },
      helper,
    ),
    false,
  );
  assert.equal(
    await ensureAndroidSnapshotHelperInstalled(
      "phone",
      async () => ({ stdout: "versionCode=21006\nversionName=0.21.22\n" }),
      helper,
    ),
    false,
    "versionName alone is insufficient",
  );
});

test("concurrent snapshot requests share the same bounded installation", async () => {
  let installed = false,
    installs = 0;
  const execute: SnapshotHelperAdb = async (args) => {
    if (args.includes("install")) {
      installs += 1;
      await Promise.resolve();
      installed = true;
      return { stdout: "Success" };
    }
    return { stdout: installed ? "versionCode=21022\nversionName=0.21.22\n" : "" };
  };
  assert.deepEqual(
    await Promise.all([
      ensureAndroidSnapshotHelperInstalled("phone", execute, helper),
      ensureAndroidSnapshotHelperInstalled("phone", execute, helper),
    ]),
    [true, true],
  );
  assert.equal(installs, 1);
});

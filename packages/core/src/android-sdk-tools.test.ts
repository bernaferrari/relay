import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { join } from "node:path";
import {
  AndroidSdkToolError,
  AndroidSdkRootConfigurationError,
  resolveAndroidSdkTool,
  resolveAndroidSdkToolSync,
  resolveAndroidSdkTools,
} from "./android-sdk-tools.js";

async function executable(path: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "#!/bin/sh\nexit 0\n");
  await chmod(path, 0o755);
}

test("resolves every Android tool from one configured SDK and chooses newest build tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-sdk-tools-"));
  try {
    await executable(join(root, "platform-tools", "adb"));
    await executable(join(root, "emulator", "emulator"));
    await executable(join(root, "build-tools", "35.0.0", "aapt"));
    await executable(join(root, "build-tools", "36.1.0", "aapt"));
    await executable(join(root, "build-tools", "35.0.0", "aapt2"));
    await executable(join(root, "cmdline-tools", "latest", "bin", "apkanalyzer"));

    const resolved = await resolveAndroidSdkTools(undefined, {
      env: { ANDROID_SDK_ROOT: root, PATH: "/path/with/a/different/adb" },
      platform: "linux",
      homeDirectory: join(root, "unused-home"),
    });
    assert.equal(resolved.adb, join(root, "platform-tools", "adb"));
    assert.equal(resolved.emulator, join(root, "emulator", "emulator"));
    assert.equal(resolved.aapt, join(root, "build-tools", "36.1.0", "aapt"));
    assert.equal(resolved.aapt2, join(root, "build-tools", "35.0.0", "aapt2"));
    assert.equal(resolved.apkanalyzer, join(root, "cmdline-tools", "latest", "bin", "apkanalyzer"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses the macOS default SDK location when no SDK environment variable is set", async () => {
  const home = await mkdtemp(join(tmpdir(), "relay-sdk-macos-"));
  const root = join(home, "Library", "Android", "sdk");
  try {
    const adb = join(root, "platform-tools", "adb");
    await executable(adb);
    assert.equal(
      await resolveAndroidSdkTool("adb", { env: {}, platform: "darwin", homeDirectory: home }),
      adb,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("uses the Linux default SDK location when no SDK environment variable is set", async () => {
  const home = await mkdtemp(join(tmpdir(), "relay-sdk-linux-"));
  const root = join(home, "Android", "Sdk");
  try {
    const emulator = join(root, "emulator", "emulator");
    await executable(emulator);
    assert.equal(
      await resolveAndroidSdkTool("emulator", {
        env: {},
        platform: "linux",
        homeDirectory: home,
      }),
      emulator,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("fails closed with diagnostics instead of falling back to PATH", async () => {
  const home = await mkdtemp(join(tmpdir(), "relay-sdk-missing-"));
  try {
    await assert.rejects(
      () =>
        resolveAndroidSdkTool("adb", {
          env: { PATH: join(home, "path-bin") },
          platform: "linux",
          homeDirectory: home,
        }),
      (error: unknown) => {
        assert.ok(error instanceof AndroidSdkToolError);
        assert.equal(error.code, "tool-missing");
        assert.equal(error.tool, "adb");
        assert.match(error.message, /PATH is intentionally ignored/u);
        assert.equal(error.diagnostics.executableCandidates.length, 0);
        return true;
      },
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("fails closed before tool selection when SDK_ROOT and HOME disagree", async () => {
  const first = await mkdtemp(join(tmpdir(), "relay-sdk-first-"));
  const second = await mkdtemp(join(tmpdir(), "relay-sdk-second-"));
  try {
    await executable(join(first, "platform-tools", "adb"));
    await executable(join(second, "build-tools", "36.1.0", "aapt"));
    await assert.rejects(
      () =>
        resolveAndroidSdkTools(["adb", "aapt"], {
          env: { ANDROID_SDK_ROOT: first, ANDROID_HOME: second },
          platform: "darwin",
        }),
      (error: unknown) => {
        assert.ok(error instanceof AndroidSdkRootConfigurationError);
        assert.equal(error.code, "sdk-roots-ambiguous");
        assert.equal(error.roots.length, 2);
        assert.match(error.message, /ambiguous/u);
        return true;
      },
    );
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test("sync resolution uses the same audited path contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-sdk-sync-"));
  try {
    const adb = join(root, "platform-tools", "adb");
    await executable(adb);
    assert.equal(
      resolveAndroidSdkToolSync("adb", {
        env: { ANDROID_HOME: root },
        platform: "linux",
      }),
      adb,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

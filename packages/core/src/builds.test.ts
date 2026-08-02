import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  installRegisteredBuild,
  launchRegisteredBuild,
  preflightRegisteredBuild,
} from "./builds.js";

test("preflights, installs, and launches a registered Android artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-build-"));
  const artifact = join(root, "app.apk");
  await writeFile(artifact, "apk");
  const calls: Array<[string, string[]]> = [];
  const run = async (command: string, args: string[]) => {
    calls.push([command, args]);
    if (command === "apkanalyzer") return { stdout: "com.example.app\n" };
    return { stdout: "" };
  };
  const build = {
    id: "android",
    projectId: "project",
    name: "Android",
    platform: "android" as const,
    sourceUrl: artifact,
    status: "ready" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  const target = { kind: "device" as const, platform: "android" as const, serial: "pixel" };
  try {
    const preflight = await preflightRegisteredBuild(build, { target, run, at: 10 });
    assert.equal(preflight.ok, true);
    assert.equal(preflight.applicationId, "com.example.app");
    assert.deepEqual(preflight.capabilities, { install: true, launch: true });

    await installRegisteredBuild({ build, target, run });
    await launchRegisteredBuild({ build, target, run });
    assert.ok(calls.some(([command, args]) => command === "adb" && args.includes("install")));
    assert.ok(calls.some(([command, args]) => command === "adb" && args.includes("monkey")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("supports iOS simulator app bundles and rejects platform mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-build-ios-"));
  const artifact = join(root, "Relay.app");
  await mkdir(artifact);
  await writeFile(join(artifact, "Info.plist"), "plist");
  const build = {
    id: "ios",
    projectId: "project",
    name: "iOS",
    platform: "ios" as const,
    sourceUrl: artifact,
    status: "ready" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  try {
    const mismatch = await preflightRegisteredBuild(build, {
      target: { kind: "device", platform: "android", serial: "pixel" },
      run: async () => ({ stdout: "com.example.ios" }),
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.capabilities.install, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

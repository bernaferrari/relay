import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { listIosInstalledApps } from "./ios-installed-apps.js";
import type { CommandRunner } from "./ios-app-launch.js";

const app = (id: string, name: string, fields = {}) => ({
  CFBundleIdentifier: id,
  CFBundleDisplayName: name,
  CFBundlePackageType: "APPL",
  ...fields,
});
test("physical app inventory is one metadata read and hides system helpers", async () => {
  const calls: unknown[] = [];
  const run: CommandRunner = async (...args) => {
    calls.push(args);
    return {
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify([
        app("com.apple.MBHelperApp", "Settings", { SBAppTags: ["hidden"] }),
        app("com.apple.Preferences", "Settings"),
        app("com.apple.TestFlight", "TestFlight"),
        app("com.apple.BluetoothUIService", "BluetoothUIService", { ApplicationType: "Hidden" }),
        app("com.apple.business", "BusinessExtensionsWrapper", {
          LSApplicationLaunchProhibited: true,
        }),
        app("com.example.background", "Background helper", { SBLaunchSuspendedAlways: true }),
        app("com.example.widget", "Widget", { CFBundlePackageType: "XPC!" }),
      ]),
    };
  };
  assert.deepEqual(await listIosInstalledApps("ipad", { run, bin: "ios" }), [
    { package: "com.apple.Preferences", name: "Settings" },
    { package: "com.apple.TestFlight", name: "TestFlight" },
  ]);
  assert.deepEqual(calls, [["ios", ["apps", "--all", "--udid", "ipad"], 15_000]]);
});
test("inventory errors and malformed metadata do not become empty successes", async () => {
  for (const result of [
    { exitCode: 1, stdout: "[]", stderr: "locked" },
    { exitCode: 0, stdout: "not-json", stderr: "" },
    { exitCode: 0, stdout: '[{"name":"Missing id"}]', stderr: "" },
  ])
    await assert.rejects(listIosInstalledApps("ipad", { bin: "ios", run: async () => result }));
});
test("invalid serials are rejected before any device command", async () => {
  let calls = 0;
  for (const serial of ["", "--all", "some device", "ipad\0"])
    await assert.rejects(
      listIosInstalledApps(serial, {
        bin: "ios",
        run: async () => {
          calls++;
          throw new Error("unexpected command");
        },
      }),
    );
  assert.equal(calls, 0);
});
test("simulator inventory accepts JSON and converts OpenStep plist with cleanup", async () => {
  const apps = { "com.example.app": app("com.example.app", "Example") };
  const json = JSON.stringify(apps);
  let plistPath: string | undefined;
  let reads = 0;
  const run: CommandRunner = async (file, args) => {
    reads++;
    if (file === "xcrun") return { exitCode: 0, stdout: "{ legacy plist }", stderr: "" };
    assert.equal(file, "plutil");
    plistPath = args.at(-1);
    return { exitCode: 0, stdout: json, stderr: "" };
  };
  assert.deepEqual(await listIosInstalledApps("sim", { simulator: true, run }), [
    { package: "com.example.app", name: "Example" },
  ]);
  assert.equal(reads, 2);
  assert.ok(plistPath);
  await assert.rejects(access(plistPath));
  assert.deepEqual(
    await listIosInstalledApps("sim", {
      simulator: true,
      run: async () => ({ exitCode: 0, stdout: json, stderr: "" }),
    }),
    [{ package: "com.example.app", name: "Example" }],
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { listAndroidInstalledApps } from "./android-installed-apps.js";

const { versionName: helperVersionName } = JSON.parse(
  readFileSync(
    new URL(
      "../android-helpers/app-inventory/relay-android-app-inventory-1.0.0.manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function labelsOutput(labels: unknown): string {
  return [
    "INSTRUMENTATION_STATUS: relayProtocol=relay-android-app-inventory-v1",
    "INSTRUMENTATION_STATUS: outputFormat=application-labels-json",
    "INSTRUMENTATION_STATUS: chunkIndex=0",
    "INSTRUMENTATION_STATUS: chunkCount=1",
    `INSTRUMENTATION_STATUS: payloadBase64=${Buffer.from(JSON.stringify(labels)).toString("base64")}`,
    "INSTRUMENTATION_STATUS_CODE: 1",
    "INSTRUMENTATION_RESULT: relayProtocol=relay-android-app-inventory-v1",
    "INSTRUMENTATION_RESULT: outputFormat=application-labels-json",
    "INSTRUMENTATION_RESULT: ok=true",
    "INSTRUMENTATION_CODE: 0",
  ].join("\n");
}

test("app discovery scopes read-only package queries to the selected serial", async () => {
  const calls: string[][] = [];
  const apps = await listAndroidInstalledApps("emulator-5554", async (args) => {
    calls.push(args);
    if (args.includes("dumpsys")) throw new Error("optional helper unavailable");
    return {
      stdout: "com.android.settings/.Settings\ncom.example.notes/.MainActivity\n",
      stderr: "",
    };
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((args) => args[0] === "-s" && args[1] === "emulator-5554"));
  assert.deepEqual(calls[0]?.slice(0, 6), [
    "-s",
    "emulator-5554",
    "shell",
    "cmd",
    "package",
    "query-activities",
  ]);
  assert.deepEqual(
    apps.map((app) => app.package),
    ["com.android.settings", "com.example.notes"],
  );
  assert.ok(apps.every((app) => app.name.length));
});

test("observed PackageManager labels enrich canonical packages without adding helper entries", async () => {
  const calls: string[][] = [];
  const apps = await listAndroidInstalledApps("RQCY104BG8X", async (args, options) => {
    calls.push(args);
    assert.equal(args[1], "RQCY104BG8X");
    if (args.includes("query-activities"))
      return {
        stdout: "com.facebook.katana/.Main\ncom.example.notes/.Main\ncom.example.unknown/.Main\n",
        stderr: "",
      };
    if (args.includes("dumpsys"))
      return { stdout: `  versionName=${helperVersionName}\n`, stderr: "" };
    assert.ok(args.includes("instrument"));
    assert.equal(options?.timeout, 5_000);
    return {
      stdout: labelsOutput([
        { package: "com.facebook.katana", name: "Facebook" },
        { package: "com.example.notes", name: "Notas rápidas" },
        { package: "dev.relay.appinventory", name: "Relay App Inventory" },
      ]),
      stderr: "",
    };
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(apps, [
    { package: "com.example.notes", name: "Notas rápidas" },
    { package: "com.example.unknown", name: "Unknown" },
    { package: "com.facebook.katana", name: "Facebook" },
  ]);
  assert.ok(calls.every((args) => !args.includes("install")));
});

test("missing or stale metadata helper is installed once and cannot disrupt the snapshot helper", async () => {
  const calls: string[][] = [];
  const apps = await listAndroidInstalledApps("emulator-5554", async (args, options) => {
    calls.push(args);
    if (args.includes("query-activities"))
      return { stdout: "com.example.notes/.Main\n", stderr: "" };
    if (args.includes("dumpsys")) return { stdout: "versionName=outdated\n", stderr: "" };
    if (args.includes("install")) {
      assert.equal(options?.timeout, 15_000);
      assert.deepEqual(args.slice(0, 5), ["-s", "emulator-5554", "install", "-r", "-t"]);
      assert.match(args[5]!, /app-inventory.*\.apk$/u);
      return { stdout: "Success\n", stderr: "" };
    }
    assert.equal(args.at(-1), "dev.relay.appinventory/.InstalledAppsInstrumentation");
    return {
      stdout: labelsOutput([{ package: "com.example.notes", name: "Memo Pad" }]),
      stderr: "",
    };
  });
  assert.deepEqual(apps, [{ package: "com.example.notes", name: "Memo Pad" }]);
  assert.equal(calls.filter((args) => args.includes("install")).length, 1);
  assert.ok(
    calls.every((args) => !args.some((arg) => /snapshothelper|force-stop|uiautomator/u.test(arg))),
  );
});

test("labels are observed again after locale or application changes", async () => {
  let name = "Notes";
  let observations = 0;
  const execute: Parameters<typeof listAndroidInstalledApps>[1] = async (args) => {
    if (args.includes("query-activities"))
      return { stdout: "com.example.notes/.Main\n", stderr: "" };
    if (args.includes("dumpsys"))
      return { stdout: `versionName=${helperVersionName}\n`, stderr: "" };
    observations += 1;
    return { stdout: labelsOutput([{ package: "com.example.notes", name }]), stderr: "" };
  };
  assert.equal((await listAndroidInstalledApps("emulator-5554", execute))[0]?.name, "Notes");
  name = "ملاحظات";
  assert.equal((await listAndroidInstalledApps("emulator-5554", execute))[0]?.name, "ملاحظات");
  assert.equal(observations, 2);
});

test("helper timeout retains fallback names and empty inventories do not prepare a helper", async () => {
  let attempts = 0;
  const apps = await listAndroidInstalledApps("emulator-5554", async (args) => {
    if (args.includes("query-activities"))
      return { stdout: "com.example.notes/.Main\n", stderr: "" };
    if (args.includes("dumpsys"))
      return { stdout: `versionName=${helperVersionName}\n`, stderr: "" };
    attempts += 1;
    throw new Error("helper timed out");
  });
  assert.deepEqual(apps, [{ package: "com.example.notes", name: "Notes" }]);
  assert.equal(attempts, 1);
  const calls: string[][] = [];
  assert.deepEqual(
    await listAndroidInstalledApps("emulator-5554", async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    }),
    [],
  );
  assert.equal(calls.length, 1);
});

test("app discovery propagates device failures instead of reporting no apps", async () => {
  await assert.rejects(
    listAndroidInstalledApps("emulator-5554", async () => {
      throw new Error("device offline");
    }),
    /device offline/,
  );
  await assert.rejects(listAndroidInstalledApps("-invalid"), /serial/);
});

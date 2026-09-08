import assert from "node:assert/strict";
import test from "node:test";
import { listAndroidInstalledApps } from "./android-installed-apps.js";

test("app discovery scopes read-only package queries to the selected serial", async () => {
  const calls: string[][] = [];
  const apps = await listAndroidInstalledApps("emulator-5554", async (args) => {
    calls.push(args);
    return {
      stdout: "com.android.settings/.Settings\ncom.example.notes/.MainActivity\n",
      stderr: "",
    };
  });
  assert.equal(calls.length, 1);
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

test("app discovery propagates device failures instead of reporting no apps", async () => {
  await assert.rejects(
    listAndroidInstalledApps("emulator-5554", async () => {
      throw new Error("device offline");
    }),
    /device offline/,
  );
  await assert.rejects(listAndroidInstalledApps("-invalid"), /serial/);
});

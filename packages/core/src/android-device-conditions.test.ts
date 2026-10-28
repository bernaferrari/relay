import assert from "node:assert/strict";
import test from "node:test";
import {
  displayWarning,
  parseAndroidConnectivity,
  setAndroidDisplay,
  setAndroidNetwork,
} from "./android-device-conditions.js";

function fakeAdb(settings: Record<string, string>) {
  const commands: string[] = [];
  const adb = async (_serial: string, command: string) => {
    commands.push(command);
    const put = /^settings put global (\S+) (\S+)$/u.exec(command);
    if (put) settings[put[1]!] = put[2]!;
    if (command === "cmd connectivity airplane-mode enable") settings.airplane_mode_on = "1";
    if (command === "cmd connectivity airplane-mode disable") settings.airplane_mode_on = "0";
    if (command.startsWith("svc wifi")) settings.wifi_on = command.endsWith("enable") ? "1" : "0";
    if (command.startsWith("svc data"))
      settings.mobile_data = command.endsWith("enable") ? "1" : "0";
    if (command === "svc power stayon usb") settings.stay_on_while_plugged_in = "2";
    const get = /^settings get global (\S+)$/u.exec(command);
    if (get) return settings[get[1]!] ?? "null";
    if (command.startsWith("dumpsys connectivity")) {
      const online =
        settings.airplane_mode_on !== "1" &&
        (settings.wifi_on === "1" || settings.mobile_data === "1");
      return `Active default network: ${online ? "177" : "none"}`;
    }
    if (command === "dumpsys window policy") {
      return settings.awake === "1"
        ? "screenState=SCREEN_STATE_ON\ninteractiveState=INTERACTIVE_STATE_AWAKE\n showing=false"
        : "screenState=SCREEN_STATE_OFF\ninteractiveState=INTERACTIVE_STATE_SLEEP";
    }
    return "";
  };
  return { adb, commands, settings };
}

test("connectivity distinguishes online, offline, and airplane", () => {
  const base = { airplane: "0", wifi: "1", data: "1" };
  assert.equal(
    parseAndroidConnectivity({ ...base, activeNetwork: "Active default network: 177" })
      .connectivity,
    "online",
  );
  assert.equal(
    parseAndroidConnectivity({ ...base, activeNetwork: "Active default network: none" })
      .connectivity,
    "offline",
  );
  assert.equal(
    parseAndroidConnectivity({
      ...base,
      airplane: "1",
      activeNetwork: "Active default network: none",
    }).connectivity,
    "airplane",
  );
  assert.equal(parseAndroidConnectivity({ ...base, activeNetwork: "" }).connectivity, "unknown");
});

test("network restore returns to the radios in place before the first change", async () => {
  const { adb, settings } = fakeAdb({ airplane_mode_on: "0", wifi_on: "0", mobile_data: "1" });
  const sleep = async () => undefined;
  assert.equal((await setAndroidNetwork("A", "airplane", { adb, sleep })).connectivity, "airplane");
  await setAndroidNetwork("A", "data-off", { adb, sleep });
  const restored = await setAndroidNetwork("A", "restore", { adb, sleep });
  assert.deepEqual(restored, { connectivity: "online", airplane: false, wifi: false, data: true });
  assert.equal(settings.wifi_on, "0");
});

test("restore without a recorded baseline turns every radio back on", async () => {
  const { adb, settings } = fakeAdb({ airplane_mode_on: "1", wifi_on: "0", mobile_data: "0" });
  const restored = await setAndroidNetwork("D", "restore", { adb, sleep: async () => undefined });
  assert.deepEqual(restored, { connectivity: "online", airplane: false, wifi: true, data: true });
  assert.equal(settings.airplane_mode_on, "0");
});

test("keep-awake leaves an existing stay-on setting alone and release restores it", async () => {
  const { adb, commands, settings } = fakeAdb({ stay_on_while_plugged_in: "0", awake: "1" });
  const wake = async () => undefined;
  const held = await setAndroidDisplay("B", "keep-awake", { adb, wake });
  assert.deepEqual(held, { display: "on", stayAwake: true });
  assert.ok(commands.includes("svc power stayon usb"));
  await setAndroidDisplay("B", "release", { adb, wake });
  assert.equal(settings.stay_on_while_plugged_in, "0");

  const already = fakeAdb({ stay_on_while_plugged_in: "15", awake: "0" });
  const result = await setAndroidDisplay("C", "keep-awake", { adb: already.adb, wake });
  assert.equal(already.commands.includes("svc power stayon usb"), false);
  assert.deepEqual(result, { display: "asleep", stayAwake: true });
});

test("only asleep and locked displays carry a black-frame warning", () => {
  assert.match(displayWarning("asleep") ?? "", /display <serial> wake/u);
  assert.match(displayWarning("locked") ?? "", /Unlock the device/u);
  assert.equal(displayWarning("on"), undefined);
  assert.equal(displayWarning("unknown"), undefined);
});

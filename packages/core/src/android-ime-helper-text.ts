/**
 * Unicode text entry on Android devices with no shell clipboard (Samsung
 * builds answer `cmd clipboard` with "No shell command implementation").
 *
 * `input text` only carries ASCII. agent-device ships a headless test IME
 * that commits base64 text from an adb broadcast; it is switched in for one
 * commit and the person's keyboard is restored before returning.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { execAndroidAdb } from "./android-adb-host.js";
import { raceCancel } from "./control.js";
import { InputNotDispatchedError } from "./input-not-dispatched.js";

const IME_HELPER_PACKAGE = "com.callstack.agentdevice.imehelper";
const IME_HELPER_SERVICE = `${IME_HELPER_PACKAGE}/.TestInputMethodService`;
const ACTION_INPUT_TEXT_B64 = `${IME_HELPER_PACKAGE}.ACTION_INPUT_TEXT_B64`;
const PROTOCOL = "android-ime-helper-v1";

type Adb = typeof execAndroidAdb;

/** agent-device exports only ESM entry points, so locate the package root by lookup path. */
function agentDevicePackageRoot(): string {
  const paths = createRequire(import.meta.url).resolve.paths("agent-device") ?? [];
  const root = paths
    .map((nodeModules) => join(nodeModules, "agent-device"))
    .find((candidate) => existsSync(join(candidate, "package.json")));
  if (!root) throw new Error("agent-device package not found");
  return root;
}

async function imeHelperApk(): Promise<string> {
  const dist = join(agentDevicePackageRoot(), "android", "ime-helper", "dist");
  const manifestName = (await readdir(dist)).find((name) => name.endsWith(".manifest.json"));
  if (!manifestName) throw new Error(`agent-device IME helper manifest missing in ${dist}`);
  const manifest = JSON.parse(await readFile(join(dist, manifestName), "utf8")) as {
    assetName?: string;
  };
  if (!manifest.assetName) throw new Error("agent-device IME helper manifest has no assetName");
  return join(dist, manifest.assetName);
}

async function shell(adb: Adb, serial: string, args: string[]): Promise<string> {
  const { stdout } = await raceCancel(adb(["-s", serial, "shell", ...args], { timeout: 15_000 }));
  return String(stdout).trim();
}

async function sleep(ms: number): Promise<void> {
  await raceCancel(new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

async function ensureImeHelperInstalled(adb: Adb, serial: string): Promise<void> {
  // `pm path` exits non-zero when the package is absent.
  const installed = await shell(adb, serial, ["pm", "path", IME_HELPER_PACKAGE]).catch(() => "");
  if (installed.includes("package:")) return;
  await raceCancel(adb(["-s", serial, "install", "-r", await imeHelperApk()], { timeout: 60_000 }));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      (await shell(adb, serial, ["ime", "list", "-a", "-s"]))
        .split(/\r?\n/)
        .includes(IME_HELPER_SERVICE)
    ) {
      return;
    }
    await sleep(100);
  }
}

/** Commit `text` at the caret of the focused field through the transient test IME. */
export async function typeAndroidTextViaImeHelper(
  serial: string,
  text: string,
  adb: Adb = execAndroidAdb,
): Promise<void> {
  try {
    await ensureImeHelperInstalled(adb, serial);
  } catch (error) {
    throw new InputNotDispatchedError(
      `Could not install the agent-device text helper for non-ASCII text: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const previous = await shell(adb, serial, ["settings", "get", "secure", "default_input_method"]);
  try {
    try {
      await shell(adb, serial, ["ime", "enable", IME_HELPER_SERVICE]);
      await shell(adb, serial, ["ime", "set", IME_HELPER_SERVICE]);
    } catch (error) {
      throw new InputNotDispatchedError(
        `Could not switch to the agent-device text helper: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    // The new IME binds to the focused editor asynchronously after `ime set`.
    await sleep(400);
    await shell(adb, serial, [
      "am",
      "broadcast",
      "-p",
      IME_HELPER_PACKAGE,
      "-a",
      ACTION_INPUT_TEXT_B64,
      "--es",
      "protocol",
      PROTOCOL,
      "--es",
      "text",
      Buffer.from(text, "utf8").toString("base64"),
    ]);
    await sleep(150);
  } finally {
    if (previous && previous !== "null" && previous !== IME_HELPER_SERVICE) {
      await shell(adb, serial, ["ime", "set", previous]).catch(() => undefined);
    }
    await shell(adb, serial, ["ime", "disable", IME_HELPER_SERVICE]).catch(() => undefined);
  }
}

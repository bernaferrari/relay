/**
 * Thin agent-device SDK helpers.
 * Pattern: open → snapshot/find → press → re-check. Failures throw.
 * All long waits honor job cancel/pause via control.ts.
 */
import { createAgentDeviceClient } from "agent-device";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cooperativeCheckpoint, raceCancel, throwIfCancelled } from "./control.js";
import { withRetry } from "./retry.js";
import { currentTargetContext } from "./target-context.js";
import { captureNativeCrashEvidence, type CrashEvidenceResult } from "./crash-evidence.js";

export type DevicePlatform = "android" | "ios";
export const PLATFORM = "android" as const;
export function selectedPlatform(): DevicePlatform {
  const context = currentTargetContext();
  return context.kind === "device" ? context.platform : "android";
}
export const GROK_PACKAGE = "ai.x.grok";
export const PLAY_PACKAGE = "com.android.vending";
export const WORK_ACCOUNT_MATCH = process.env.WORK_ACCOUNT_MATCH?.trim() || "teachx.ai";

type NativeDevice = ReturnType<typeof createAgentDeviceClient>;

/** Canonical target-neutral capability surface consumed by core recipes. */
export type Device = {
  devices: {
    list: (options?: Parameters<NativeDevice["devices"]["list"]>[0]) => Promise<
      Array<{
        id: string;
        name: string;
        platform: string;
        target?: string;
        kind?: string;
        booted?: boolean;
        identifiers?: { serial?: string; udid?: string };
        android?: { serial: string };
        ios?: { udid: string };
      }>
    >;
    boot: (options?: Parameters<NativeDevice["devices"]["boot"]>[0]) => Promise<unknown>;
  };
  apps: {
    open: (options: Parameters<NativeDevice["apps"]["open"]>[0]) => Promise<unknown>;
    close: (options?: Parameters<NativeDevice["apps"]["close"]>[0]) => Promise<unknown>;
  };
  capture: {
    snapshot: (
      options?: Parameters<NativeDevice["capture"]["snapshot"]>[0],
    ) => Promise<{ nodes?: SnapshotNode[] }>;
    screenshot: (
      options?: Parameters<NativeDevice["capture"]["screenshot"]>[0],
    ) => Promise<{ path?: string; base64?: string }>;
  };
  interactions: {
    press: (options: Parameters<NativeDevice["interactions"]["press"]>[0]) => Promise<unknown>;
    longPress: (
      options: Parameters<NativeDevice["interactions"]["longPress"]>[0],
    ) => Promise<unknown>;
    type: (options: Parameters<NativeDevice["interactions"]["type"]>[0]) => Promise<unknown>;
    find: (options: Parameters<NativeDevice["interactions"]["find"]>[0]) => Promise<unknown>;
    scroll: (options: Parameters<NativeDevice["interactions"]["scroll"]>[0]) => Promise<unknown>;
    swipe: (options: Parameters<NativeDevice["interactions"]["swipe"]>[0]) => Promise<unknown>;
  };
  command: {
    wait: (options: Parameters<NativeDevice["command"]["wait"]>[0]) => Promise<unknown>;
    back: (options?: Parameters<NativeDevice["command"]["back"]>[0]) => Promise<unknown>;
    home: (options?: Parameters<NativeDevice["command"]["home"]>[0]) => Promise<unknown>;
    clipboard: (
      options: Parameters<NativeDevice["command"]["clipboard"]>[0],
    ) => Promise<
      { action: "read"; text: string } | { action: "write"; textLength: number; message: string }
    >;
    keyboard: (options?: Parameters<NativeDevice["command"]["keyboard"]>[0]) => Promise<unknown>;
    alert: (options: Parameters<NativeDevice["command"]["alert"]>[0]) => Promise<unknown>;
    appSwitcher: (
      options?: Parameters<NativeDevice["command"]["appSwitcher"]>[0],
    ) => Promise<unknown>;
    rotate: (options: Parameters<NativeDevice["command"]["rotate"]>[0]) => Promise<unknown>;
    prepare: (options: Parameters<NativeDevice["command"]["prepare"]>[0]) => Promise<unknown>;
  };
  settings: {
    update: (options: Parameters<NativeDevice["settings"]["update"]>[0]) => Promise<unknown>;
  };
  observability: {
    perf: (options?: Parameters<NativeDevice["observability"]["perf"]>[0]) => Promise<unknown>;
    logs: (options?: Parameters<NativeDevice["observability"]["logs"]>[0]) => Promise<unknown>;
    network: (
      options?: Parameters<NativeDevice["observability"]["network"]>[0],
    ) => Promise<unknown>;
    audio: (options?: Parameters<NativeDevice["observability"]["audio"]>[0]) => Promise<unknown>;
    crashes: (options: { action: "start" | "dump"; since: number }) => Promise<CrashEvidenceResult>;
  };
  recording: {
    record: (options: Parameters<NativeDevice["recording"]["record"]>[0]) => Promise<{
      [key: string]: unknown;
      started?: boolean;
      stopped?: boolean;
      warning?: string;
      path?: string;
    }>;
  };
};
const execFileAsync = promisify(execFile);

export type SnapshotNode = {
  label?: string;
  value?: string;
  identifier?: string;
  role?: string;
  type?: string;
  enabled?: boolean;
  selected?: boolean;
  focused?: boolean;
  visibleToUser?: boolean;
  hittable?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  ref?: string;
  index?: number;
  depth?: number;
  parentIndex?: number;
};

// Singleton client — reusing one client avoids "session already bound"
// conflicts that arise when each operation creates a fresh client that
// tries to re-bind the session to the device. Recipes call `open` once
// to establish the binding; subsequent captures/interactions reuse it.
let _device: Device | null = null;
export function createDevice(): Device {
  if (!_device) {
    const native = createAgentDeviceClient({
      session: process.env.AGENT_DEVICE_SESSION?.trim() || "relay-actions",
    });
    _device = {
      ...native,
      observability: {
        ...native.observability,
        crashes: ({ action, since }) =>
          action === "start"
            ? Promise.resolve({
                platform: selectedPlatform(),
                since,
                entries: [],
                truncated: false,
              })
            : captureNativeCrashEvidence(since),
      },
    };
  }
  return _device;
}

export function base() {
  const context = currentTargetContext();
  const platform = context.kind === "device" ? context.platform : "android";
  const serial = context.kind === "device" ? context.serial : undefined;
  return platform === "ios"
    ? ({ platform, ...(serial ? { udid: serial, device: serial } : {}) } as const)
    : ({ platform, ...(serial ? { serial, device: serial } : {}) } as const);
}

/** Run a device promise under cancel race, pause checkpoints, and flake retries. */
async function controlled<T>(op: () => Promise<T>): Promise<T> {
  return withRetry(
    async () => {
      await cooperativeCheckpoint();
      throwIfCancelled();
      return await raceCancel(op());
    },
    {
      attempts: Number(
        process.env.RELAY_RETRY_ATTEMPTS ?? process.env.GROK_DEVICE_RETRY_ATTEMPTS ?? 3,
      ),
      baseDelayMs: Number(
        process.env.RELAY_RETRY_DELAY_MS ?? process.env.GROK_DEVICE_RETRY_DELAY_MS ?? 350,
      ),
    },
  );
}

export async function sleep(ms: number, device: Device = createDevice()): Promise<void> {
  // Small chunks = faster cancel/pause response
  const chunk = 100;
  let left = Math.max(0, ms);
  while (left > 0) {
    await cooperativeCheckpoint();
    const step = Math.min(chunk, left);
    await raceCancel(device.command.wait({ ...base(), durationMs: step }));
    left -= step;
  }
  await cooperativeCheckpoint();
}

export async function snapshot(
  device: Device,
  opts?: { interactiveOnly?: boolean; raw?: boolean },
): Promise<SnapshotNode[]> {
  const result = await controlled(() =>
    device.capture.snapshot({
      ...base(),
      interactiveOnly: opts?.interactiveOnly ?? false,
      raw: opts?.raw,
    }),
  );
  return (result.nodes ?? []) as SnapshotNode[];
}

export async function openApp(
  device: Device,
  app: string,
  opts?: { relaunch?: boolean },
): Promise<void> {
  await controlled(() =>
    device.apps.open({
      ...base(),
      app,
      relaunch: opts?.relaunch ?? true,
    }),
  );
  await sleep(2000, device);
}

export async function openUrl(device: Device, url: string): Promise<void> {
  await controlled(() => device.apps.open({ ...base(), url }));
  await sleep(2500, device);
}

export async function pressLabel(device: Device, label: string): Promise<void> {
  await controlled(() =>
    device.interactions.press({
      ...base(),
      selector: `label="${label}"`,
    }),
  );
}

export async function pressPoint(device: Device, x: number, y: number): Promise<void> {
  await controlled(() => device.interactions.press({ ...base(), x, y }));
}

export async function longPressTarget(
  device: Device,
  target: { ref?: string; label?: string; text?: string; point?: { x: number; y: number } },
  durationMs = 700,
): Promise<void> {
  if (target.ref) {
    await controlled(() =>
      device.interactions.longPress({
        ...base(),
        ref: target.ref!.startsWith("@") ? target.ref! : `@${target.ref!}`,
        durationMs,
      }),
    );
  } else if (target.label) {
    const label = target.label;
    await controlled(() =>
      device.interactions.longPress({
        ...base(),
        selector: `label="${label.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
  } else if (target.text) {
    const text = target.text;
    await controlled(() =>
      device.interactions.longPress({
        ...base(),
        selector: `label*="${text.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
  } else if (target.point) {
    await controlled(() =>
      device.interactions.longPress({
        ...base(),
        x: target.point!.x,
        y: target.point!.y,
        durationMs,
      }),
    );
  } else {
    throw new Error("hold requires a target");
  }
}

export async function clipboardWrite(device: Device, text: string): Promise<void> {
  await controlled(() => device.command.clipboard({ ...base(), action: "write", text }));
}

export async function clipboardRead(device: Device): Promise<string> {
  const result = await controlled(() => device.command.clipboard({ ...base(), action: "read" }));
  if (result.action !== "read") throw new Error("clipboard read returned an unexpected result");
  return result.text;
}

export async function closeApp(device: Device, app?: string): Promise<void> {
  await controlled(() => device.apps.close({ ...base(), ...(app ? { app } : {}) }));
}

export type AndroidAppBuild = {
  packageName: string;
  installed: boolean;
  versionName?: string;
  versionCode?: string;
};

function androidAdbArgs(args: string[]): string[] {
  const serial = process.env.AGENT_DEVICE_SERIAL?.trim() || process.env.ANDROID_SERIAL?.trim();
  return [...(serial ? ["-s", serial] : []), ...args];
}

function requireAndroidBuildControl(): void {
  if (selectedPlatform() !== "android") {
    throw new Error(
      "capability unavailable: app build inspection and APK installation currently require Android",
    );
  }
}

/** Parse the stable fields from `adb shell dumpsys package`. Exported so the
 * evidence reader remains testable without a connected device. */
export function parseAndroidAppBuild(packageName: string, output: string): AndroidAppBuild {
  const versionName = output.match(/\bversionName=([^\s]+)/)?.[1];
  const versionCode = output.match(/\bversionCode=(\d+)/)?.[1];
  return {
    packageName,
    installed: Boolean(versionName || versionCode || output.includes(`Package [${packageName}]`)),
    ...(versionName ? { versionName } : {}),
    ...(versionCode ? { versionCode } : {}),
  };
}

/** Inspect the build that is really installed on the selected Android device.
 * This is deliberately a narrow adb bridge: it never uses a shell string and
 * the output becomes immutable run evidence rather than mutable test state. */
export async function inspectAndroidApp(packageName: string): Promise<AndroidAppBuild> {
  requireAndroidBuildControl();
  if (!/^[A-Za-z0-9._-]+$/.test(packageName)) {
    throw new Error("app package name contains unsupported characters");
  }
  await cooperativeCheckpoint();
  throwIfCancelled();
  try {
    const { stdout } = await raceCancel(
      execFileAsync("adb", androidAdbArgs(["shell", "dumpsys", "package", packageName])),
    );
    return parseAndroidAppBuild(packageName, String(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unknown package|not found|does not exist|can't find/i.test(message)) {
      return { packageName, installed: false };
    }
    throw error;
  }
}

async function runAndroidInstall(
  action: "install" | "update" | "uninstall",
  packageName: string,
  artifact?: string,
): Promise<AndroidAppBuild> {
  requireAndroidBuildControl();
  if (!/^[A-Za-z0-9._-]+$/.test(packageName)) {
    throw new Error("app package name contains unsupported characters");
  }
  if ((action === "install" || action === "update") && !artifact?.trim()) {
    throw new Error(`${action} requires a local APK artifact path`);
  }
  await cooperativeCheckpoint();
  throwIfCancelled();
  if (action === "uninstall") {
    await raceCancel(execFileAsync("adb", androidAdbArgs(["uninstall", packageName])));
    return { packageName, installed: false };
  }
  const args = action === "update" ? ["install", "-r", artifact!] : ["install", artifact!];
  await raceCancel(execFileAsync("adb", androidAdbArgs(args)));
  return await inspectAndroidApp(packageName);
}

/** Install, update, or uninstall a known local Android APK. iOS and browser
 * targets fail explicitly instead of pretending those lifecycle operations
 * are portable. */
export async function changeAndroidAppBuild(input: {
  action: "install" | "update" | "uninstall";
  packageName: string;
  artifact?: string;
}): Promise<AndroidAppBuild> {
  return await runAndroidInstall(input.action, input.packageName, input.artifact);
}

export async function openAppSwitcher(device: Device): Promise<void> {
  await controlled(() => device.command.appSwitcher({ ...base() }));
}

export async function rotateDevice(
  device: Device,
  orientation: "portrait" | "portrait-upside-down" | "landscape-left" | "landscape-right",
): Promise<void> {
  await controlled(() => device.command.rotate({ ...base(), orientation }));
}

export async function keyboardAction(device: Device, action: "dismiss" | "enter"): Promise<void> {
  await controlled(() => device.command.keyboard({ ...base(), action }));
}

export async function alertAction(
  device: Device,
  action: "get" | "accept" | "dismiss" | "wait",
  timeoutMs?: number,
): Promise<unknown> {
  return await controlled(() =>
    device.command.alert({ ...base(), action, ...(timeoutMs !== undefined ? { timeoutMs } : {}) }),
  );
}

export async function updateSetting(
  device: Device,
  input: Parameters<Device["settings"]["update"]>[0],
): Promise<unknown> {
  return await controlled(() => device.settings.update(input));
}

export async function captureNetwork(
  device: Device,
  options: {
    action: "dump" | "log";
    include?: "summary" | "headers" | "body" | "all";
    limit?: number;
  },
): Promise<unknown> {
  return await controlled(() => device.observability.network({ ...base(), ...options }));
}

export async function manageLogs(
  device: Device,
  options: { action: "start" | "stop" | "mark" | "clear"; message?: string },
): Promise<unknown> {
  return await controlled(() => device.observability.logs({ ...base(), ...options }));
}

/** agent-device intentionally has no public lock-screen command yet. Its own
 * CLI guidance allows a platform bridge for command gaps; keep that bridge
 * isolated here so recipes still have one capability surface. */
export async function setAndroidLockState(action: "lock" | "unlock"): Promise<void> {
  if (selectedPlatform() !== "android") {
    throw new Error(
      "capability unavailable: lock-screen control is not supported by this iOS runner",
    );
  }
  const serial = process.env.AGENT_DEVICE_SERIAL?.trim() || process.env.ANDROID_SERIAL?.trim();
  const args = [
    ...(serial ? ["-s", serial] : []),
    "shell",
    "input",
    "keyevent",
    action === "lock" ? "223" : "224",
  ];
  await cooperativeCheckpoint();
  throwIfCancelled();
  await raceCancel(execFileAsync("adb", args));
  if (action === "unlock") {
    await raceCancel(
      execFileAsync("adb", [...(serial ? ["-s", serial] : []), "shell", "input", "keyevent", "82"]),
    );
  }
}

/** Swipe from one point to another over `durationMs`. Follows pressPoint style. */
export async function swipeGesture(
  device: Device,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs = 250,
): Promise<void> {
  await controlled(() => device.interactions.swipe({ ...base(), from, to, durationMs }));
}

export async function typeText(device: Device, text: string): Promise<void> {
  await controlled(() => device.interactions.type({ ...base(), text }));
}

export async function pressKey(device: Device, key: "back" | "home"): Promise<void> {
  if (key === "back") {
    await controlled(() => device.command.back({ ...base() }));
  } else {
    await controlled(() => device.command.home({ ...base() }));
  }
}

export async function pressRef(device: Device, ref: string): Promise<void> {
  const normalized = ref.startsWith("@") ? ref : `@${ref}`;
  await controlled(() => device.interactions.press({ ...base(), ref: normalized }));
}

export async function findClick(
  device: Device,
  query: string,
  opts?: { first?: boolean; last?: boolean },
): Promise<void> {
  await controlled(() =>
    device.interactions.find({
      ...base(),
      query,
      action: "click",
      first: opts?.first ?? true,
      last: opts?.last,
    }),
  );
}

export async function exists(device: Device, query: string): Promise<boolean> {
  try {
    await controlled(() =>
      device.interactions.find({
        ...base(),
        query,
        action: "exists",
        first: true,
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "JobCancelledError") throw err;
    return false;
  }
}

export async function waitFor(
  device: Device,
  selectorOrText: { selector?: string; text?: string; query?: string },
  timeoutMs = 30_000,
): Promise<void> {
  if (selectorOrText.selector) {
    const selector = selectorOrText.selector;
    await controlled(() =>
      device.command.wait({
        ...base(),
        selector,
        timeoutMs,
      }),
    );
    return;
  }
  if (selectorOrText.text) {
    const text = selectorOrText.text;
    await controlled(() =>
      device.command.wait({
        ...base(),
        text,
        timeoutMs,
      }),
    );
    return;
  }
  const query = selectorOrText.query;
  if (!query) throw new Error("waitFor requires selector, text, or query");
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await cooperativeCheckpoint();
    if (await exists(device, query)) return;
    await sleep(400, device);
  }
  throw new Error(`Timed out waiting for: ${query}`);
}

export async function scrollDown(device: Device, amount = 0.5): Promise<void> {
  await controlled(() =>
    device.interactions.scroll({
      ...base(),
      direction: "down",
      amount,
    }),
  );
}

export async function screenshot(device: Device, path: string): Promise<void> {
  await controlled(() => device.capture.screenshot({ path }));
}

export function nodesMatch(nodes: SnapshotNode[], substring: string): SnapshotNode | undefined {
  const q = substring.toLowerCase();
  return nodes.find((n) => {
    const blob = `${n.label ?? ""} ${n.value ?? ""}`.toLowerCase();
    return blob.includes(q);
  });
}

export function center(rect: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
}

export async function pressMatchingText(device: Device, match: string): Promise<void> {
  if (await exists(device, match)) {
    try {
      await findClick(device, match);
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "JobCancelledError") throw err;
    }
  }

  const nodes = await snapshot(device);
  const textNode = nodesMatch(nodes, match);
  if (!textNode?.rect) {
    throw new Error(`No UI node matching "${match}"`);
  }

  const { x: tx, y: ty, width: tw, height: th } = textNode.rect;
  let best: { area: number; x: number; y: number; width: number; height: number } | undefined;

  for (const n of nodes) {
    if (!n.hittable || !n.rect) continue;
    const { x, y, width, height } = n.rect;
    if (x <= tx && y <= ty && x + width >= tx + tw && y + height >= ty + th && width >= 400) {
      const area = width * height;
      if (!best || area < best.area) {
        best = { area, x, y, width, height };
      }
    }
  }

  const rect = best ?? textNode.rect;
  const p = center(rect);
  await pressPoint(device, p.x, p.y);
}

export async function anyExists(device: Device, queries: string[]): Promise<string | undefined> {
  for (const q of queries) {
    if (await exists(device, q)) return q;
  }
  return undefined;
}

/**
 * Thin agent-device SDK helpers.
 * Pattern: open → snapshot/find → press → re-check. Failures throw.
 * All long waits honor job cancel/pause via control.ts.
 */
import { createAgentDeviceClient } from "agent-device";
import {
  readAndroidClipboardWithAdb,
  writeAndroidClipboardWithAdb,
  type AndroidAdbExecutor,
} from "agent-device/android-adb";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cooperativeCheckpoint,
  getExecutingJobId,
  raceCancel,
  throwIfCancelled,
} from "./control.js";
import { runTargetMutation } from "./target-control.js";
import { bindNativeDeviceMutations, clearAndroidTextWithAdb } from "./device-mutation-adapter.js";
import { withRetry } from "./retry.js";
import { readWorkspaceSetting, writeWorkspaceSetting } from "./workspace-settings.js";
import {
  currentTargetContext,
  selectedPlatform,
  targetIdentity,
  targetSessionName,
  type TargetContext,
} from "./target-context.js";
import {
  currentIosDeviceSerial,
  iosSelectorWasNotDispatched,
  runIosMutationOnce,
  type IosMutationOperation,
} from "./ios-mutation-policy.js";
import { captureIosSnapshot, resetIosSnapshotFlights } from "./ios-snapshot-flight.js";
export {
  IosMutationOutcomeUnknownError,
  lastIosMutationAttemptDiagnostic,
  runIosMutationOnce,
} from "./ios-mutation-policy.js";
export type { IosMutationAttemptDiagnostic, IosMutationOperation } from "./ios-mutation-policy.js";
export {
  IOS_SNAPSHOT_TIMEOUT_MS,
  IosSnapshotInFlightError,
  IosSnapshotTimedOutError,
  isIosAccessibilityQueryInFlightError,
} from "./ios-snapshot-flight.js";
export { selectedPlatform } from "./target-context.js";
export * from "./android-app-build.js";
import { captureNativeCrashEvidence, type CrashEvidenceResult } from "./crash-evidence.js";
import { openPhysicalIosApp } from "./ios-app-open.js";
import {
  center,
  explicitPointResolution,
  INTERACTIVE_SNAPSHOT_ROLES,
  resolveNamedControl,
  resolveSnapshotTargetPoint,
} from "./device-target-resolution.js";
import type {
  NamedControlResolution,
  NamedControlTarget,
  SemanticSnapshotTarget,
} from "./device-target-resolution.js";
export {
  center,
  preflightSemanticActivation,
  resolveFollowingRowControl,
  resolveNamedControl,
  resolveSnapshotTargetPoint,
} from "./device-target-resolution.js";
export type {
  NamedControlMethod,
  NamedControlResolution,
  NamedControlTarget,
  SemanticActivationPreflight,
  SnapshotTargetRegion,
} from "./device-target-resolution.js";

export type DevicePlatform = "android" | "ios";
export const PLATFORM = "android" as const;
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
    open: (options: Parameters<NativeDevice["apps"]["open"]>[0]) => Promise<{
      appName?: string;
      appBundleId?: string;
      appId?: string;
    }>;
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
    fill: (options: Parameters<NativeDevice["interactions"]["fill"]>[0]) => Promise<unknown>;
    type: (options: Parameters<NativeDevice["interactions"]["type"]>[0]) => Promise<unknown>;
    find: (options: Parameters<NativeDevice["interactions"]["find"]>[0]) => Promise<unknown>;
    scroll: (options: Parameters<NativeDevice["interactions"]["scroll"]>[0]) => Promise<unknown>;
    swipe: (options: Parameters<NativeDevice["interactions"]["swipe"]>[0]) => Promise<unknown>;
    pan: (options: Parameters<NativeDevice["interactions"]["pan"]>[0]) => Promise<unknown>;
  };
  command: {
    wait: (options: Parameters<NativeDevice["command"]["wait"]>[0]) => Promise<unknown>;
    back: (options?: Parameters<NativeDevice["command"]["back"]>[0]) => Promise<unknown>;
    home: (options?: Parameters<NativeDevice["command"]["home"]>[0]) => Promise<unknown>;
    clipboard: (
      options: Parameters<NativeDevice["command"]["clipboard"]>[0],
    ) => Promise<
      | { action: "read"; text: string }
      | { action: "write"; textLength: number; message: string }
      | { action: "paste" | "copy"; text: string; textLength: number; message: string }
    >;
    appState: (options?: Parameters<NativeDevice["command"]["appState"]>[0]) => Promise<
      | {
          platform: "ios" | "macos";
          appName: string;
          appBundleId?: string;
          source: "session";
          surface: string;
          device_udid?: string;
        }
      | { platform: "android"; package: string; activity: string }
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
  /** Owning Android package when the provider exposes multi-window nodes. */
  bundleId?: string;
};

// One client per explicit target preserves SDK session reuse without binding
// unrelated concurrently executing targets to the same agent-device session.
const devicesByTarget = new Map<string, Device>();
const applicationsByTarget = new Map<string, string>();
const TARGET_APPLICATIONS_FILE = "runtime/target-applications.json";
let applicationsLoaded = false;
let applicationsWrite = Promise.resolve();

function targetKey(context = currentTargetContext()): string {
  return `${context.platform}:${targetIdentity(context)}`;
}

async function loadTargetApplications(): Promise<void> {
  if (applicationsLoaded) return;
  const stored = await readWorkspaceSetting(TARGET_APPLICATIONS_FILE).catch(() => null);
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    const values = (stored as { applications?: unknown }).applications;
    if (values && typeof values === "object" && !Array.isArray(values)) {
      for (const [key, app] of Object.entries(values)) {
        if (typeof app === "string" && app.trim()) applicationsByTarget.set(key, app.trim());
      }
    }
  }
  applicationsLoaded = true;
}

async function persistTargetApplications(): Promise<void> {
  const applications = Object.fromEntries(
    [...applicationsByTarget.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  applicationsWrite = applicationsWrite
    .catch(() => undefined)
    .then(() => writeWorkspaceSetting(TARGET_APPLICATIONS_FILE, { version: 1, applications }));
  await applicationsWrite;
}

/** Last app Relay intentionally opened on a target; used to repair XCTest binding drift. */
export async function rememberedTargetApplication(
  context = currentTargetContext(),
): Promise<string | undefined> {
  await loadTargetApplications();
  return applicationsByTarget.get(targetKey(context));
}

export async function rememberTargetApplication(
  app: string | undefined,
  context = currentTargetContext(),
): Promise<void> {
  await loadTargetApplications();
  const value = app?.trim();
  if (value) applicationsByTarget.set(targetKey(context), value);
  else applicationsByTarget.delete(targetKey(context));
  await persistTargetApplications();
}

/**
 * Local AgentDevice client for the current (or explicit) target.
 * Cloud contexts must use {@link createDeviceForTarget} / CloudDeviceProvider —
 * do not bind a local agent-device session to a remote sessionId.
 */
export function createDevice(explicitContext?: TargetContext): Device {
  const context = explicitContext ?? currentTargetContext();
  if (context.kind === "cloud") {
    throw new Error(
      `createDevice is local-only; use createDeviceForTarget for cloud provider "${context.provider}" (session ${context.sessionId})`,
    );
  }
  const key = targetKey(context);
  let device = devicesByTarget.get(key);
  if (!device) {
    const native = createAgentDeviceClient({
      session: process.env.AGENT_DEVICE_SESSION?.trim() || targetSessionName(context),
    });
    device = {
      ...native,
      ...bindNativeDeviceMutations(native, targetIdentity(context)),
      observability: {
        ...native.observability,
        crashes: ({ action, since }) =>
          action === "start"
            ? Promise.resolve({
                platform: context.kind === "device" ? context.platform : "android",
                since,
                entries: [],
                truncated: false,
              })
            : captureNativeCrashEvidence(since),
      },
    };
    devicesByTarget.set(key, device);
  }
  return device;
}

export function resetDeviceClient(context = currentTargetContext()): void {
  devicesByTarget.delete(`${context.platform}:${targetIdentity(context)}`);
  if (context.kind === "device" && context.platform === "ios") {
    // A client reset only happens after an explicit runner/session repair. The
    // old native snapshot cannot be cancelled by agent-device, but that repair
    // has stopped its XCTest session, so it is safe for the next client to
    // begin a fresh tree read.
    resetIosSnapshotFlights(context);
  }
}

/** Drop cached SDK clients after host-level device configuration changes. */
export function resetDeviceClients(): void {
  devicesByTarget.clear();
  resetIosSnapshotFlights();
}

export function base() {
  const context = currentTargetContext();
  const platform =
    context.kind === "device" || context.kind === "cloud" ? context.platform : "android";
  const serial = context.kind === "device" ? context.serial : undefined;
  return platform === "ios"
    ? ({ platform, ...(serial ? { udid: serial } : {}) } as const)
    : ({ platform, ...(serial ? { serial } : {}) } as const);
}

/**
 * agent-device's iOS runner can coordinate-activate controls XCTest marks
 * non-hittable (SwiftUI rows). The SDK maps press options → daemon flags via
 * a shallow merge: `maestro` must be a top-level press field, not nested under
 * `flags`. Optional expectedTapPoint steers the coordinate fallback.
 */
function iosNonHittablePressFields(point?: { x: number; y: number }): Record<string, unknown> {
  if (selectedPlatform() !== "ios") return {};
  return {
    maestro: {
      allowNonHittableCoordinateFallback: true,
      ...(point ? { expectedTapPoint: { x: point.x, y: point.y } } : {}),
    },
  };
}

/**
 * Retry an operation only when it is a read or a non-iOS mutation with an
 * established idempotency contract. Physical iOS input must use
 * {@link controlledMutation} so a lost acknowledgement never becomes a
 * second tap, swipe, or text entry.
 */
async function controlled<T>(op: () => Promise<T>): Promise<T> {
  return withRetry(
    async () => {
      await cooperativeCheckpoint();
      throwIfCancelled();
      return await raceCancel(op());
    },
    {
      attempts: Number(process.env.RELAY_RETRY_ATTEMPTS ?? 3),
      baseDelayMs: Number(process.env.RELAY_RETRY_DELAY_MS ?? 350),
    },
  );
}

/**
 * Android retains its existing bounded transient retry behaviour. Only a
 * connected iOS device takes the exact-once branch; cloud providers can opt
 * into an explicit idempotency contract when they implement one.
 */
async function controlledMutation<T>(
  operation: IosMutationOperation,
  op: () => Promise<T>,
): Promise<T> {
  const serial = currentIosDeviceSerial();
  return serial ? runIosMutationOnce(serial, operation, op) : controlled(op);
}

function mutateCurrentTarget<T>(operation: () => Promise<T>): Promise<T> {
  return runTargetMutation(targetIdentity(), getExecutingJobId(), operation);
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
  opts?: { interactiveOnly?: boolean; raw?: boolean; timeoutMs?: number },
): Promise<SnapshotNode[]> {
  const run = () =>
    device.capture.snapshot({
      ...base(),
      interactiveOnly: opts?.interactiveOnly ?? false,
      raw: opts?.raw,
    });
  let context: ReturnType<typeof currentTargetContext> | undefined;
  try {
    context = currentTargetContext();
  } catch {
    context = undefined;
  }
  // Physical iOS XCTest snapshots can sit on the daemon's 90s budget after the
  // runner dies. Fail fast so expect-screen/tour can use pixels instead.
  if (context?.kind === "device" && context.platform === "ios") {
    return await captureIosSnapshot(context, opts?.interactiveOnly ?? false, run, opts?.timeoutMs);
  }
  const result = await controlled(run);
  return (result.nodes ?? []) as SnapshotNode[];
}

export async function openApp(
  device: Device,
  app: string,
  opts?: { relaunch?: boolean },
): Promise<void> {
  const context = currentTargetContext();
  if (context.kind === "device" && context.platform === "ios") {
    await openPhysicalIosApp({
      context,
      app,
      relaunch: opts?.relaunch ?? true,
      rememberApplication: rememberTargetApplication,
    });
    return;
  }
  const opened = await controlledMutation("app-open", () =>
    device.apps.open({
      ...base(),
      app,
      relaunch: opts?.relaunch ?? true,
    }),
  );
  await rememberTargetApplication(opened.appBundleId ?? opened.appId ?? app);
  await sleep(2000, device);
}

export async function openUrl(device: Device, url: string): Promise<void> {
  await controlledMutation("url-open", () => device.apps.open({ ...base(), url }));
  await sleep(2500, device);
}

export type RepeatedPress = {
  count?: number;
  intervalMs?: number;
  doubleTap?: boolean;
};

export async function pressLabel(
  device: Device,
  label: string,
  repeated?: RepeatedPress,
): Promise<void> {
  const point = resolveSnapshotTargetPoint(await snapshot(device), { label });
  try {
    await controlledMutation("press", () =>
      device.interactions.press({
        ...base(),
        selector: `label="${label.replaceAll('"', '\\"')}"`,
        ...iosNonHittablePressFields(point),
        ...repeated,
      } as never),
    );
  } catch (error) {
    const fallback =
      selectedPlatform() === "ios"
        ? await iosSnapshotFallbackPoint(device, { label }, error, point)
        : (point ?? (await iosSnapshotFallbackPoint(device, { label }, error)));
    await pressPoint(device, fallback.x, fallback.y, repeated);
  }
}

export async function pressIdentifier(
  device: Device,
  identifier: string,
  repeated?: RepeatedPress,
): Promise<void> {
  const point = resolveSnapshotTargetPoint(await snapshot(device), { identifier });
  try {
    await controlledMutation("press", () =>
      device.interactions.press({
        ...base(),
        selector: `id="${identifier.replaceAll('"', '\\"')}"`,
        ...iosNonHittablePressFields(point),
        ...repeated,
      } as never),
    );
  } catch (error) {
    const fallback =
      selectedPlatform() === "ios"
        ? await iosSnapshotFallbackPoint(device, { identifier }, error, point)
        : (point ?? (await iosSnapshotFallbackPoint(device, { identifier }, error)));
    await pressPoint(device, fallback.x, fallback.y, repeated);
  }
}

export async function pressPoint(
  device: Device,
  x: number,
  y: number,
  repeated?: RepeatedPress,
): Promise<void> {
  await controlledMutation("press", () =>
    device.interactions.press({
      ...base(),
      x,
      y,
      ...repeated,
    } as never),
  );
}

export async function longPressTarget(
  device: Device,
  target: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  },
  durationMs = 700,
): Promise<void> {
  if (target.identifier) {
    await controlledMutation("long-press", () =>
      device.interactions.longPress({
        ...base(),
        selector: `id="${target.identifier!.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
  } else if (target.ref) {
    await controlledMutation("long-press", () =>
      device.interactions.longPress({
        ...base(),
        ref: target.ref!.startsWith("@") ? target.ref! : `@${target.ref!}`,
        durationMs,
      }),
    );
  } else if (target.label) {
    const label = target.label;
    await controlledMutation("long-press", () =>
      device.interactions.longPress({
        ...base(),
        selector: `label="${label.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
  } else if (target.text) {
    const text = target.text;
    await controlledMutation("long-press", () =>
      device.interactions.longPress({
        ...base(),
        selector: `label*="${text.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
  } else if (target.point) {
    await controlledMutation("long-press", () =>
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
  try {
    await controlledMutation("clipboard-write", () =>
      device.command.clipboard({ ...base(), action: "write", text }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (selectedPlatform() !== "android" || !isAndroidClipboardTransportFailure(message)) {
      throw error;
    }
    await controlled(() =>
      mutateCurrentTarget(() =>
        writeAndroidClipboardWithAdb(androidAdbExecutor(targetIdentity()), text),
      ),
    );
  }
}

export async function clipboardRead(device: Device): Promise<string> {
  try {
    const result = await controlled(() => device.command.clipboard({ ...base(), action: "read" }));
    if (result.action !== "read") throw new Error("clipboard read returned an unexpected result");
    return result.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (selectedPlatform() !== "android" || !isAndroidClipboardTransportFailure(message)) {
      throw error;
    }
    return controlled(() => readAndroidClipboardWithAdb(androidAdbExecutor(targetIdentity())));
  }
}

type AtomicClipboardTarget = {
  identifier?: string;
  label?: string;
  text?: string;
};

function atomicClipboardSelector(target: AtomicClipboardTarget): {
  selectorKey: "id" | "label" | "text";
  selectorValue: string;
} {
  if (target.identifier) return { selectorKey: "id", selectorValue: target.identifier };
  if (target.label) return { selectorKey: "label", selectorValue: target.label };
  if (target.text) return { selectorKey: "text", selectorValue: target.text };
  throw new Error("clipboard copy/paste requires an identifier, label, or text target");
}

async function focusClipboardTarget(
  device: Device,
  target: AtomicClipboardTarget & { ref?: string; point?: { x: number; y: number } },
): Promise<void> {
  if (target.identifier) return pressIdentifier(device, target.identifier);
  if (target.ref) return pressRef(device, target.ref);
  if (target.label) return pressLabel(device, target.label);
  if (target.text) return pressText(device, target.text);
  if (target.point) return pressPoint(device, target.point.x, target.point.y);
  throw new Error("clipboard copy/paste requires an identifier, label, or text target");
}

/** Perform the actual iOS system Paste action before XCTest exits.
 * Physical iOS clears runner-owned pasteboard data when a one-command test process
 * terminates, so write and Paste must be one verified native transaction. */
export async function clipboardPaste(
  device: Device,
  text: string,
  target: AtomicClipboardTarget & { ref?: string; point?: { x: number; y: number } },
): Promise<string> {
  try {
    const result = await controlledMutation("clipboard-paste", () =>
      device.command.clipboard({
        ...base(),
        action: "paste",
        text,
        ...atomicClipboardSelector(target),
      }),
    );
    if (result.action !== "paste") throw new Error("clipboard paste returned an unexpected result");
    return result.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (selectedPlatform() !== "android" || !isAndroidClipboardTransportFailure(message)) {
      throw error;
    }
    await focusClipboardTarget(device, target);
    await mutateCurrentTarget(() => pasteAndroidTextWithAdb(text, targetIdentity()));
    return text;
  }
}

/** Select and copy editable text through the real iOS edit menu, then read and
 * optionally verify it before XCTest exits. */
export async function clipboardCopy(
  device: Device,
  target: AtomicClipboardTarget & { ref?: string; point?: { x: number; y: number } },
  expectedText?: string,
): Promise<string> {
  try {
    const result = await controlledMutation("clipboard-copy", () =>
      device.command.clipboard({
        ...base(),
        action: "copy",
        ...atomicClipboardSelector(target),
        ...(expectedText !== undefined ? { expectedText } : {}),
      }),
    );
    if (result.action !== "copy") throw new Error("clipboard copy returned an unexpected result");
    return result.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (selectedPlatform() !== "android" || !isAndroidClipboardTransportFailure(message)) {
      throw error;
    }
    await focusClipboardTarget(device, target);
    const adb = androidAdbExecutor(targetIdentity());
    const selectAll = await adb([
      "shell",
      "input",
      "keycombination",
      "KEYCODE_CTRL_LEFT",
      "KEYCODE_A",
    ]);
    if (selectAll.exitCode !== 0) {
      throw new Error(selectAll.stderr || "Android could not select the target text");
    }
    const copy = await adb(["shell", "input", "keycombination", "KEYCODE_CTRL_LEFT", "KEYCODE_C"]);
    if (copy.exitCode !== 0) {
      throw new Error(copy.stderr || "Android could not copy the target text");
    }
    const copiedText = await readAndroidClipboardWithAdb(adb);
    if (expectedText !== undefined && copiedText !== expectedText) {
      throw new Error(
        `Android clipboard text did not match the expected value (received ${copiedText.length} characters)`,
      );
    }
    return copiedText;
  }
}

export async function closeApp(device: Device, app?: string): Promise<void> {
  await controlledMutation("app-close", () =>
    device.apps.close({ ...base(), ...(app ? { app } : {}) }),
  );
}

export async function openAppSwitcher(device: Device): Promise<void> {
  await controlledMutation("app-switcher", () => device.command.appSwitcher({ ...base() }));
}

export async function rotateDevice(
  device: Device,
  orientation: "portrait" | "portrait-upside-down" | "landscape-left" | "landscape-right",
): Promise<void> {
  await controlledMutation("rotate", () => device.command.rotate({ ...base(), orientation }));
}

export async function keyboardAction(device: Device, action: "dismiss" | "enter"): Promise<void> {
  await controlledMutation("keyboard", () => device.command.keyboard({ ...base(), action }));
}

export async function alertAction(
  device: Device,
  action: "get" | "accept" | "dismiss" | "wait",
  timeoutMs?: number,
): Promise<unknown> {
  const op = () =>
    device.command.alert({ ...base(), action, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
  return await (action === "get" || action === "wait"
    ? controlled(op)
    : controlledMutation("alert", op));
}

export async function updateSetting(
  device: Device,
  input: Parameters<Device["settings"]["update"]>[0],
): Promise<unknown> {
  return await controlledMutation("settings", () => device.settings.update(input));
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
  const serial = targetIdentity();
  const args = ["-s", serial, "shell", "input", "keyevent", action === "lock" ? "223" : "224"];
  await cooperativeCheckpoint();
  throwIfCancelled();
  await mutateCurrentTarget(() => raceCancel(execFileAsync("adb", args)));
  if (action === "unlock") {
    await mutateCurrentTarget(() =>
      raceCancel(execFileAsync("adb", ["-s", serial, "shell", "input", "keyevent", "82"])),
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
  // agent-device 0.20 models timed coordinate movement as a pan. Its raw
  // swipe command is now a repeated preset gesture and intentionally has no
  // duration field.
  await controlledMutation("swipe", () =>
    device.interactions.pan({
      ...base(),
      x: from.x,
      y: from.y,
      dx: to.x - from.x,
      dy: to.y - from.y,
      durationMs,
    }),
  );
}

export type AndroidTextPasteAdapter = {
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  paste: () => Promise<void>;
};

const ANDROID_IME_PACKAGES = new Set([
  "com.google.android.inputmethod.latin",
  "com.samsung.android.honeyboard",
  "com.touchtype.swiftkey",
  "com.microsoft.swiftkey",
]);

const ANDROID_SHELL_META = /[\\'"`$&;|<>()[\]{}*?!#~]/g;

/** Escape one logical text payload for agent-device's adb-shell fallback.
 * Spaces and line breaks remain logical here: agent-device owns their Android
 * `%s` and Enter translation after this remote-shell safety layer. */
export function escapeAndroidShellText(text: string): string {
  return text.replace(ANDROID_SHELL_META, "\\$&");
}

export function isAndroidClipboardTransportFailure(message: string): boolean {
  return /(?:Android clipboard|clipboard).*(?:not supported|unsupported|unavailable|failed|permission|security)|failed to .*Android clipboard/i.test(
    message,
  );
}

export function isAndroidProviderTextInjectionUnavailable(message: string): boolean {
  return /provider-native text injection|adb-shell fallback supports ASCII text only/i.test(
    message,
  );
}

/**
 * Build the small ADB contract needed by agent-device's clipboard helpers.
 *
 * This deliberately targets the serial explicitly instead of depending on an
 * agent-device session. A physical Android device can remain controllable
 * through ADB while its video/session transport is unavailable.
 */
function androidAdbExecutor(serial: string): AndroidAdbExecutor {
  return async (args, options = {}) => {
    try {
      const result = await execFileAsync("adb", ["-s", serial, ...args], {
        timeout: options.timeoutMs,
        signal: options.signal,
        maxBuffer: 20 * 1024 * 1024,
      });
      return {
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        stdoutBuffer: Buffer.from(result.stdout),
      };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };
      const stdout = String(failure.stdout ?? "");
      const stderr = String(failure.stderr ?? failure.message ?? "adb failed");
      return {
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        stdout,
        stderr,
        stdoutBuffer: Buffer.from(stdout),
      };
    }
  };
}

async function pasteAndroidTextWithAdb(text: string, serial: string): Promise<void> {
  const adb = androidAdbExecutor(serial);
  await pasteAndroidText(text, {
    readClipboard: () => readAndroidClipboardWithAdb(adb),
    writeClipboard: (value) => writeAndroidClipboardWithAdb(adb, value),
    paste: async () => {
      await raceCancel(
        execFileAsync("adb", ["-s", serial, "shell", "input", "keyevent", "KEYCODE_PASTE"]),
      );
    },
  });
}

/**
 * Paste exact Android text without routing it through `adb shell input text`.
 *
 * Android's shell command cannot reliably represent quotes, Unicode, or newlines.
 * The clipboard channel preserves the payload byte-for-byte; restoring the previous
 * value keeps a Relay action from unexpectedly replacing the person's clipboard.
 */
export async function pasteAndroidText(
  text: string,
  adapter: AndroidTextPasteAdapter,
): Promise<void> {
  let previousClipboard: string | undefined;
  try {
    previousClipboard = await adapter.readClipboard();
  } catch {
    // Clipboard reads can be restricted while writes and paste remain available.
  }

  await adapter.writeClipboard(text);
  try {
    await adapter.paste();
  } finally {
    if (previousClipboard !== undefined) {
      await adapter.writeClipboard(previousClipboard).catch(() => undefined);
    }
  }
}

/** Read the visible IME keys rather than guessing whether auto-capitalization
 * is active. SwiftKey exposes shifted letter keys as "capital A", while
 * common Android keyboards expose unshifted keys as one lowercase letter. */
export function androidKeyboardShifted(nodes: SnapshotNode[]): boolean | undefined {
  const labels = nodes
    .filter((node) => {
      const owner = node.bundleId?.toLowerCase();
      const identifierOwner = node.identifier?.split(":id/")[0]?.toLowerCase();
      return Boolean(
        (owner && ANDROID_IME_PACKAGES.has(owner)) ||
        (identifierOwner && ANDROID_IME_PACKAGES.has(identifierOwner)),
      );
    })
    .map((node) => node.label?.trim())
    .filter((label): label is string => Boolean(label));
  if (labels.some((label) => /^capital [a-z]$/i.test(label))) return true;
  if (labels.filter((label) => /^[a-z]$/.test(label)).length >= 8) return false;
  return undefined;
}

function firstCasedCharacter(text: string): string | undefined {
  return Array.from(text).find(
    (character) => character.toLocaleLowerCase() !== character.toLocaleUpperCase(),
  );
}

async function typeAndroidShellTextExactly(
  device: Device,
  serial: string,
  text: string,
): Promise<void> {
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const firstCased = firstCasedCharacter(line);
    if (firstCased && firstCased === firstCased.toLocaleLowerCase()) {
      const shifted = await snapshot(device)
        .then(androidKeyboardShifted)
        .catch(() => undefined);
      if (shifted) {
        await mutateCurrentTarget(() =>
          raceCancel(
            execFileAsync("adb", [
              "-s",
              serial,
              "shell",
              "input",
              "keyevent",
              "KEYCODE_SHIFT_LEFT",
            ]),
          ),
        );
      }
    }
    if (line) {
      await device.interactions.type({ ...base(), text: escapeAndroidShellText(line) });
    }
    if (index < lines.length - 1) {
      await mutateCurrentTarget(() =>
        raceCancel(
          execFileAsync("adb", ["-s", serial, "shell", "input", "keyevent", "KEYCODE_ENTER"]),
        ),
      );
    }
  }
}

export async function typeText(device: Device, text: string): Promise<void> {
  if (selectedPlatform() === "android") {
    // Test doubles and older agent-device clients may not expose clipboard
    // control. Keep their deterministic fallback while production Android
    // clients use paste so the IME cannot autocorrect or capitalize input.
    if (typeof device.command.clipboard !== "function") {
      const serial = targetIdentity();
      try {
        await controlled(() => mutateCurrentTarget(() => pasteAndroidTextWithAdb(text, serial)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isAndroidClipboardTransportFailure(message)) throw error;
        await controlled(() =>
          device.interactions.type({ ...base(), text: escapeAndroidShellText(text) }),
        );
      }
      return;
    }
    const serial = targetIdentity();
    try {
      await controlled(() =>
        pasteAndroidText(text, {
          readClipboard: async () => {
            const result = await device.command.clipboard({ ...base(), action: "read" });
            if (result.action !== "read") {
              throw new Error("clipboard read returned an unexpected result");
            }
            return result.text;
          },
          writeClipboard: async (value) => {
            await device.command.clipboard({ ...base(), action: "write", text: value });
          },
          paste: async () => {
            await mutateCurrentTarget(() =>
              raceCancel(
                execFileAsync("adb", ["-s", serial, "shell", "input", "keyevent", "KEYCODE_PASTE"]),
              ),
            );
          },
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Physical Android devices commonly expose the clipboard command but
      // reject writes from an external uid (especially while a secure IME or
      // work profile is active). That is a transport limitation, not a reason
      // to make the whole interaction unusable. Fall back to the platform's
      // input channel for clipboard command failures while still surfacing
      // cancellation and unrelated session errors.
      if (isAndroidProviderTextInjectionUnavailable(message)) {
        try {
          await controlled(() => mutateCurrentTarget(() => pasteAndroidTextWithAdb(text, serial)));
          return;
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          if (!isAndroidClipboardTransportFailure(fallbackMessage)) throw fallbackError;
        }
      }
      if (!isAndroidClipboardTransportFailure(message)) throw error;
      await controlled(() => typeAndroidShellTextExactly(device, serial, text));
    }
    return;
  }
  await controlledMutation("type", () => device.interactions.type({ ...base(), text }));
}

export async function pressKey(device: Device, key: "back" | "home"): Promise<void> {
  if (key === "back") {
    await controlledMutation("back", () => device.command.back({ ...base() }));
  } else {
    await controlledMutation("home", () => device.command.home({ ...base() }));
  }
}

export async function pressRef(
  device: Device,
  ref: string,
  repeated?: RepeatedPress,
): Promise<void> {
  const normalized = ref.startsWith("@") ? ref : `@${ref}`;
  await controlledMutation("press", () =>
    device.interactions.press({ ...base(), ref: normalized, ...repeated }),
  );
}

export async function pressText(
  device: Device,
  text: string,
  repeated?: RepeatedPress,
): Promise<void> {
  try {
    await controlledMutation("press", () =>
      device.interactions.press({
        ...base(),
        selector: `label*="${text.replaceAll('"', '\\"')}"`,
        ...iosNonHittablePressFields(),
        ...repeated,
      } as never),
    );
  } catch (error) {
    const point = await iosSnapshotFallbackPoint(device, { text }, error);
    await pressPoint(device, point.x, point.y, repeated);
  }
}

export async function replaceText(
  device: Device,
  target: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  },
  text: string,
): Promise<void> {
  const interactionTarget = target.identifier
    ? { selector: `id="${target.identifier.replaceAll('"', '\\"')}"` }
    : target.ref
      ? { ref: target.ref.startsWith("@") ? target.ref : `@${target.ref}` }
      : target.label
        ? { selector: `label="${target.label.replaceAll('"', '\\"')}"` }
        : target.text
          ? { selector: `label*="${target.text.replaceAll('"', '\\"')}"` }
          : target.point
            ? { x: target.point.x, y: target.point.y }
            : undefined;
  if (!interactionTarget) throw new Error("replace text requires a target");

  // Android's accessibility fill is not consistently a replacement operation.
  // Compose fields in particular may preserve the existing value and append the
  // new text, even though the command succeeds. Make replacement deterministic
  // at the input boundary: focus the target, clear it with native key events,
  // then use the normal exact-text path for the new value.
  if (selectedPlatform() === "android") {
    await controlledMutation("press", () =>
      device.interactions.press({ ...base(), ...interactionTarget }),
    );
    await clearAndroidFocusedText(targetIdentity());
    if (text.length > 0) await typeText(device, text);
    return;
  }

  await replaceTextValue(text, {
    fill: async (value) => {
      try {
        await controlledMutation("fill", () =>
          device.interactions.fill({ ...base(), ...interactionTarget, text: value }),
        );
      } catch (error) {
        const point = await iosSnapshotFallbackPoint(device, target, error);
        await controlledMutation("fill", () =>
          device.interactions.fill({ ...base(), x: point.x, y: point.y, text: value }),
        );
      }
    },
    type: async (value) => {
      await controlledMutation("type", () => device.interactions.type({ ...base(), text: value }));
    },
  });
}

async function clearAndroidFocusedText(serial: string): Promise<void> {
  // Android's MOVE_END is line-aware: on a multiline Compose field it lands at
  // the end of the current line, which leaves later lines behind. Move to the
  // beginning of the current line, walk to the top, then move to the beginning
  // of the whole value before deleting forward.
  await clearAndroidTextWithAdb(serial, getExecutingJobId());
}

export type TextReplacementAdapter = {
  fill: (text: string) => Promise<void>;
  type: (text: string) => Promise<void>;
};

/**
 * Replace a field even when the desired value is empty.
 *
 * agent-device deliberately rejects an empty fill at its public boundary.
 * Replacing with one harmless character and deleting it uses the same native
 * text events a person produces and avoids platform-specific select-all logic.
 */
export async function replaceTextValue(
  text: string,
  adapter: TextReplacementAdapter,
): Promise<void> {
  if (text.length > 0) {
    await adapter.fill(text);
    return;
  }
  await adapter.fill("x");
  await adapter.type("\b");
}

export async function findClick(
  device: Device,
  query: string,
  opts?: { first?: boolean; last?: boolean },
): Promise<void> {
  try {
    await controlledMutation("press", () =>
      device.interactions.find({
        ...base(),
        query,
        action: "click",
        first: opts?.first ?? true,
        last: opts?.last,
        ...iosNonHittablePressFields(),
      } as never),
    );
  } catch (error) {
    const point = await iosSnapshotFallbackPoint(device, { text: query }, error).catch(
      async (err) => iosSnapshotFallbackPoint(device, { label: query }, err),
    );
    await pressPoint(device, point.x, point.y);
  }
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
  await controlledMutation("scroll", () =>
    device.interactions.scroll({
      ...base(),
      direction: "down",
      amount,
    }),
  );
}

/** Scroll toward earlier content using the same SDK semantics as scrollDown. */
export async function scrollUp(device: Device, amount = 0.5): Promise<void> {
  await controlledMutation("scroll", () =>
    device.interactions.scroll({
      ...base(),
      direction: "up",
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

export async function pressResolvedControl(
  device: Device,
  resolution: NamedControlResolution,
  target: NamedControlTarget,
  repeated?: RepeatedPress,
): Promise<NamedControlResolution> {
  // Only resolutions with current-tree evidence that their native selector is
  // untrustworthy opt out. Stable identifiers and labels keep their stronger
  // selector-first behavior.
  if (resolution.activation === "snapshot-point") {
    await pressPoint(device, resolution.point.x, resolution.point.y, repeated);
    return resolution;
  }
  if (resolution.method === "identifier" && target.identifier?.trim()) {
    try {
      await pressIdentifier(device, target.identifier, repeated);
    } catch (error) {
      if (!canUseSemanticPointFallback(error)) throw error;
      await pressPoint(device, resolution.point.x, resolution.point.y, repeated);
    }
    return resolution;
  }
  if (resolution.method === "label" && target.label?.trim()) {
    try {
      await pressLabel(device, target.label, repeated);
    } catch (error) {
      if (!canUseSemanticPointFallback(error)) throw error;
      await pressPoint(device, resolution.point.x, resolution.point.y, repeated);
    }
    return resolution;
  }
  if (resolution.method === "text" && target.text?.trim()) {
    await pressMatchingText(device, target.text);
    return resolution;
  }
  await pressPoint(device, resolution.point.x, resolution.point.y, repeated);
  return resolution;
}

function semanticSelectorDidNotMatch(error: unknown): boolean {
  if (error instanceof Error && error.name === "JobCancelledError") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /\bno match\b|did not match|element not found|selector.*not.*element|(?:native\s+)?(?:label|identifier)(?:\s+selector)?\s+unavailable/i.test(
    message,
  );
}

function canUseSemanticPointFallback(error: unknown): boolean {
  return selectedPlatform() === "ios"
    ? iosSelectorWasNotDispatched(error)
    : semanticSelectorDidNotMatch(error);
}

/** agent-device reports every Android package transition after a coordinate
 * fallback as an escaped tap. Accept one only when the authored semantic
 * control declares the exact expected destination package. */
export function androidNamedPressCompletedHandoff(
  error: unknown,
  target: NamedControlTarget,
): boolean {
  if (selectedPlatform() !== "android") return false;
  if (!target.identifier?.trim() && !target.label?.trim() && !target.text?.trim()) return false;
  const message = error instanceof Error ? error.message : String(error);
  const handoff = /press coordinate tap left\s+(\S+)\s+and foregrounded\s+(\S+)/i.exec(message);
  const destination = handoff?.[2]?.replace(/[.,;:]+$/, "");
  if (!destination || destination === handoff?.[1]) return false;
  return Boolean(target.expectedApp?.trim() && destination === target.expectedApp.trim());
}

/** Snapshot → resolveNamedControl → press. Used by recipe taps, mouse interact, and CLI. */
export async function pressNamedControl(
  device: Device,
  target: NamedControlTarget,
  repeated?: RepeatedPress,
): Promise<NamedControlResolution> {
  const pointOnly = explicitPointResolution(target.point);
  const hasNamed = Boolean(
    target.identifier?.trim() || target.label?.trim() || target.text?.trim(),
  );
  if (pointOnly && !hasNamed) {
    await pressPoint(device, pointOnly.point.x, pointOnly.point.y, repeated);
    return pointOnly;
  }
  let nodes: SnapshotNode[];
  try {
    nodes = await snapshot(device);
  } catch (error) {
    if (pointOnly) {
      await pressPoint(device, pointOnly.point.x, pointOnly.point.y, repeated);
      return pointOnly;
    }
    throw error;
  }
  if (!nodes.length && pointOnly) {
    await pressPoint(device, pointOnly.point.x, pointOnly.point.y, repeated);
    return pointOnly;
  }
  const resolved = resolveNamedControl(nodes, target);
  if (!resolved) {
    throw new Error("no unique control matched identifier, label, text, or point");
  }
  try {
    return await pressResolvedControl(device, resolved, target, repeated);
  } catch (error) {
    if (androidNamedPressCompletedHandoff(error, target)) return resolved;
    throw error;
  }
}

function canUseIosSnapshotCoordinateFallback(error: unknown): boolean {
  if (selectedPlatform() !== "ios") return false;
  return iosSelectorWasNotDispatched(error);
}

async function iosSnapshotFallbackPoint(
  device: Device,
  target: SemanticSnapshotTarget,
  error: unknown,
  knownPoint?: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  if (!canUseIosSnapshotCoordinateFallback(error)) throw error;
  const point = knownPoint ?? resolveSnapshotTargetPoint(await snapshot(device), target);
  if (!point) throw error;
  return point;
}

export async function pressMatchingText(device: Device, match: string): Promise<void> {
  // Prefer selector + native non-hittable coordinate fallback (one round-trip).
  // Snapshot-derived x/y are supplied so the runner taps the row center even when
  // XCTest refuses element.activate() on SwiftUI list cells.
  const nodes = await snapshot(device);
  const point =
    resolveSnapshotTargetPoint(nodes, { text: match }) ??
    resolveSnapshotTargetPoint(nodes, { label: match });
  try {
    await controlledMutation("press", () =>
      device.interactions.press({
        ...base(),
        selector: `label*="${match.replaceAll('"', '\\"')}"`,
        ...iosNonHittablePressFields(point),
      } as never),
    );
    return;
  } catch (error) {
    if (error instanceof Error && error.name === "JobCancelledError") throw error;
    if (selectedPlatform() === "ios" && !canUseIosSnapshotCoordinateFallback(error)) {
      throw error;
    }
  }

  if (await exists(device, match)) {
    try {
      await findClick(device, match);
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "JobCancelledError") throw err;
      // `findClick` may already have sent its own native iOS command. Only a
      // selector rejection proven to be pre-dispatch may reach the older
      // snapshot/point resolver below; an acknowledgement loss must stay a
      // terminal review boundary rather than becoming a second coordinate tap.
      if (selectedPlatform() === "ios" && !canUseIosSnapshotCoordinateFallback(err)) {
        throw err;
      }
    }
  }

  const textNode = nodesMatch(nodes, match);
  if (!textNode?.rect && !point) {
    throw new Error(`No UI node matching "${match}"`);
  }

  if (point) {
    await pressPoint(device, point.x, point.y);
    return;
  }

  const { x: tx, y: ty, width: tw, height: th } = textNode!.rect!;
  let best: { area: number; x: number; y: number; width: number; height: number } | undefined;

  for (const n of nodes) {
    const role = (n.role ?? n.type ?? "").toLocaleLowerCase();
    const interactive =
      n.hittable || (selectedPlatform() === "ios" && INTERACTIVE_SNAPSHOT_ROLES.has(role));
    if (!interactive || !n.rect) continue;
    const { x, y, width, height } = n.rect;
    if (x <= tx && y <= ty && x + width >= tx + tw && y + height >= ty + th && width >= 400) {
      const area = width * height;
      if (!best || area < best.area) {
        best = { area, x, y, width, height };
      }
    }
  }

  const rect = best ?? textNode!.rect!;
  const p = center(rect);
  await pressPoint(device, p.x, p.y);
}

export async function anyExists(device: Device, queries: string[]): Promise<string | undefined> {
  for (const q of queries) {
    if (await exists(device, q)) return q;
  }
  return undefined;
}

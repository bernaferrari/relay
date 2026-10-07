/**
 * Thin agent-device SDK helpers.
 * Pattern: open → snapshot/find → press → re-check. Failures throw.
 * All long waits honor job cancel/pause via control.ts.
 */
import { createAgentDeviceClient } from "agent-device";
import {
  cooperativeCheckpoint,
  getExecutingJobId,
  raceCancel,
  throwIfCancelled,
} from "./control.js";
import { runTargetMutation } from "./target-control.js";
import { bindNativeDeviceMutations } from "./device-mutation-adapter.js";
import { execAndroidAdb } from "./android-adb-host.js";
import { type Device, type SnapshotNode } from "./device-capabilities.js";
import * as observationDevice from "./device-observation-membrane.js";
export type { Device, SnapshotNode } from "./device-capabilities.js";
import {
  base,
  controlled,
  controlledMutation,
  iosNonHittablePressFields,
  nativeDevice,
  type DeviceTransport,
} from "./device-dispatch.js";
import { type DeviceTextInputDependencies, typeDeviceText } from "./device-android-text.js";
import { typeViaLiveIosListener } from "./device-text-entry.js";
import {
  boundedAndroidTextEntrySnapshot,
  type AndroidTextEntryReceipt,
} from "./android-text-entry-verification.js";
export {
  androidKeyboardShifted,
  escapeAndroidShellText,
  isAndroidClipboardTransportFailure,
  isAndroidProviderTextInjectionUnavailable,
  pasteAndroidText,
} from "./device-android-text.js";
export type { AndroidTextPasteAdapter } from "./device-android-text.js";
export { base } from "./device-dispatch.js";
import {
  currentTargetContext,
  selectedPlatform,
  targetIdentity,
  targetSessionName,
  type TargetContext,
} from "./target-context.js";
import { iosSelectorWasNotDispatched, runIosMutationOnce } from "./ios-mutation-policy.js";
import {
  identifierNodesViaLiveIosRunnerListener,
  isIosSessionMissingSnapshotError,
  labelNodesViaLiveIosRunnerListener,
  snapshotFromLiveIosRunnerListenerIfReady,
  tapViaLiveIosRunnerListener,
} from "./ios-runner-listener-command.js";
import { probeLiveIosRunnerListener } from "./ios-runner-listener.js";
import {
  isPhysicalRunnerRoute,
  isSimulatorSdkRoute,
  resolveAppleControlRoute,
} from "./apple-control-route.js";
import { buildDeviceTransport } from "./device-client-bindings.js";
import {
  clipboardCopy as copyDeviceClipboard,
  clipboardPaste as pasteDeviceClipboard,
  type ClipboardTarget,
} from "./device-clipboard.js";
export { clipboardRead, clipboardWrite } from "./device-clipboard.js";
import {
  targetKey,
  rememberedTargetApplication,
  rememberTargetApplication,
} from "./device-target-applications.js";
export {
  rememberedTargetApplication,
  rememberTargetApplication,
} from "./device-target-applications.js";
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
  IosSnapshotRunnerWedgedError,
  IosSnapshotTimedOutError,
  isIosAccessibilityQueryInFlightError,
} from "./ios-snapshot-flight.js";
export { selectedPlatform } from "./target-context.js";
export * from "./android-app-build.js";
import { captureNativeCrashEvidence } from "./crash-evidence.js";
import { openPhysicalIosApp } from "./ios-app-open.js";
import { namedControlObservationOptions } from "./named-control-observation.js";
import { pressResolvedControl } from "./device-resolved-control.js";
export { pressResolvedControl } from "./device-resolved-control.js";
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
const devicesByTarget = new Map<string, Device>();
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
    device = buildDeviceTransport(
      native as unknown as Parameters<typeof buildDeviceTransport>[0],
      context,
    );
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
  opts?: {
    interactiveOnly?: boolean;
    raw?: boolean;
    timeoutMs?: number;
    /** Override the normal read retry budget for latency-sensitive callers. */
    retryAttempts?: number;
    includeIdentifiers?: readonly string[];
    includeLabels?: readonly string[];
    requestedChromeOnly?: boolean;
    controlBoundsOnlyForApp?: string;
  },
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
  const appleRoute = resolveAppleControlRoute(context);
  if (context?.kind === "device" && context.platform === "ios") {
    // Recipes already press/type through the adopted testCommand listener.
    // Recapture / observe / screen-capture must use that same usbmux path.
    // The bounded SDK probe looks at Relay’s Copy-probe session, not the
    // LISTENER_READY runner — adopt first, and do not recover-kill it.
    // Simulators have no usbmux; their live runner lease must route through
    // the SDK session below instead.
    const adopted = isPhysicalRunnerRoute(appleRoute)
      ? await snapshotFromLiveIosRunnerListenerIfReady(context, opts)
      : undefined;
    if (adopted !== undefined) return adopted;
    try {
      return await captureIosSnapshot(
        context,
        opts?.interactiveOnly ?? false,
        run,
        opts?.timeoutMs,
      );
    } catch (error) {
      if (!isIosSessionMissingSnapshotError(error)) throw error;
      throw new Error("iOS snapshot needs an active XCTest session");
    }
  }
  const result = await controlled(
    run,
    opts?.retryAttempts !== undefined ? { attempts: opts.retryAttempts } : {},
  );
  return (result.nodes ?? []) as SnapshotNode[];
}

export type LaunchResult = {
  launch: "completed" | "not-dispatched" | "outcome-unknown";
  semanticSession: "attached" | "unavailable" | "not-requested";
};

export async function openApp(
  device: Device,
  app: string,
  opts?: { relaunch?: boolean },
): Promise<LaunchResult> {
  const context = currentTargetContext();
  const appleRoute = resolveAppleControlRoute(context);
  if (isPhysicalRunnerRoute(appleRoute) && context.kind === "device") {
    // Sidecar launch is the one activation. There is no supported
    // non-activating SDK attach for physical devices, so do not disguise a
    // second `apps.open` as session binding — that can foreground the app
    // again and swallow attachment failure.
    await openPhysicalIosApp({
      context,
      app,
      relaunch: opts?.relaunch ?? true,
      rememberApplication: rememberTargetApplication,
    });
    return { launch: "completed", semanticSession: "not-requested" };
  }
  const opened = await controlledMutation("app-open", () =>
    nativeDevice(device).apps.open({
      ...base(),
      app,
      relaunch: opts?.relaunch ?? true,
    }),
  );
  await rememberTargetApplication(opened.appBundleId ?? opened.appId ?? app);
  if (!isSimulatorSdkRoute(appleRoute)) await sleep(2000, device);
  return { launch: "completed", semanticSession: "attached" };
}

/**
 * Rebind an Android SDK session to the package that already owns the visible
 * pixels. This is intentionally separate from `openApp`: evidence/AX repair
 * must not inject its normal post-launch delay or an unrelated relaunch.
 */
export async function bindAndroidAppSession(
  device: Device,
  app: string,
  serial?: string,
): Promise<void> {
  await controlledMutation("app-open", () =>
    nativeDevice(device).apps.open({
      platform: "android",
      ...(serial ? { serial } : {}),
      app,
      relaunch: false,
      noRecord: true,
    } as never),
  );
}

/**
 * Simulator/emulator boot is a target operation, never a workflow primitive.
 * Keep its raw SDK access inside the dispatcher so callers cannot acquire the
 * native transport merely to start a device.
 */
export async function bootTarget(
  device: Device,
  options: Parameters<DeviceTransport["devices"]["boot"]>[0],
): Promise<unknown> {
  return await nativeDevice(device).devices.boot(options);
}

/** Runner setup is host-side preparation, not a user-input gesture. */
export async function prepareDeviceRunner(
  device: Device,
  options: Parameters<DeviceTransport["command"]["prepare"]>[0],
): Promise<unknown> {
  return await nativeDevice(device).command.prepare(options);
}

export type DeviceRecordingOptions = Parameters<DeviceTransport["recording"]["record"]>[0];
export type DeviceRecordingResult = {
  [key: string]: unknown;
  started?: boolean;
  stopped?: boolean;
  warning?: string;
  path?: string;
};

/**
 * Record an evidence take through the same exact-once mutation policy as every
 * other physical iOS command. Android retains its explicit retry contract.
 */
export async function recordDeviceVideo(
  device: Device,
  options: DeviceRecordingOptions,
  /** Physical iOS adapters pass their verified UDID instead of relying on ambient context. */
  iosSerial?: string,
): Promise<DeviceRecordingResult> {
  const record = () => nativeDevice(device).recording.record(options);
  return await (iosSerial
    ? runIosMutationOnce(iosSerial, "video", record)
    : controlledMutation("video", record));
}

export async function openUrl(device: Device, url: string): Promise<void> {
  await controlledMutation("url-open", () => nativeDevice(device).apps.open({ ...base(), url }));
  await sleep(2500, device);
}

export type RepeatedPress = {
  count?: number;
  intervalMs?: number;
  doubleTap?: boolean;
};

async function pressViaLiveIosListener(
  selectorKey: "label" | "id",
  selectorValue: string,
): Promise<boolean> {
  if (selectedPlatform() !== "ios") return false;
  let context: ReturnType<typeof currentTargetContext>;
  try {
    context = currentTargetContext();
  } catch {
    return false;
  }
  const pressRoute = resolveAppleControlRoute(context);
  if (!isPhysicalRunnerRoute(pressRoute)) return false;
  const live = await probeLiveIosRunnerListener(pressRoute.udid);
  if (!live) return false;
  const appBundleId = await rememberedTargetApplication(context);
  // One usbmux tap on the LISTENER_READY runner. Do not also dispatch through
  // the unbound SDK session — that is a second press with unknown outcome.
  await controlledMutation("press", () =>
    tapViaLiveIosRunnerListener({
      serial: pressRoute.udid,
      selectorKey,
      selectorValue,
      ...(appBundleId ? { appBundleId } : {}),
    }),
  );
  return true;
}

export async function pressLabel(
  device: Device,
  label: string,
  repeated?: RepeatedPress,
  heading?: string,
): Promise<void> {
  const scopedHeading = heading?.trim();
  // Native label selectors cannot see an ancestor heading, so skip the iOS
  // listener when a heading scopes an otherwise ambiguous label.
  if (!scopedHeading && (await pressViaLiveIosListener("label", label))) return;
  const semantic = { label, ...(scopedHeading ? { heading: scopedHeading } : {}) };
  const point = resolveSnapshotTargetPoint(await snapshot(device), semantic);
  try {
    await controlledMutation("press", () =>
      nativeDevice(device).interactions.press({
        ...base(),
        selector: `label="${label.replaceAll('"', '\\"')}"`,
        ...(scopedHeading ? { heading: scopedHeading } : {}),
        ...iosNonHittablePressFields(point),
        ...repeated,
      } as never),
    );
  } catch (error) {
    if (selectedPlatform() === "android" && !iosSelectorWasNotDispatched(error)) throw error;
    const fallback =
      selectedPlatform() === "ios"
        ? await iosSnapshotFallbackPoint(device, semantic, error, point)
        : (point ?? (await iosSnapshotFallbackPoint(device, semantic, error)));
    await pressPoint(device, fallback.x, fallback.y, repeated);
  }
}

export async function pressIdentifier(
  device: Device,
  identifier: string,
  repeated?: RepeatedPress,
): Promise<void> {
  if (await pressViaLiveIosListener("id", identifier)) return;
  const point = resolveSnapshotTargetPoint(await snapshot(device), { identifier });
  try {
    await controlledMutation("press", () =>
      nativeDevice(device).interactions.press({
        ...base(),
        selector: `id="${identifier.replaceAll('"', '\\"')}"`,
        ...iosNonHittablePressFields(point),
        ...repeated,
      } as never),
    );
  } catch (error) {
    if (selectedPlatform() === "android" && !iosSelectorWasNotDispatched(error)) throw error;
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
  if (selectedPlatform() === "ios" && !repeated) {
    const context = currentTargetContext();
    const pressRoute = resolveAppleControlRoute(context);
    if (isPhysicalRunnerRoute(pressRoute)) {
      const live = await probeLiveIosRunnerListener(pressRoute.udid);
      if (live) {
        const appBundleId = await rememberedTargetApplication(context);
        await controlledMutation("press", () =>
          tapViaLiveIosRunnerListener({
            serial: pressRoute.udid,
            point: { x, y },
            ...(appBundleId ? { appBundleId } : {}),
          }),
        );
        return;
      }
    }
  }
  await controlledMutation("press", () =>
    nativeDevice(device).interactions.press({
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
      nativeDevice(device).interactions.longPress({
        ...base(),
        selector: `id="${target.identifier!.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
  } else if (target.ref) {
    await controlledMutation("long-press", () =>
      nativeDevice(device).interactions.longPress({
        ...base(),
        ref: target.ref!.startsWith("@") ? target.ref! : `@${target.ref!}`,
        durationMs,
      }),
    );
  } else if (target.label) {
    const label = target.label;
    await controlledMutation("long-press", () =>
      nativeDevice(device).interactions.longPress({
        ...base(),
        selector: `label="${label.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
  } else if (target.text) {
    const text = target.text;
    await controlledMutation("long-press", () =>
      nativeDevice(device).interactions.longPress({
        ...base(),
        selector: `label*="${text.replaceAll('"', '\\"')}"`,
        durationMs,
      }),
    );
  } else if (target.point) {
    await controlledMutation("long-press", () =>
      nativeDevice(device).interactions.longPress({
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

async function focusClipboardTarget(device: Device, target: ClipboardTarget): Promise<void> {
  if (target.identifier) return pressIdentifier(device, target.identifier);
  if (target.ref) return pressRef(device, target.ref);
  if (target.label) return pressLabel(device, target.label);
  if (target.text) return pressText(device, target.text);
  if (target.point) return pressPoint(device, target.point.x, target.point.y);
  throw new Error("clipboard copy/paste requires an identifier, label, or text target");
}

export function clipboardPaste(
  device: Device,
  text: string,
  target: ClipboardTarget,
): Promise<string> {
  return pasteDeviceClipboard(device, text, target, focusClipboardTarget);
}

export function clipboardCopy(
  device: Device,
  target: ClipboardTarget,
  expectedText?: string,
): Promise<string> {
  return copyDeviceClipboard(device, target, expectedText, focusClipboardTarget);
}

export async function closeApp(device: Device, app?: string): Promise<void> {
  await controlledMutation("app-close", () =>
    nativeDevice(device).apps.close({ ...base(), ...(app ? { app } : {}) }),
  );
}

export async function openAppSwitcher(device: Device): Promise<void> {
  await controlledMutation("app-switcher", () =>
    nativeDevice(device).command.appSwitcher({ ...base() }),
  );
}

export async function rotateDevice(
  device: Device,
  orientation: "portrait" | "portrait-upside-down" | "landscape-left" | "landscape-right",
): Promise<void> {
  await controlledMutation("rotate", () =>
    nativeDevice(device).command.orientation({ ...base(), orientation }),
  );
}

export async function keyboardAction(device: Device, action: "dismiss" | "enter"): Promise<void> {
  await controlledMutation("keyboard", () =>
    nativeDevice(device).command.keyboard({ ...base(), action }),
  );
}

export async function alertAction(
  device: Device,
  action: "get" | "accept" | "dismiss" | "wait",
  timeoutMs?: number,
): Promise<unknown> {
  const op = () =>
    nativeDevice(device).command.alert({
      ...base(),
      action,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  return await (action === "get" || action === "wait"
    ? controlled(op)
    : controlledMutation("alert", op));
}

export async function updateSetting(
  device: Device,
  input: Parameters<DeviceTransport["settings"]["update"]>[0],
): Promise<unknown> {
  return await controlledMutation("settings", () => nativeDevice(device).settings.update(input));
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
  await mutateCurrentTarget(() => raceCancel(execAndroidAdb(args)));
  if (action === "unlock") {
    await mutateCurrentTarget(() =>
      raceCancel(execAndroidAdb(["-s", serial, "shell", "input", "keyevent", "82"])),
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
    nativeDevice(device).interactions.pan({
      ...base(),
      x: from.x,
      y: from.y,
      dx: to.x - from.x,
      dy: to.y - from.y,
      durationMs,
    }),
  );
}

export async function typeText(
  device: Device,
  text: string,
): Promise<AndroidTextEntryReceipt | undefined> {
  const dependencies: DeviceTextInputDependencies = {
    snapshot: (target) =>
      boundedAndroidTextEntrySnapshot(() =>
        snapshot(target, { raw: true, timeoutMs: 3000, retryAttempts: 1 }),
      ),
    mutateCurrentTarget,
    typeViaLiveIosListener,
  };
  return typeDeviceText(device, text, dependencies);
}

export async function pressKey(device: Device, key: "back" | "home" | "recents"): Promise<void> {
  if (key === "recents") {
    if (currentTargetContext().kind === "browser" || selectedPlatform() !== "android") {
      throw new Error("Recents is only available on Android devices.");
    }
    const serial = targetIdentity();
    await controlled(() =>
      mutateCurrentTarget(() =>
        raceCancel(
          execAndroidAdb(["-s", serial, "shell", "input", "keyevent", "KEYCODE_APP_SWITCH"]),
        ),
      ),
    );
    return;
  }
  if (key === "back") {
    await controlledMutation("back", () => nativeDevice(device).command.back({ ...base() }));
  } else {
    await controlledMutation("home", () => nativeDevice(device).command.home({ ...base() }));
  }
}

export async function pressRef(
  device: Device,
  ref: string,
  repeated?: RepeatedPress,
): Promise<void> {
  const normalized = ref.startsWith("@") ? ref : `@${ref}`;
  await controlledMutation("press", () =>
    nativeDevice(device).interactions.press({ ...base(), ref: normalized, ...repeated }),
  );
}

export async function pressText(
  device: Device,
  text: string,
  repeated?: RepeatedPress,
): Promise<void> {
  try {
    await controlledMutation("press", () =>
      nativeDevice(device).interactions.press({
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

export { replaceText, replaceTextValue, type TextReplacementAdapter } from "./device-text-entry.js";

export async function findClick(
  device: Device,
  query: string,
  opts?: { first?: boolean; last?: boolean },
): Promise<void> {
  try {
    await controlledMutation("press", () =>
      nativeDevice(device).interactions.find({
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
    nativeDevice(device).interactions.scroll({
      ...base(),
      direction: "down",
      amount,
    }),
  );
}

/** Scroll toward earlier content using the same SDK semantics as scrollDown. */
export async function scrollUp(device: Device, amount = 0.5): Promise<void> {
  await controlledMutation("scroll", () =>
    nativeDevice(device).interactions.scroll({
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
    nodes = await snapshot(device, namedControlObservationOptions(target, selectedPlatform()));
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
  let resolved = resolveNamedControl(nodes, target);
  // A fresh proof context (fixture lanes mint one per operation) can serve
  // its accessibility tree a beat after the page is interactive. A first
  // grounding miss on a browser is therefore retried briefly before it is
  // declared final — the tap must not silently no-op on a page that merely
  // was not semantic-ready yet.
  const context = currentTargetContext();
  const browserGroundingRetry = context.kind === "browser";
  const groundingDeadline = performance.now() + 3_000;
  while (!resolved && browserGroundingRetry && performance.now() < groundingDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    nodes = await snapshot(device, {
      ...(target.identifier?.trim() ? { includeIdentifiers: [target.identifier] } : {}),
      ...(target.label?.trim() ? { includeLabels: [target.label] } : {}),
    });
    resolved = resolveNamedControl(nodes, target);
  }
  if (!resolved && target.identifier?.trim() && selectedPlatform() === "ios") {
    try {
      const iosContext = currentTargetContext();
      if (iosContext.kind === "device" && iosContext.platform === "ios") {
        const extra = await identifierNodesViaLiveIosRunnerListener({
          serial: iosContext.serial,
          identifier: target.identifier,
          appBundleId: await rememberedTargetApplication(iosContext),
        });
        if (extra?.length) resolved = resolveNamedControl(extra, { identifier: target.identifier });
      }
    } catch {
      // Keep the chrome-bounded miss. Do not invent a point.
    }
  }
  if (!resolved && target.label?.trim() && selectedPlatform() === "ios") {
    try {
      const iosContext = currentTargetContext();
      if (iosContext.kind === "device" && iosContext.platform === "ios") {
        const extra = await labelNodesViaLiveIosRunnerListener({
          serial: iosContext.serial,
          label: target.label,
          appBundleId: await rememberedTargetApplication(iosContext),
        });
        if (extra?.length) resolved = resolveNamedControl(extra, { label: target.label });
      }
    } catch {
      // Keep the chrome-bounded miss. Do not invent a point.
    }
  }
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

export async function iosSnapshotFallbackPoint(
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
      nativeDevice(device).interactions.press({
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
  // An enclosing row must span (nearly) the full viewport width. The old
  // absolute `width >= 400` only matched iPad-class geometry; a relative
  // threshold lets iPhone rows qualify while still rejecting narrow inline
  // chips. Falls back to the historical absolute floor when no viewport
  // root is present in the tree.
  const applicationWidth = nodes.find(
    (node) => (node.type ?? node.role)?.toLocaleLowerCase() === "application",
  )?.rect?.width;
  const windowWidth = nodes.find(
    (node) => (node.type ?? node.role)?.toLocaleLowerCase() === "window",
  )?.rect?.width;
  const viewportWidth = applicationWidth ?? windowWidth;
  // No viewport root: keep the historical absolute floor of 400pt.
  const minContainerWidth = viewportWidth === undefined ? 400 : Math.max(400, viewportWidth * 0.9);
  let best: { area: number; x: number; y: number; width: number; height: number } | undefined;

  for (const n of nodes) {
    const role = (n.role ?? n.type ?? "").toLocaleLowerCase();
    const interactive =
      n.hittable || (selectedPlatform() === "ios" && INTERACTIVE_SNAPSHOT_ROLES.has(role));
    if (!interactive || !n.rect) continue;
    const { x, y, width, height } = n.rect;
    if (
      x <= tx &&
      y <= ty &&
      x + width >= tx + tw &&
      y + height >= ty + th &&
      width >= minContainerWidth
    ) {
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

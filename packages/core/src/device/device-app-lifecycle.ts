/**
 * App/session lifecycle operations split out of device.ts: app open, session
 * rebind, target boot, runner preparation, and evidence video capture. None
 * of these are user-input gestures, so they share no code with the control
 * activation family and depend only on the dispatcher primitives.
 */
import { base, controlledMutation, nativeDevice, type DeviceTransport } from "./device-dispatch.js";
import type { Device } from "./device.js";
import { currentTargetContext } from "../target/target-context.js";
import {
  isPhysicalRunnerRoute,
  isSimulatorSdkRoute,
  resolveAppleControlRoute,
} from "../apple/apple-control-route.js";
import { openPhysicalIosApp } from "../ios/ios-app-open.js";
import { runIosMutationOnce } from "../ios/ios-mutation-policy.js";
import { rememberTargetApplication } from "./device-target-applications.js";
import { sleep } from "./device-system-actions.js";

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

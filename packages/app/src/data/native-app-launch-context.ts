import type { AuthoringTarget } from "@relay/protocol";
import type { DeviceProductService, ProductLaunchedApp } from "./device-product-service";

type NativeAppLaunchContext = Readonly<{
  serial: string;
  platform: "ios" | "android";
  originApplication: string;
  observedApplication?: string;
  launchedAt: number;
}>;

// A transient handoff of a canonical operation result, never persisted URL or
// editable Test data. Each mounted service owns its transport identity.
const contexts = new WeakMap<DeviceProductService, Map<string, NativeAppLaunchContext>>();
export const NATIVE_APP_LAUNCH_HANDOFF_MAX_AGE_MS = 120_000;

export function forgetNativeAppLaunch(service: DeviceProductService, serial: string): void {
  contexts.get(service)?.delete(serial);
}

export function rememberNativeAppLaunch(
  service: DeviceProductService,
  result: ProductLaunchedApp,
): void {
  forgetNativeAppLaunch(service, result.serial);
  if (
    !result.observed?.matched ||
    !result.serial.trim() ||
    !result.app.trim() ||
    !Number.isFinite(result.launchedAt) ||
    result.launchedAt <= 0 ||
    (result.platform !== "ios" && result.platform !== "android")
  )
    return;
  let owned = contexts.get(service);
  if (!owned) contexts.set(service, (owned = new Map()));
  owned.set(
    result.serial,
    Object.freeze({
      serial: result.serial,
      platform: result.platform,
      originApplication: result.app.trim(),
      ...(result.observed.app ? { observedApplication: result.observed.app } : {}),
      launchedAt: result.launchedAt,
    }),
  );
}

/** An app string alone cannot prove foreground. Consume only the exact
 * acknowledged Device-page launch for this native target and application. */
export function takeNativeAppLaunch(
  service: DeviceProductService,
  target: AuthoringTarget | undefined,
  originApplication: string,
  now = Date.now(),
): NativeAppLaunchContext | undefined {
  if (target?.kind !== "device") return;
  const owned = contexts.get(service);
  const context = owned?.get(target.targetId);
  if (
    context &&
    (!Number.isFinite(now) ||
      now < context.launchedAt ||
      now - context.launchedAt > NATIVE_APP_LAUNCH_HANDOFF_MAX_AGE_MS)
  ) {
    owned!.delete(target.targetId);
    return;
  }
  if (
    !context ||
    context.platform !== target.platform ||
    context.originApplication !== originApplication.trim()
  )
    return;
  owned!.delete(target.targetId);
  return context;
}

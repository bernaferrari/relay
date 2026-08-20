import { createDevice, type Device } from "./device.js";
import { createDeviceObservationFacade } from "./device-observation-membrane.js";
import type { TargetContext } from "./target-context.js";

/**
 * Device provider seam (Phase 4 /  cloud-ready).
 *
 * Routing today:
 * - `device`  → LocalAgentDevice via {@link createDevice} (default, unchanged)
 * - `browser` → same local client path used by existing callers (browser pool
 *               still resolves through workspace helpers)
 * - `cloud`   → {@link CloudDeviceProvider} stub — throw until a real
 *               BrowserStack / Sauce / … adapter is plugged in
 *
 * Grounding, here/do, and explore stay above this factory: they call Device
 * methods only. Adding a cloud provider must not change those clients.
 */
export type DeviceProviderKind = TargetContext["kind"];

/** Future: implement Device methods for a remote cloud session. */
export type CloudDeviceProvider = {
  readonly kind: "cloud";
  readonly provider: string;
  create(context: Extract<TargetContext, { kind: "cloud" }>): Device | Promise<Device>;
};

/**
 * Stand-in for a local device. Tests register one of these so code that only
 * calls Device methods can run without a phone attached.
 */
export type LocalDeviceProvider = {
  readonly kind: "device";
  create(context: Extract<TargetContext, { kind: "device" }>): Device;
};

/** Optional registry hook for a real cloud adapter (unset = stub). */
let cloudDeviceProvider: CloudDeviceProvider | undefined;
let localDeviceProvider: LocalDeviceProvider | undefined;

export function setCloudDeviceProvider(provider: CloudDeviceProvider | undefined): void {
  cloudDeviceProvider = provider;
}

export function getCloudDeviceProvider(): CloudDeviceProvider | undefined {
  return cloudDeviceProvider;
}

/** Override the local device client. Unset restores the real agent-device path. */
export function setLocalDeviceProvider(provider: LocalDeviceProvider | undefined): void {
  localDeviceProvider = provider;
}

export function getLocalDeviceProvider(): LocalDeviceProvider | undefined {
  return localDeviceProvider;
}

/**
 * Resolve a Device for any TargetContext.
 * Local device callers can keep using {@link createDevice} directly; this is
 * the explicit factory entry for code that must handle cloud later.
 */
export function createDeviceForTarget(context: TargetContext): Device {
  switch (context.kind) {
    case "cloud": {
      const registered = cloudDeviceProvider;
      if (!registered) {
        throw new Error(
          `Cloud device provider "${context.provider}" is not implemented yet (session ${context.sessionId})`,
        );
      }
      if (registered.provider !== context.provider) {
        throw new Error(
          `Cloud device provider mismatch: context wants "${context.provider}", registry has "${registered.provider}"`,
        );
      }
      const device = registered.create(context);
      if (device instanceof Promise) {
        throw new Error(
          `Cloud device provider "${context.provider}" returned a Promise; sync createDeviceForTarget requires a sync Device (use createDeviceForTargetAsync)`,
        );
      }
      return createDeviceObservationFacade(device);
    }
    case "device":
      return createDeviceObservationFacade(
        localDeviceProvider?.create(context) ?? createDevice(context),
      );
    case "browser":
      return createDevice(context);
  }
}

/** Async variant for cloud providers that need network setup. */
export async function createDeviceForTargetAsync(context: TargetContext): Promise<Device> {
  if (context.kind !== "cloud") return createDeviceForTarget(context);
  const registered = cloudDeviceProvider;
  if (!registered) {
    throw new Error(
      `Cloud device provider "${context.provider}" is not implemented yet (session ${context.sessionId})`,
    );
  }
  if (registered.provider !== context.provider) {
    throw new Error(
      `Cloud device provider mismatch: context wants "${context.provider}", registry has "${registered.provider}"`,
    );
  }
  return createDeviceObservationFacade(await registered.create(context));
}

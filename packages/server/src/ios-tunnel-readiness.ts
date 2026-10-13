/** Exact-device readiness and shared startup policy; native transport remains the adapter. */
import { HttpError } from "./http.js";

type TunnelAction = (
  bin: string,
  tunnelInfoArgs: readonly string[],
  serial: string,
) => Promise<void>;

export type IosTunnelReadinessRuntime = {
  /** False means a native listing answered without this device; rejection means it did not answer. */
  hasTunnel: (bin: string, tunnelInfoArgs: readonly string[], serial: string) => Promise<boolean>;
  startTunnel: TunnelAction;
  waitForDevice: TunnelAction;
  ownedTunnel: () => { running: boolean; stop: () => Promise<boolean> } | undefined;
};

/** Only native tunnel-info JSON for this exact device can authorize its producer. */
export function tunnelListingLooksReady(listed: string, serial: string): boolean {
  let tunnels: unknown;
  try {
    tunnels = JSON.parse(listed);
  } catch {
    return false;
  }
  if (!serial || !Array.isArray(tunnels)) return false;
  const usablePort = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535;
  return tunnels.some((value: unknown) => {
    if (!value || typeof value !== "object") return false;
    const tunnel = value as Record<string, unknown>;
    return (
      tunnel.udid === serial &&
      typeof tunnel.address === "string" &&
      tunnel.address.trim().length > 0 &&
      usablePort(tunnel.rsdPort) &&
      (tunnel.userspaceTun !== true || usablePort(tunnel.userspaceTunPort))
    );
  });
}

/** One owner coordinates startup; every waiter must then prove its own target. */
export function createIosTunnelReadiness(runtime: IosTunnelReadinessRuntime): TunnelAction {
  let startup: Promise<void> | null = null;
  return async (bin, tunnelInfoArgs, serial) => {
    if (startup) await startup;
    let tunnelInfoAnswered = false;
    try {
      if (await runtime.hasTunnel(bin, tunnelInfoArgs, serial)) return;
      tunnelInfoAnswered = true;
    } catch {
      // Only a nonresponding owned tunnel is eligible for the existing restart path.
    }
    if (startup) {
      await startup;
      return runtime.waitForDevice(bin, tunnelInfoArgs, serial);
    }

    const previous = runtime.ownedTunnel();
    if (previous) {
      // Another device's ready tunnel neither proves this target nor authorizes stopping it.
      if (previous.running && tunnelInfoAnswered) {
        return runtime.waitForDevice(bin, tunnelInfoArgs, serial);
      }
      const stopped = await previous.stop();
      if (!stopped) {
        throw new HttpError(
          503,
          "The previous go-ios tunnel is still stopping; retry once it exits.",
        );
      }
    }
    if (!previous && tunnelInfoAnswered) {
      // A responding external owner gets a bounded chance to publish the requested device.
      return runtime.waitForDevice(bin, tunnelInfoArgs, serial);
    }
    if (startup) {
      await startup;
      return runtime.waitForDevice(bin, tunnelInfoArgs, serial);
    }

    const currentStartup = runtime.startTunnel(bin, tunnelInfoArgs, serial);
    startup = currentStartup;
    void currentStartup.then(
      () => {
        if (startup === currentStartup) startup = null;
      },
      () => {
        if (startup === currentStartup) startup = null;
      },
    );
    return currentStartup;
  };
}

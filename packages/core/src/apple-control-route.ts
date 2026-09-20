/**
 * One resolved Apple control path for a target.
 *
 * Physical devices may use the usbmux testCommand listener, CoreDevice HID,
 * and go-ios pixels. Simulators have none of those transports — their
 * operations must stay on the SDK session. Callers consume this route instead
 * of independently rediscovering the serial shape.
 */
import { isCoreSimulatorSerial } from "./ios-simulator-serial.js";
import type { TargetContext } from "./target-context.js";

export type AppleControlRoute =
  | { kind: "simulator-sdk"; udid: string }
  | { kind: "physical-runner"; udid: string };

export function resolveAppleControlRoute(
  context: TargetContext | undefined,
): AppleControlRoute | undefined {
  if (!context || context.kind !== "device" || context.platform !== "ios") return undefined;
  if (isCoreSimulatorSerial(context.serial)) {
    return { kind: "simulator-sdk", udid: context.serial };
  }
  return { kind: "physical-runner", udid: context.serial };
}

export function isSimulatorSdkRoute(
  route: AppleControlRoute | undefined,
): route is { kind: "simulator-sdk"; udid: string } {
  return route?.kind === "simulator-sdk";
}

export function isPhysicalRunnerRoute(
  route: AppleControlRoute | undefined,
): route is { kind: "physical-runner"; udid: string } {
  return route?.kind === "physical-runner";
}

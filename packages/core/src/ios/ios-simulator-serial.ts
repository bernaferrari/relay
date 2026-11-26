import { homedir } from "node:os";
import { join } from "node:path";

/**
 * CoreSimulator device UDIDs are UUID-shaped (8-4-4-4-12 hex); physical Apple
 * serials are 40 hex characters. Transport seams that only exist over usbmux
 * (the adopted testCommand listener, go-ios pixels, the HID tap) must not be
 * attempted for simulator targets — there is no cable, and the attach failure
 * reads as a missing device instead of an unsupported transport.
 */
export function isCoreSimulatorSerial(serial: string | undefined): boolean {
  return (
    serial !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serial)
  );
}

/** The default agent-device host lease directory, matching the vendored 0.21.x layout. */
export function defaultAppleRunnerLeaseDir(): string {
  return join(homedir(), ".agent-device", "apple-runner", "leases");
}

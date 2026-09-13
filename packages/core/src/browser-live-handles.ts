import type { Device } from "./device.js";
import type { BrowserSession } from "./browser-target.js";

const sessions = new WeakMap<Device, BrowserSession>();

export function bindBrowserLiveSession(device: Device, session: BrowserSession): void {
  sessions.set(device, session);
}

export function browserSessionForDevice(device: Device): BrowserSession | undefined {
  return sessions.get(device);
}

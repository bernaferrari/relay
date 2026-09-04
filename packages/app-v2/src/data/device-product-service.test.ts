import { describe, expect, it } from "vitest";
import { projectDevices } from "./device-product-service";

describe("device product projection", () => {
  it("separates ready, attention, and virtual targets", () => {
    const devices = projectDevices([
      {
        id: "offline",
        serial: "offline",
        name: "Phone",
        kind: "Physical device",
        booted: true,
        platform: "android",
        connectionState: "offline",
      },
      {
        id: "ready",
        serial: "ready",
        name: "iPad",
        kind: "Physical device",
        booted: true,
        platform: "ios",
      },
      {
        id: "browser",
        serial: "browser",
        name: "Chrome",
        kind: "Managed browser",
        booted: null,
        platform: "browser",
      },
    ]);
    expect(Object.fromEntries(devices.map((device) => [device.id, device.status]))).toEqual({
      browser: "virtual",
      offline: "needs-attention",
      ready: "ready",
    });
    expect(devices.find((device) => device.id === "offline")?.recovery).toMatch(/reconnect/i);
  });
});

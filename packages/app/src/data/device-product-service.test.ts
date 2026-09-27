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
      {
        id: "simulator",
        serial: "simulator",
        name: "Pixel simulator",
        kind: "Android emulator",
        booted: true,
        platform: "android",
        connectionState: "connected",
      },
    ]);
    expect(Object.fromEntries(devices.map((device) => [device.id, device.status]))).toEqual({
      browser: "virtual",
      offline: "needs-attention",
      ready: "ready",
      simulator: "virtual",
    });
    expect(devices.find((device) => device.id === "simulator")?.runnable).toBe(true);
    expect(devices.find((device) => device.id === "offline")?.recovery).toMatch(/reconnect/i);
  });
});

it("never advertises a stopped simulator as ready", () => {
  const [device] = projectDevices([
    {
      id: "stopped",
      name: "iPad",
      serial: "stopped",
      platform: "ios",
      kind: "simulator",
      booted: false,
    },
  ]);
  expect(device?.status).toBe("needs-attention");
  expect(device?.runnable).toBe(false);
});

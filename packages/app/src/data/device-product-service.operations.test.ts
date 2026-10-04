import { describe, expect, it, vi } from "vitest";
import type { Platform } from "../platform/types";
import { createDeviceProductService } from "./device-product-service";

const { calls, invoke } = vi.hoisted(() => {
  const calls: Array<{ id: string; input: unknown }> = [];
  const invoke = vi.fn(async (id: string, input: unknown) => {
    calls.push({ id, input });
    if (id === "target.devices.list") {
      return {
        devices: [
          {
            id: "ios-id",
            serial: "ios-serial",
            name: "QA iPhone",
            platform: "ios",
            kind: "Physical device",
            booted: true,
          },
          {
            id: "browser-id",
            serial: "browser-id",
            name: "Chrome",
            platform: "browser",
            kind: "Managed browser",
            booted: null,
          },
        ],
      };
    }
    if (id === "target.avds.list") return { avds: [] };
    if (id === "target.list") return { targets: [] };
    if (id === "target.app.launch") {
      return {
        launched: {
          serial: "ios-serial",
          app: "com.example.shop",
          platform: "ios",
          launchedAt: 10,
        },
      };
    }
    throw new Error(`Unexpected operation ${id}`);
  });
  return { calls, invoke };
});

vi.mock("./product-client", () => ({
  productClientForPlatform: async () => ({ client: { invoke } }),
}));

describe("device product operations", () => {
  it("launches an attached mobile app through the canonical operation", async () => {
    calls.length = 0;
    const service = createDeviceProductService({} as Platform);
    await expect(service.launchApp!("ios-id", " com.example.shop", true)).resolves.toMatchObject({
      serial: "ios-serial",
      platform: "ios",
    });
    expect(calls).toEqual([
      { id: "target.devices.list", input: { targetKind: "device", targetId: "ios-id" } },
      { id: "target.list", input: {} },
      {
        id: "target.app.launch",
        input: { serial: "ios-serial", app: "com.example.shop", relaunch: true },
      },
    ]);
  });

  it("does not route managed-browser launches through the mobile operation", async () => {
    calls.length = 0;
    const service = createDeviceProductService({} as Platform);
    await expect(service.launchApp!("browser-id", "https://example.test")).rejects.toThrow(
      /attached Android and iOS/iu,
    );
    expect(calls.map(({ id }) => id)).toEqual(["target.devices.list", "target.list"]);
  });

  it("opens the known device without waiting on unrelated inventory", async () => {
    calls.length = 0;
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (id, input) => {
      if (id === "target.avds.list") throw new Error("Unrelated emulator inventory is blocked");
      if (id === "target.devices.list" && (input as { targetId?: string }).targetId !== "ios-id")
        throw new Error("Unrelated browser inventory is blocked");
      return original(id, input);
    });
    try {
      await expect(createDeviceProductService({} as Platform).get("ios-id")).resolves.toMatchObject(
        {
          serial: "ios-serial",
          platform: "ios",
        },
      );
      expect(calls.some(({ id }) => id === "target.avds.list")).toBe(false);
    } finally {
      invoke.mockImplementation(original);
    }
  });
});

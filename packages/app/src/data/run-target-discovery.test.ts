import { describe, expect, it, vi } from "vitest";
import type { Platform } from "../platform/types";
import { createRunProductService } from "./run-product-service";

vi.mock("node:crypto", () => {
  throw new Error("Renderer Run discovery must not import Node crypto");
});

const { calls, invoke } = vi.hoisted(() => {
  const calls: { id: string; input: Record<string, unknown> }[] = [];
  const invoke = vi.fn(async (id: string, input: Record<string, unknown>) => {
    calls.push({ id, input });
    const browsers = [
      "selected",
      ...Array.from({ length: 60 }, (_, index) => `unrelated-${index}`),
    ];
    if (id === "target.devices.list") {
      if (input.targetKind === "device")
        return {
          devices: [
            {
              id: "selected-ipad",
              serial: "selected-ipad",
              name: "My iPad",
              kind: "Physical device",
              platform: "ios",
              booted: true,
            },
          ],
        };
      if (input.targetKind !== "browser") throw new Error("Hardware inventory must not run");
      return {
        devices: browsers.map((id) => ({
          id,
          serial: id,
          name: id,
          kind: "Managed browser",
          platform: "browser",
          booted: true,
        })),
      };
    }
    if (id === "target.list")
      return {
        targets: browsers.map((id) => ({
          id,
          name: id,
          kind: "browser",
          browser: { startUrl: "https://example.com", headless: true },
          createdAt: 1,
          updatedAt: 1,
        })),
      };
    if (id === "target.preflight") {
      if (input.targetId !== "selected") throw new Error("Unrelated preflight must not run");
      return {
        preflight: {
          targetId: "selected",
          ok: true,
          checkedAt: 1,
          capabilities: ["snapshot", "screenshot", "recording"],
          checks: [],
        },
      };
    }
    if (id === "run.list") return { runs: [] };
    if (id === "app-map.list") return { appMaps: [] };
    throw new Error(`Unexpected operation ${id}`);
  });
  return { calls, invoke };
});
vi.mock("./product-client", () => ({
  productClientForPlatform: async () => ({
    client: { invoke },
    actorId: "agent:target-discovery-test",
  }),
}));

describe("saved test scoped target discovery", () => {
  it("preflights only the requested browser and scopes its naming inventory too", async () => {
    calls.length = 0;
    const service = createRunProductService({} as Platform);
    const targets = await service.listTargets({ targetKind: "browser", targetId: "selected" });
    expect(targets.map((target) => target.targetId)).toEqual(["selected"]);
    expect(calls.filter((call) => call.id === "target.preflight")).toEqual([
      { id: "target.preflight", input: { targetId: "selected" } },
    ]);
    expect(calls.filter((call) => call.id === "target.devices.list")).toEqual([
      { id: "target.devices.list", input: { targetKind: "browser", targetId: "selected" } },
      { id: "target.devices.list", input: { targetKind: "browser", targetId: "selected" } },
    ]);
  });

  it("loads the actual run runtime and discovers a native target without Node crypto", async () => {
    calls.length = 0;
    const service = createRunProductService({} as Platform);
    const targets = await service.listTargets({ targetKind: "device", targetId: "selected-ipad" });
    expect(targets).toEqual([
      {
        kind: "device",
        platform: "ios",
        targetId: "selected-ipad",
        name: "My iPad",
        detail: "iOS",
      },
    ]);
    expect(calls.filter((call) => call.id === "target.devices.list")).toEqual([
      { id: "target.devices.list", input: { targetKind: "device", targetId: "selected-ipad" } },
      { id: "target.devices.list", input: { targetKind: "device", targetId: "selected-ipad" } },
    ]);
    expect(calls.some((call) => call.id === "target.preflight")).toBe(false);
    expect(await service.listTestRuns!("saved-native-test")).toEqual([]);
    expect(calls.filter((call) => call.id === "run.list")).toEqual([{ id: "run.list", input: {} }]);
    expect(calls.some((call) => /(?:run|workflow)\.(?:create|start)/u.test(call.id))).toBe(false);
  });
});

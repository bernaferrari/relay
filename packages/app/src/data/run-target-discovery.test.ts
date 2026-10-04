import { describe, expect, it, vi } from "vitest";
import type { Platform } from "../platform/types";
import { createRunProductService } from "./run-product-service";

const { calls, invoke } = vi.hoisted(() => {
  const calls: { id: string; input: Record<string, unknown> }[] = [];
  const invoke = vi.fn(async (id: string, input: Record<string, unknown>) => {
    calls.push({ id, input });
    const browsers = [
      "selected",
      ...Array.from({ length: 60 }, (_, index) => `unrelated-${index}`),
    ];
    if (id === "target.devices.list") {
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

describe("saved Test scoped target discovery", () => {
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
});

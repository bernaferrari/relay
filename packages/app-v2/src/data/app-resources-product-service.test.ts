import { describe, expect, it, vi } from "vitest";
import type { Platform } from "../platform/types";
import { createAppResourcesProductService } from "./app-resources-product-service";

const { calls, invoke } = vi.hoisted(() => {
  const calls: Array<{ id: string; input: unknown }> = [];
  const invoke = vi.fn(async (id: string, input: unknown) => {
    calls.push({ id, input });
    if (id === "build.save") {
      return {
        build: {
          id: "build-1",
          projectId: "project-1",
          name: "Release",
          platform: "android",
          status: "ready",
          createdAt: 1,
          updatedAt: 2,
        },
      };
    }
    if (id === "target.browser-auth.save" || id === "target.browser-auth.revoke") {
      return {
        fixture: {
          schemaVersion: 1,
          id: "00000000-0000-4000-8000-000000000001",
          reference: "authfx:00000000-0000-4000-8000-000000000001:1",
          revision: 1,
          projectId: "project-1",
          targetId: "browser-1",
          name: "Member",
          origins: ["https://example.test"],
          cookieCount: 1,
          createdAt: 1,
          createdBy: "human:test",
        },
        target: { id: "browser-1", name: "Chrome" },
      };
    }
    throw new Error(`Unexpected operation ${id}`);
  });
  return { calls, invoke };
});

vi.mock("./product-client", () => ({
  productClientForPlatform: async () => ({ client: { invoke } }),
}));

describe("operational app resources product service", () => {
  it("uses canonical build.save for both version creation and update", async () => {
    calls.length = 0;
    const service = createAppResourcesProductService({} as Platform);
    await service.createVersion({
      id: "build-1",
      name: "Release",
      platform: "android",
      status: "ready",
    });
    await service.updateVersion({
      id: "build-1",
      name: "Release 2",
      platform: "android",
      status: "ready",
    });
    expect(calls.map(({ id }) => id)).toEqual(["build.save", "build.save"]);
    expect(calls[1]?.input).toMatchObject({ id: "build-1", name: "Release 2" });
  });

  it("confirms and reuses canonical browser-auth operations", async () => {
    calls.length = 0;
    const service = createAppResourcesProductService({} as Platform);
    await service.saveBrowserAccount({ targetId: "browser-1", name: "Member" });
    await service.refreshBrowserAccount({
      targetId: "browser-1",
      name: "Member refreshed",
      fixtureId: "00000000-0000-4000-8000-000000000001",
    });
    await service.revokeBrowserAccount({
      targetId: "browser-1",
      reference: "authfx:00000000-0000-4000-8000-000000000001:1",
    });
    expect(calls.map(({ id }) => id)).toEqual([
      "target.browser-auth.save",
      "target.browser-auth.save",
      "target.browser-auth.revoke",
    ]);
    expect(calls.every(({ input }) => (input as { confirm?: boolean }).confirm === true)).toBe(
      true,
    );
    expect(
      JSON.stringify(await service.saveBrowserAccount({ targetId: "browser-1", name: "Member" })),
    ).not.toMatch(/createdBy|revokedBy|cookieValue|password|token/iu);
  });
});

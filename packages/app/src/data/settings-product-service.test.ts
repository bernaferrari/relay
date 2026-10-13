import { expect, it } from "vitest";
import type { Platform } from "../platform/types";
import { settingsCategories, createSettingsProductService } from "./settings-product-service";

it("defines the public settings categories", () => {
  expect(settingsCategories.map((category) => category.path)).toEqual([
    "/settings/general",
    "/settings/evidence",
    "/settings/integrations",
    "/settings/appearance",
    "/settings/advanced",
    "/settings/about",
  ]);
  expect(settingsCategories.find((category) => category.id === "evidence")?.label).toBe(
    "Evidence & privacy",
  );
});

it("sends the selected evidence mode through the settings service", async () => {
  let request: Request | undefined;
  const platform: Platform = {
    platform: "web",
    getServerConnection: () => ({
      url: "http://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    }),
    getServerUrl: () => "http://relay.test",
    storage: { get: () => null, set: () => undefined },
    fetch: async (input, init) => {
      request = new Request(input, init);
      return new Response(
        JSON.stringify({ policy: { schemaVersion: 1, mode: "full", sensitive: {} } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  };

  const result = await createSettingsProductService(platform).setEvidence({ mode: "full" });

  expect(request?.method).toBe("PUT");
  expect(request?.url).toBe("http://relay.test/settings/evidence");
  expect(await request?.json()).toEqual({ mode: "full" });
  expect(result.mode).toBe("full");
});

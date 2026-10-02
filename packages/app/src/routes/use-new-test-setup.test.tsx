import { describe, expect, it } from "vitest";
import { initialSetupMode } from "./use-new-test-setup";

describe("contextual website setup", () => {
  it("opens the address form for a known website app", () => {
    expect(
      initialSetupMode({
        app: { id: "shop", name: "Shop", platform: "web" },
        requestedAppId: "shop",
        startsFromPath: false,
      }),
    ).toBe("website");
  });
  it("preserves explicit target and map path precedence", () => {
    const context = {
      app: { id: "shop", name: "Shop", platform: "web" as const },
      requestedAppId: "shop",
      startsFromPath: false,
    };
    expect(initialSetupMode({ ...context, requestedTargetId: "browser" })).toBe("detailed");
    expect(initialSetupMode({ ...context, startsFromPath: true })).toBe("detailed");
  });
  it("keeps mobile and unknown app setup explicit", () => {
    for (const platform of ["android", "ios", undefined] as const) {
      expect(
        initialSetupMode({
          app: { id: "app", name: "App", platform },
          requestedAppId: "app",
          startsFromPath: false,
        }),
      ).toBe("detailed");
    }
  });
});

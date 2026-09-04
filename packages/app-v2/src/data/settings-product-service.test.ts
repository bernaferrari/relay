import { expect, it } from "vitest";
import { settingsCategories } from "./settings-product-service";

it("defines the public settings categories", () => {
  expect(settingsCategories.map((category) => category.path)).toEqual([
    "/settings/general",
    "/settings/evidence",
    "/settings/integrations",
    "/settings/appearance",
    "/settings/advanced",
    "/settings/about",
  ]);
});

import { expect, it } from "vitest";
import { walkthroughConfigurationLabels } from "./walkthrough-configuration-labels";
it("keeps browser and viewport choices distinct for the same account", () => {
  const options = walkthroughConfigurationLabels([
    { id: "one", label: "browser=shop @ member · browser:chrome-1280x800-abcdef123456" },
    { id: "two", label: "browser=shop @ member · browser:firefox-390x844-abcdef123456" },
  ]);
  expect(options[0].label).toBe("shop · member · chrome 1280 × 800");
  expect(options[1].label).toBe("shop · member · firefox 390 × 844");
});
it("disambiguates identical display names rather than merging configurations", () => {
  const options = walkthroughConfigurationLabels([
    { id: "one", label: "Member" },
    { id: "two", label: "Member" },
  ]);
  expect(options[0].label).not.toBe(options[1].label);
  expect(options.map((option) => option.value)).toEqual(["one", "two"]);
});

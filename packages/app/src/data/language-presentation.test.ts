import { expect, it } from "vitest";
import { languagePresentation } from "./language-presentation";

it("shows one language name and flags only explicit regions", () => {
  expect(languagePresentation("fr", "Français French")).toEqual({
    label: "French",
    flag: undefined,
  });
  expect(languagePresentation("ar-SA", "العربية Arabic")).toEqual({
    label: "Arabic (Saudi Arabia)",
    flag: "🇸🇦",
  });
  expect(languagePresentation("custom_value", "Custom language").label).toBe("Custom language");
});

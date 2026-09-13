import { afterEach, expect, it } from "vitest";
import { applyColorScheme, validColorScheme } from "./appearance-preference";

afterEach(() => {
  document.getElementById("relay-theme")?.remove();
  document.documentElement.style.removeProperty("color-scheme");
  document.documentElement.style.removeProperty("background-color");
  delete document.documentElement.dataset.colorScheme;
  delete document.documentElement.dataset.colorSchemePreference;
  try {
    localStorage.removeItem("relay-color-scheme");
    localStorage.removeItem("relay-theme-css-dark");
    localStorage.removeItem("relay-theme-css-light");
  } catch {
    /* ignore */
  }
});

it("treats unknown values as system", () => {
  expect(validColorScheme(undefined)).toBe("system");
  expect(validColorScheme("dark")).toBe("dark");
});

it("injects Relay tokens and the preload key when applying a scheme", () => {
  applyColorScheme("dark");
  expect(document.documentElement.dataset.colorScheme).toBe("dark");
  expect(document.documentElement.dataset.colorSchemePreference).toBe("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(document.getElementById("relay-theme")?.textContent).toContain("color-scheme: dark");
  expect(localStorage.getItem("relay-color-scheme")).toBe("dark");
  expect(localStorage.getItem("relay-theme-css-dark")).toContain("--background-base");

  applyColorScheme("light");
  expect(document.documentElement.dataset.colorScheme).toBe("light");
  expect(document.documentElement.style.colorScheme).toBe("light");
  expect(localStorage.getItem("relay-color-scheme")).toBe("light");
});

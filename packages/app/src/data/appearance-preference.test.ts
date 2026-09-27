import { afterEach, expect, it } from "vitest";
import { applyColorScheme, validColorScheme } from "./appearance-preference";

afterEach(() => {
  document.getElementById("relay-theme")?.remove();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("color-scheme");
  document.documentElement.style.removeProperty("background-color");
  delete document.documentElement.dataset.colorScheme;
  delete document.documentElement.dataset.colorSchemePreference;
  delete document.documentElement.dataset.theme;
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

it("toggles the scheme without injecting a token sheet", () => {
  localStorage.setItem("relay-theme-css-dark", "--text-success-base: leftover");
  applyColorScheme("dark");
  expect(document.documentElement.dataset.colorScheme).toBe("dark");
  expect(document.documentElement.dataset.colorSchemePreference).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(document.getElementById("relay-theme")).toBeNull();
  expect(localStorage.getItem("relay-color-scheme")).toBe("dark");
  expect(localStorage.getItem("relay-theme-css-dark")).toBeNull();

  applyColorScheme("light");
  expect(document.documentElement.dataset.colorScheme).toBe("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(document.documentElement.style.colorScheme).toBe("light");
  expect(localStorage.getItem("relay-color-scheme")).toBe("light");
});

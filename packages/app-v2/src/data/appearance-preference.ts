import type { Platform } from "../platform/types";

export type ColorSchemePreference = "system" | "light" | "dark";

export const APPEARANCE_STORAGE_KEY = "appearance.colorScheme";
let appliedVersion = 0;
export function colorSchemeVersion(): number {
  return appliedVersion;
}

export function validColorScheme(value: string | null | undefined): ColorSchemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function applyColorScheme(value: ColorSchemePreference): void {
  appliedVersion += 1;
  const resolved =
    value === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : value;
  document.documentElement.dataset.colorScheme = resolved;
  document.documentElement.dataset.colorSchemePreference = value;
}

export async function readColorScheme(platform: Platform): Promise<ColorSchemePreference> {
  return validColorScheme(await Promise.resolve(platform.storage.get(APPEARANCE_STORAGE_KEY)));
}

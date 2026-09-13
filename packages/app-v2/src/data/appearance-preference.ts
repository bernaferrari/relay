import { applyRelayColorScheme, type RelayColorScheme } from "@relay/ui/theme/apply";
import type { Platform } from "../platform/types";

export type ColorSchemePreference = RelayColorScheme;

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
  applyRelayColorScheme(value);
}

export async function readColorScheme(platform: Platform): Promise<ColorSchemePreference> {
  return validColorScheme(await Promise.resolve(platform.storage.get(APPEARANCE_STORAGE_KEY)));
}

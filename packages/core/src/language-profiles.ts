/**
 * Language profiles — thin facade over generic switcher profiles.
 *
 * Prefer `switcher-profiles` for new code. These helpers keep locale-run and
 * the existing "grok-ios" id working while the product model is kind-agnostic.
 */
import type { SnapshotNode } from "./device.js";
import type { ProfileNavStep } from "./profile-nav.js";
import {
  extractSwitcherOptionsFromNodes,
  inferOptionId,
} from "./variable-option-inference.js";
import {
  getSwitcherProfile,
  listSwitcherProfiles,
  listSwitcherProfilesSync,
  matrixScopeFromSwitcherProfile,
  saveSwitcherProfile,
  type SwitcherOption,
  type SwitcherProfile,
} from "./switcher-profiles.js";

export type LanguageRow = {
  tag: string;
  label: string;
  aliases?: string[];
  identifier?: string;
};

export type AppLanguageProfile = {
  id: string;
  name: string;
  app: string;
  platform?: "ios" | "android" | "any";
  entryPath: ProfileNavStep[];
  languagePath: ProfileNavStep[];
  languages: LanguageRow[];
  defaultLocale?: string;
  notes?: string;
  verifiedAt?: string;
  scanned?: boolean;
};

function toLanguage(profile: SwitcherProfile): AppLanguageProfile {
  return {
    id: profile.id === "grok-ios-language" ? "grok-ios" : profile.id,
    name: profile.name,
    app: profile.app,
    ...(profile.platform ? { platform: profile.platform } : {}),
    entryPath: structuredClone(profile.entryPath),
    languagePath: structuredClone(profile.pickerPath),
    languages: profile.options.map((option) => ({
      tag: option.id,
      label: option.label,
      ...(option.aliases ? { aliases: [...option.aliases] } : {}),
      ...(option.identifier ? { identifier: option.identifier } : {}),
    })),
    ...(profile.defaultOptionId ? { defaultLocale: profile.defaultOptionId } : {}),
    ...(profile.notes ? { notes: profile.notes } : {}),
    ...(profile.verifiedAt ? { verifiedAt: profile.verifiedAt } : {}),
    ...(profile.scanned !== undefined ? { scanned: profile.scanned } : {}),
  };
}

function toSwitcher(profile: AppLanguageProfile): SwitcherProfile {
  const id =
    profile.id === "grok-ios" || profile.id === "grok-ios-language"
      ? "grok-ios-language"
      : profile.id;
  return {
    id,
    name: profile.name,
    kind: "language",
    app: profile.app,
    ...(profile.platform ? { platform: profile.platform } : {}),
    entryPath: structuredClone(profile.entryPath),
    pickerPath: structuredClone(profile.languagePath),
    options: profile.languages.map(
      (row): SwitcherOption => ({
        id: row.tag,
        label: row.label,
        ...(row.aliases ? { aliases: [...row.aliases] } : {}),
        ...(row.identifier ? { identifier: row.identifier } : {}),
      }),
    ),
    ...(profile.defaultLocale ? { defaultOptionId: profile.defaultLocale } : {}),
    ...(profile.notes ? { notes: profile.notes } : {}),
    ...(profile.verifiedAt ? { verifiedAt: profile.verifiedAt } : {}),
    ...(profile.scanned !== undefined ? { scanned: profile.scanned } : {}),
  };
}

export async function listLanguageProfiles(): Promise<AppLanguageProfile[]> {
  const profiles = await listSwitcherProfiles({ kind: "language" });
  return profiles.map(toLanguage);
}

export function listLanguageProfilesSync(): AppLanguageProfile[] {
  return listSwitcherProfilesSync()
    .filter((profile) => profile.kind === "language")
    .map(toLanguage);
}

export async function getLanguageProfile(id: string): Promise<AppLanguageProfile | undefined> {
  const profile = await getSwitcherProfile(id === "grok-ios" ? "grok-ios-language" : id);
  return profile && profile.kind === "language" ? toLanguage(profile) : undefined;
}

export async function findLanguageProfileForApp(
  app: string,
): Promise<AppLanguageProfile | undefined> {
  const profiles = await listSwitcherProfiles({ kind: "language", app });
  return profiles[0] ? toLanguage(profiles[0]) : undefined;
}

export async function saveLanguageProfile(
  profile: AppLanguageProfile,
): Promise<AppLanguageProfile> {
  const saved = await saveSwitcherProfile(toSwitcher(profile));
  return toLanguage(saved);
}

export function resolveLanguageOptions(
  profile: AppLanguageProfile,
  locales: string[],
): Record<string, { label?: string; identifier?: string; text?: string }> {
  const out: Record<string, { label?: string; identifier?: string; text?: string }> = {};
  for (const locale of locales) {
    const needle = locale.trim().toLocaleLowerCase();
    const row = profile.languages.find(
      (item) =>
        item.tag.toLocaleLowerCase() === needle ||
        item.label.toLocaleLowerCase() === needle ||
        item.aliases?.some((alias) => alias.toLocaleLowerCase() === needle),
    );
    if (!row) {
      out[locale] = { label: locale };
      continue;
    }
    out[locale] = row.identifier ? { identifier: row.identifier } : { label: row.label };
  }
  return out;
}

export type ProfileMatrixScope = {
  locales: string[];
  app?: string;
  relaunch?: boolean;
  entryPath?: ProfileNavStep[];
  languagePath?: ProfileNavStep[];
  languageOptions?: Record<string, { label?: string; identifier?: string; text?: string }>;
  restoreLocale?: string;
  restoreAtEnd?: boolean;
  screenshotEachLocale?: boolean;
};

export async function matrixScopeFromLanguageProfile(
  profileId: string,
  locales: string[],
  overrides?: Partial<ProfileMatrixScope>,
): Promise<ProfileMatrixScope> {
  const matrix = await matrixScopeFromSwitcherProfile(
    profileId === "grok-ios" ? "grok-ios-language" : profileId,
    locales,
    {
      ...(overrides?.restoreLocale !== undefined
        ? { restoreOptionId: overrides.restoreLocale }
        : {}),
      ...(overrides?.restoreAtEnd !== undefined ? { restoreAtEnd: overrides.restoreAtEnd } : {}),
      ...(overrides?.screenshotEachLocale !== undefined
        ? { screenshotEach: overrides.screenshotEachLocale }
        : {}),
      ...(overrides?.app ? { app: overrides.app } : {}),
      ...(overrides?.entryPath ? { entryPath: overrides.entryPath } : {}),
      ...(overrides?.languagePath ? { pickerPath: overrides.languagePath } : {}),
    },
  );
  return {
    locales: matrix.options,
    app: matrix.app,
    relaunch: matrix.relaunch,
    entryPath: matrix.entryPath,
    languagePath: matrix.pickerPath,
    languageOptions: matrix.optionTargets,
    restoreLocale: matrix.restoreOptionId,
    restoreAtEnd: matrix.restoreAtEnd,
    screenshotEachLocale: matrix.screenshotEach,
  };
}

export const inferLanguageTag = inferOptionId;
export function extractLanguageRowsFromNodes(nodes: SnapshotNode[]): LanguageRow[] {
  return extractSwitcherOptionsFromNodes(nodes).map((option) => ({
    tag: option.id,
    label: option.label,
    ...(option.aliases ? { aliases: option.aliases } : {}),
    ...(option.identifier ? { identifier: option.identifier } : {}),
  }));
}

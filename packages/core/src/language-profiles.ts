/**
 * Language profiles — thin facade over generic switcher profiles.
 *
 * Prefer `switcher-profiles` for new code. These helpers keep corpus/locale-run
 * and existing "grok-ios" ids working while the product model is kind-agnostic.
 */
import type { CorpusNavStep, CorpusScope } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { extractSwitcherOptionsFromNodes, inferOptionId } from "./switcher-option-rows.js";
import {
  getSwitcherProfile,
  corpusScopeFromSwitcherProfile,
  listSwitcherProfiles,
  listSwitcherProfilesSync,
  matrixScopeFromSwitcherProfile,
  saveSwitcherProfile,
  scanSwitcherPicker,
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
  entryPath: CorpusNavStep[];
  languagePath: CorpusNavStep[];
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

export async function corpusScopeFromLanguageProfile(
  profileId: string,
  locales: string[],
  overrides?: Partial<CorpusScope>,
): Promise<Partial<CorpusScope>> {
  return corpusScopeFromSwitcherProfile(
    profileId === "grok-ios" ? "grok-ios-language" : profileId,
    locales,
    overrides,
  );
}

export type ProfileLocaleRunScope = {
  locales: string[];
  app?: string;
  relaunch?: boolean;
  entryPath?: CorpusNavStep[];
  languagePath?: CorpusNavStep[];
  languageOptions?: Record<string, { label?: string; identifier?: string; text?: string }>;
  restoreLocale?: string;
  restoreAtEnd?: boolean;
  screenshotEachLocale?: boolean;
};

export async function localeRunScopeFromLanguageProfile(
  profileId: string,
  locales: string[],
  overrides?: Partial<ProfileLocaleRunScope>,
): Promise<ProfileLocaleRunScope> {
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

export function switchLanguageModuleYaml(profile: AppLanguageProfile): string {
  const langs = profile.languages.map((row) => `  # - ${row.tag}: ${row.label}`).join("\n");
  const entry = profile.entryPath.map((step) => yamlNav(step)).join("\n");
  const language = profile.languagePath.map((step) => yamlNav(step)).join("\n");
  return `schemaVersion: 1
id: switch-language-${profile.id}
name: Switch language · ${profile.name}
description: >
  Reusable language switch. Bind locale_label per case.
  Known locales:
${langs}
parameters:
  - name: locale_label
    label: Language row label
    required: true
steps:
  - kind: app
    action: open
    app: ${JSON.stringify(profile.app)}
    relaunch: true
  - kind: sleep
    ms: 1200
${entry}
${language}
  - kind: tap
    target:
      label: "{{locale_label}}"
  - kind: sleep
    ms: 900
`;
}

function yamlNav(step: CorpusNavStep): string {
  const pad = "  ";
  if (step.kind === "wait") return `${pad}- kind: sleep\n${pad}  ms: ${step.ms}`;
  if (step.kind === "back") return `${pad}- kind: key\n${pad}  key: back`;
  if (step.kind === "tap" && step.target.identifier) {
    return `${pad}- kind: tap\n${pad}  target:\n${pad}    identifier: ${JSON.stringify(step.target.identifier)}`;
  }
  if (step.kind === "tap" && step.target.label) {
    return `${pad}- kind: tap\n${pad}  target:\n${pad}    label: ${JSON.stringify(step.target.label)}`;
  }
  return `${pad}- kind: sleep\n${pad}  ms: 300`;
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

export type ScanLanguagePickerInput = {
  serial: string;
  app: string;
  profileId?: string;
  name?: string;
  entryPath?: CorpusNavStep[];
  languagePath?: CorpusNavStep[];
  platform?: "ios" | "android";
  maxScrolls?: number;
  save?: boolean;
  /** Keep the already-visible picker bound to its current iOS session when false. */
  openApp?: boolean;
};

export async function scanAppLanguagePicker(input: ScanLanguagePickerInput) {
  const result = await scanSwitcherPicker({
    serial: input.serial,
    app: input.app,
    kind: "language",
    profileId:
      input.profileId === "grok-ios"
        ? "grok-ios-language"
        : (input.profileId ?? "grok-ios-language"),
    name: input.name,
    entryPath: input.entryPath,
    pickerPath: input.languagePath,
    platform: input.platform,
    maxScrolls: input.maxScrolls,
    save: input.save,
    openApp: input.openApp,
  });
  return {
    profile: toLanguage(result.profile),
    rowsFound: result.optionsFound,
    scrolls: result.scrolls,
  };
}

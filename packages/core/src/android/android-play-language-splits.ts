/**
 * Play language splits for an installed Android App Bundle.
 *
 * LocaleManager only keeps splits for locales still in the app's list. A
 * one-tag write can make Play delete the others. Download every declared
 * language first, then switch by reordering that same full list — no
 * force-stop and no device locale change.
 */
import path from "node:path";
import {
  cooperativeCheckpoint,
  getExecutingJobId,
  raceCancel,
  throwIfCancelled,
} from "../execution/control.js";
import { runTargetMutation } from "../target/target-control.js";
import { targetIdentity } from "../target/target-context.js";

export type AndroidLanguageSplitCommand = (
  args: string[],
) => Promise<{ stdout?: string; stderr?: string }>;

/** How long to wait for Play to install missing language splits. */
export const ANDROID_LANGUAGE_SPLIT_TIMEOUT_MS = 90_000;

const ANDROID_LANGUAGE_SPLIT_POLL_MS = 1_000;

/** Legacy ISO 639 codes Play still uses in `split_config.<code>.apk`. */
const SPLIT_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  he: "iw",
  iw: "he",
  id: "in",
  in: "id",
  yi: "ji",
  ji: "yi",
};

const LANGUAGE_SPLIT_NAME = /^split_config\.([a-z]{2,3})\.apk$/iu;

export function normalizeAndroidLocaleTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const tag of tags ?? []) {
    const trimmed = tag.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function androidLanguageSubtag(tag: string): string {
  return /^([A-Za-z]{2,3})/u.exec(tag.trim())?.[1]?.toLowerCase() ?? "";
}

function androidLanguageSplitCodes(tagOrLanguage: string): string[] {
  const language = androidLanguageSubtag(tagOrLanguage);
  if (!language) return [];
  const alias = SPLIT_LANGUAGE_ALIASES[language];
  return alias ? [language, alias] : [language];
}

function packageApkBasenames(packagePaths: string): string[] {
  return packagePaths
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package:/") && line.endsWith(".apk"))
    .map((line) => path.posix.basename(line.slice("package:".length)));
}

/** Language codes in `pm path` output. ABI and density splits are ignored. */
export function parseAndroidInstalledLanguageSplits(packagePaths: string): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const base of packageApkBasenames(packagePaths)) {
    const code = LANGUAGE_SPLIT_NAME.exec(base)?.[1]?.toLowerCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

function packageHasConfigSplits(packagePaths: string): boolean {
  return packageApkBasenames(packagePaths).some((base) => base.startsWith("split_"));
}

/** True when a split matches the language subtag or its legacy alias.
 * `pt-BR` and `zh-CN` share `pt` and `zh`. Region subtags are not splits. */
export function androidLanguageSplitInstalled(locale: string, packagePaths: string): boolean {
  const installed = new Set(parseAndroidInstalledLanguageSplits(packagePaths));
  return androidLanguageSplitCodes(locale).some((code) => installed.has(code));
}

function missingAndroidLanguageSplits(locales: readonly string[], packagePaths: string): string[] {
  const installed = new Set(parseAndroidInstalledLanguageSplits(packagePaths));
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const locale of locales) {
    const language = androidLanguageSubtag(locale);
    if (!language || seen.has(language)) continue;
    seen.add(language);
    if (androidLanguageSplitCodes(language).some((code) => installed.has(code))) continue;
    missing.push(language);
  }
  return missing;
}

function describeMissingLanguageSplits(languages: readonly string[]): string {
  return languages
    .map((language) =>
      androidLanguageSplitCodes(language)
        .map((code) => `split_config.${code}.apk`)
        .join(" or "),
    )
    .join(", ");
}

function localeIndex(locales: readonly string[], tag: string | undefined): number {
  if (!tag?.trim()) return -1;
  const needle = tag.trim().toLowerCase();
  return locales.findIndex((item) => item.toLowerCase() === needle);
}

/** Full declared list. Current primary stays first when it is declared;
 * otherwise the requested tag does, when it is declared. */
export function orderAndroidLocalesForSplitDownload(
  declared: readonly string[],
  currentLocale: string | undefined,
  requestedLocale: string,
): string[] {
  const locales = normalizeAndroidLocaleTags(declared);
  const currentIndex = localeIndex(locales, currentLocale);
  const firstIndex = currentIndex >= 0 ? currentIndex : localeIndex(locales, requestedLocale);
  if (firstIndex <= 0) return locales;
  const next = [...locales];
  const [picked] = next.splice(firstIndex, 1);
  if (!picked) return locales;
  next.unshift(picked);
  return next;
}

/** `--locales` value. One tag when the app has no declared list, otherwise
 * the candidate followed by every other declared tag. */
export function androidAppLocaleListArgument(
  candidate: string,
  declared: readonly string[] | undefined,
): string {
  const locales = normalizeAndroidLocaleTags(declared);
  if (locales.length === 0) return candidate;
  const rest = locales.filter((tag) => tag.toLowerCase() !== candidate.toLowerCase());
  return [candidate, ...rest].join(",");
}

export type PrefetchAndroidLanguageSplitsInput = {
  packageName: string;
  requestedLocale: string;
  declaredLocales: readonly string[];
  command: AndroidLanguageSplitCommand;
  currentLocale?: string;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** Ask Play to install every missing declared language split. One
 * `set-app-locales` of the full list is what starts the download. */
export async function prefetchAndroidLanguageSplits(
  input: PrefetchAndroidLanguageSplitsInput,
): Promise<void> {
  const declared = normalizeAndroidLocaleTags(input.declaredLocales);
  if (declared.length === 0) return;
  const timeoutMs = input.timeoutMs ?? ANDROID_LANGUAGE_SPLIT_TIMEOUT_MS;
  const pollMs = input.pollMs ?? ANDROID_LANGUAGE_SPLIT_POLL_MS;
  const now = input.now ?? Date.now;
  const sleep =
    input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const readPaths = async (): Promise<string> => {
    const result = await raceCancel(input.command(["shell", "pm", "path", input.packageName]));
    return String(result.stdout ?? "");
  };

  const initialPaths = await readPaths();
  // A single base APK has no Play language splits to fetch. Waiting would
  // fail locale changes for every app that is not an App Bundle install.
  if (!packageHasConfigSplits(initialPaths)) return;
  if (missingAndroidLanguageSplits(declared, initialPaths).length === 0) return;

  const locales = orderAndroidLocalesForSplitDownload(
    declared,
    input.currentLocale,
    input.requestedLocale,
  ).join(",");
  await runTargetMutation(targetIdentity(), getExecutingJobId(), () =>
    raceCancel(
      input.command([
        "shell",
        "cmd",
        "locale",
        "set-app-locales",
        input.packageName,
        "--locales",
        locales,
      ]),
    ),
  );

  const deadline = now() + timeoutMs;
  while (true) {
    throwIfCancelled();
    const missing = missingAndroidLanguageSplits(declared, await readPaths());
    if (missing.length === 0) return;
    if (now() >= deadline) {
      const waitedSeconds = Math.round(timeoutMs / 1000);
      throw new Error(
        `language splits for ${input.packageName} still missing after ${waitedSeconds}s: ` +
          describeMissingLanguageSplits(missing),
      );
    }
    await cooperativeCheckpoint();
    await raceCancel(sleep(Math.min(pollMs, Math.max(0, deadline - now()))));
  }
}

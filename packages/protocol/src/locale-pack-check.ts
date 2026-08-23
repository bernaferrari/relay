/**
 * Offline check of a Combine evidence folder.
 *
 * Reads top-level accessibility/*.json (Data Controls pack) or
 * <locale>/accessibility/*.json (combine export). Root survey --dir
 * 00.json files are not a pack unless they name a locale.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type LocalePackFindingCode = "missing-slot" | "leftover-english";

export type LocalePackFinding = {
  locale: string;
  code: LocalePackFindingCode;
  detail: string;
  slotId?: string;
  string?: string;
};

export type LocalePackLocaleDigest = {
  locale: string;
  complete: boolean;
  missingSlots: string[];
  leftoverEnglish: string[];
};

export type LocalePackCheckReport = {
  ok: boolean;
  dir: string;
  baseline: string;
  locales: string[];
  findings: LocalePackFinding[];
  digest: LocalePackLocaleDigest[];
};

/** Product names stay English on purpose and are not leftover copy. */
const BRAND_TOKENS = new Set(["grok", "x", "imagine"]);

const LOCALE_FROM_NAME = /(?:^|-)((?:[a-z]{2,3})(?:-[a-z0-9]{2,8})*)\.json$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function localeFromFileName(name: string): string | undefined {
  const matched = name.match(LOCALE_FROM_NAME);
  return matched?.[1]?.toLowerCase();
}

function slotId(value: unknown): string | undefined {
  const direct = trimText(value);
  if (direct) return direct;
  if (!isRecord(value)) return undefined;
  return trimText(value.id);
}

function collectSlotIds(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.slots)) return [];
  const found = Array.isArray(value.slots.found) ? value.slots.found : [];
  return [
    ...new Set(
      found.flatMap((item) => {
        const id = slotId(item);
        return id ? [id] : [];
      }),
    ),
  ];
}

function hasSlotInventory(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.slots)) return false;
  return Array.isArray(value.slots.found) || Array.isArray(value.slots.missing);
}

function collectNodeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const node of value) {
    if (!isRecord(node)) continue;
    const text = trimText(node.label);
    if (text) labels.push(text);
  }
  return labels;
}

function collectStrings(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const labels: string[] = [];
  if (Array.isArray(value.strings)) {
    for (const item of value.strings) {
      const text = trimText(item);
      if (text) labels.push(text);
    }
  }
  if (labels.length === 0) {
    labels.push(...collectNodeLabels(value.nodes));
  }
  if (labels.length === 0 && isRecord(value.snapshot)) {
    labels.push(...collectNodeLabels(value.snapshot.nodes));
  }
  return [...new Set(labels)];
}

function declaredComplete(value: unknown): boolean | undefined {
  if (!isRecord(value) || !isRecord(value.slots)) return undefined;
  return typeof value.slots.complete === "boolean" ? value.slots.complete : undefined;
}

function isBrandOnly(text: string): boolean {
  const tokens = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => BRAND_TOKENS.has(token.toLowerCase()));
}

type LocaleDocument = {
  locale: string;
  file: string;
  slots: string[];
  strings: string[];
  hasSlots: boolean;
  complete?: boolean;
};

function mergeLocale(current: LocaleDocument | undefined, next: LocaleDocument): LocaleDocument {
  if (!current) return next;
  return {
    locale: current.locale,
    file: current.file,
    slots: [...new Set([...current.slots, ...next.slots])],
    strings: [...new Set([...current.strings, ...next.strings])],
    hasSlots: current.hasSlots || next.hasSlots,
    complete:
      current.complete === false || next.complete === false
        ? false
        : (current.complete ?? next.complete),
  };
}

type LocatedAccessibilityFile = {
  name: string;
  path: string;
  localeHint?: string;
};

function isMissingDir(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT",
  );
}

async function jsonNamesIn(folder: string): Promise<string[] | undefined> {
  try {
    return (await readdir(folder)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (isMissingDir(error)) return undefined;
    throw new Error(
      `Could not read pack folder ${folder}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function discoverAccessibilityFiles(dir: string): Promise<LocatedAccessibilityFile[]> {
  const topLevel = await jsonNamesIn(join(dir, "accessibility"));
  if (topLevel?.length) {
    return topLevel.map((name) => ({ name, path: join(dir, "accessibility", name) }));
  }

  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      isMissingDir(error)
        ? `Pack folder has no accessibility/*.json: ${dir}`
        : `Could not read pack folder ${dir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const perLocale: LocatedAccessibilityFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "accessibility") continue;
    const nested = await jsonNamesIn(join(dir, entry.name, "accessibility"));
    if (!nested?.length) continue;
    for (const name of nested) {
      perLocale.push({
        name,
        path: join(dir, entry.name, "accessibility", name),
        localeHint: entry.name.toLowerCase(),
      });
    }
  }
  if (perLocale.length) return perLocale;

  const root = await jsonNamesIn(dir);
  if (root?.length) {
    return root.map((name) => ({ name, path: join(dir, name) }));
  }
  throw new Error(`Pack folder has no accessibility/*.json: ${dir}`);
}

async function readAccessibilityDocuments(dir: string): Promise<LocaleDocument[]> {
  const files = await discoverAccessibilityFiles(dir);
  const byLocale = new Map<string, LocaleDocument>();
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file.path, "utf8")) as unknown;
    } catch (error) {
      throw new Error(
        `Could not read ${basename(file.path)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const locale =
      (isRecord(parsed) ? trimText(parsed.locale)?.toLowerCase() : undefined) ??
      localeFromFileName(file.name) ??
      file.localeHint;
    if (!locale) {
      throw new Error(`Accessibility file ${file.name} has no locale field or locale in its name`);
    }
    const document: LocaleDocument = {
      locale,
      file: file.name,
      slots: collectSlotIds(parsed),
      strings: collectStrings(parsed),
      hasSlots: hasSlotInventory(parsed),
      complete: declaredComplete(parsed),
    };
    byLocale.set(locale, mergeLocale(byLocale.get(locale), document));
  }
  if (byLocale.size === 0) throw new Error(`Pack folder has no accessibility/*.json: ${dir}`);
  return [...byLocale.values()].sort((left, right) => left.locale.localeCompare(right.locale));
}

export async function checkLocalePack(
  dir: string,
  baseline: string,
): Promise<LocalePackCheckReport> {
  const root = dir.trim();
  const baselineLocale = baseline.trim().toLowerCase();
  if (!root) throw new Error("Pack directory is required");
  if (!baselineLocale) throw new Error("Baseline locale is required");

  const documents = await readAccessibilityDocuments(root);
  const locales = documents.map((document) => document.locale);
  const baselineDocument = documents.find((document) => document.locale === baselineLocale);
  if (!baselineDocument) {
    throw new Error(
      `Baseline locale ${baselineLocale} is not in ${root} (${locales.join(", ") || "none"})`,
    );
  }

  const baselineSlots = new Set(baselineDocument.slots);
  const baselineStrings = new Set(baselineDocument.strings);
  const findings: LocalePackFinding[] = [];
  const digest: LocalePackLocaleDigest[] = [];

  for (const document of documents) {
    if (document.locale === baselineLocale) {
      digest.push({
        locale: document.locale,
        complete: document.complete !== false,
        missingSlots: [],
        leftoverEnglish: [],
      });
      continue;
    }

    const missingSlots = document.hasSlots
      ? [...baselineSlots].filter((id) => !document.slots.includes(id)).sort()
      : [];
    const leftoverEnglish = document.strings
      .filter((text) => baselineStrings.has(text) && !isBrandOnly(text))
      .sort((left, right) => left.localeCompare(right));
    const complete = missingSlots.length === 0 && document.complete !== false;

    for (const slotId of missingSlots) {
      findings.push({
        locale: document.locale,
        code: "missing-slot",
        detail: `Missing baseline slot ${slotId}`,
        slotId,
      });
    }
    for (const text of leftoverEnglish) {
      findings.push({
        locale: document.locale,
        code: "leftover-english",
        detail: `Leftover exact English string: ${text}`,
        string: text,
      });
    }
    digest.push({ locale: document.locale, complete, missingSlots, leftoverEnglish });
  }

  return {
    ok: !findings.some((finding) => finding.code === "missing-slot"),
    dir: root,
    baseline: baselineLocale,
    locales,
    findings,
    digest,
  };
}

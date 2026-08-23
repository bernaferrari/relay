/**
 * Offline check of a Combine evidence folder (accessibility/*.json).
 *
 * Agents persist trees with `device survey --dir`; this compares each locale
 * to one baseline so nobody writes Python to ask whether a slot is in the tree.
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

function collectStrings(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const labels: string[] = [];
  if (Array.isArray(value.strings)) {
    for (const item of value.strings) {
      const text = trimText(item);
      if (text) labels.push(text);
    }
  }
  if (labels.length === 0 && Array.isArray(value.nodes)) {
    for (const node of value.nodes) {
      if (!isRecord(node)) continue;
      const text = trimText(node.label);
      if (text) labels.push(text);
    }
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

async function readAccessibilityDocuments(dir: string): Promise<LocaleDocument[]> {
  const folder = join(dir, "accessibility");
  let names: string[];
  try {
    names = (await readdir(folder)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    const missing =
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT";
    throw new Error(
      missing
        ? `Pack folder has no accessibility/*.json: ${dir}`
        : `Could not read pack folder ${dir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (names.length === 0) throw new Error(`Pack folder has no accessibility/*.json: ${dir}`);

  const byLocale = new Map<string, LocaleDocument>();
  for (const name of names) {
    const path = join(folder, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (error) {
      throw new Error(
        `Could not read ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const locale =
      (isRecord(parsed) ? trimText(parsed.locale)?.toLowerCase() : undefined) ??
      localeFromFileName(name);
    if (!locale) {
      throw new Error(`Accessibility file ${name} has no locale field or locale in its name`);
    }
    const document: LocaleDocument = {
      locale,
      file: name,
      slots: collectSlotIds(parsed),
      strings: collectStrings(parsed),
      hasSlots: hasSlotInventory(parsed),
      complete: declaredComplete(parsed),
    };
    byLocale.set(locale, mergeLocale(byLocale.get(locale), document));
  }
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
      `Baseline locale ${baselineLocale} is not in ${root}/accessibility (${locales.join(", ") || "none"})`,
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

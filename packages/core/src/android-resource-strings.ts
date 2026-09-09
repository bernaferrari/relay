/**
 * A deliberately small parser for the text form emitted by `aapt2 dump
 * resources`.  It is useful for resolving a recorded, visible string to the
 * same resource in another locale; it is not a translation service.
 */

export interface AndroidResourceStringValue {
  key: string;
  locale: string;
  value: string;
}

export interface AndroidResourceStringIndexOptions {
  /** Locale of the recorded text. Omit to use the APK's default resources. */
  sourceLocale?: string;
  /** Locale to resolve. This must be an explicitly present resource locale. */
  targetLocale: string;
}

export type AndroidResourceStringLookup =
  | { status: "matched"; key: string; source: string; target: string }
  | { status: "missing"; source: string }
  | { status: "ambiguous"; source: string; candidates: Array<{ key: string; target: string }> };

function locale(value: string): string {
  return value
    .trim()
    .replace(/^b\+/iu, "")
    .replace(/\+/g, "-")
    .replace(/-r(?=[A-Z]{2,3}$)/u, "-")
    .replace(/_/g, "-")
    .toLowerCase();
}

/** Prefer an explicitly requested regional/configuration locale, then its
 * language-only resource. Never broaden the lookup beyond that pair. */
function localeCandidates(value: string): string[] {
  const normalized = locale(value);
  if (!normalized) return [""];
  const language = normalized.split("-", 1)[0]!;
  return language === normalized ? [normalized] : [normalized, language];
}

function isLocaleQualifier(value: string): boolean {
  return (
    value === "" ||
    /^[A-Za-z]{2,3}(?:-r[A-Za-z]{2,3})?$/u.test(value) ||
    /^b\+[A-Za-z]{2,3}(?:\+[A-Za-z0-9]{2,8})*$/iu.test(value)
  );
}

function decodeAaptString(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/gu, (match, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "\\":
        return "\\";
      case '"':
        return '"';
      case "'":
        return "'";
      default:
        if (escaped.startsWith("u"))
          return String.fromCharCode(Number.parseInt(escaped.slice(1), 16));
        if (escaped.startsWith("U"))
          return String.fromCodePoint(Number.parseInt(escaped.slice(1), 16));
        // Preserve unknown escapes rather than silently changing visible text.
        return match;
    }
  });
}

function readQuoted(input: string, start: number): { value: string; end: number } | undefined {
  let value = "";
  for (let index = start; index < input.length; index += 1) {
    const character = input[index]!;
    if (character === '"') return { value, end: index + 1 };
    if (character !== "\\") {
      value += character;
      continue;
    }
    const next = input[index + 1];
    if (next === undefined) return undefined;
    value += `\\${next}`;
    index += 1;
  }
  return undefined;
}

/** Parse string resources from an `aapt2 dump resources` result. */
export function parseAndroidResourceStrings(resources: string): AndroidResourceStringValue[] {
  const values: AndroidResourceStringValue[] = [];
  const heading = /^\s*resource\s+0x[0-9a-f]+\s+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gim;
  const headings = [...resources.matchAll(heading)];
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index]!;
    if (match[1]!.toLowerCase() !== "string") continue;
    const key = match[2]!;
    const blockStart = match.index! + match[0].length;
    const blockEnd = headings[index + 1]?.index ?? resources.length;
    const block = resources.slice(blockStart, blockEnd);
    const line = /^\s*\(([^)]*)\)\s+"/gm;
    for (const entry of block.matchAll(line)) {
      if (!isLocaleQualifier(entry[1]!)) continue;
      const quoteStart = entry.index! + entry[0].lastIndexOf('"') + 1;
      const quoted = readQuoted(block, quoteStart);
      if (!quoted) continue;
      values.push({ key, locale: locale(entry[1]!), value: decodeAaptString(quoted.value) });
    }
  }
  return values;
}

/** Build an exact resource-backed source-to-target resolver. */
export function createAndroidResourceStringIndex(
  resources: string,
  options: AndroidResourceStringIndexOptions,
): {
  lookup(source: string): AndroidResourceStringLookup;
  values: readonly AndroidResourceStringValue[];
  sources: readonly string[];
} {
  const sourceLocale = locale(options.sourceLocale ?? "");
  const targetLocale = locale(options.targetLocale);
  if (!targetLocale) throw new Error("target locale is required");
  const values = parseAndroidResourceStrings(resources);
  const byKey = new Map<string, Map<string, string[]>>();
  for (const item of values) {
    let keyValues = byKey.get(item.key);
    if (!keyValues) byKey.set(item.key, (keyValues = new Map()));
    const localeValues = keyValues.get(item.locale) ?? [];
    if (!localeValues.includes(item.value)) localeValues.push(item.value);
    keyValues.set(item.locale, localeValues);
  }
  const bySource = new Map<string, Array<{ key: string; target: string }>>();
  for (const [key, localized] of byKey) {
    const sourceValues = localeCandidates(sourceLocale).find((candidate) =>
      localized.has(candidate),
    );
    // A regional resource wins over its language fallback for each key. This
    // also keeps a duplicate exact locale fail-closed instead of mixing it
    // with a less specific value.
    const targetValues = localeCandidates(targetLocale).find((candidate) =>
      localized.has(candidate),
    );
    if (sourceValues === undefined || targetValues === undefined) continue;
    for (const source of localized.get(sourceValues) ?? []) {
      const candidates = bySource.get(source) ?? [];
      for (const target of localized.get(targetValues) ?? []) candidates.push({ key, target });
      bySource.set(source, candidates);
    }
  }
  return {
    values,
    sources: [...bySource.keys()],
    lookup(source) {
      const candidates = bySource.get(source) ?? [];
      const targets = [...new Set(candidates.map((candidate) => candidate.target))];
      if (candidates.length === 0) return { status: "missing", source };
      if (targets.length > 1) return { status: "ambiguous", source, candidates };
      return { status: "matched", key: candidates[0]!.key, source, target: targets[0]! };
    },
  };
}

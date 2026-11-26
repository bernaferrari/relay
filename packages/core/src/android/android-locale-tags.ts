/**
 * Product-owned Android locale tag aliases. Java/Android LocaleManager still
 * accepts the obsolete ISO 639 codes (`iw`, `in`) while apps and Variables
 * use the modern tags (`he`, `id`).
 */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  he: "iw",
  iw: "he",
  id: "in",
  in: "id",
};

export function parseAndroidLocaleOutput(output: string): string | undefined {
  const listed = output.match(/\[([^\]]*)\]/u)?.[1]?.trim();
  const locale = listed?.split(",")[0]?.trim();
  if (locale) return locale;
  const direct = output.trim().match(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u)?.[0];
  return direct || undefined;
}

function splitTag(tag: string): { language: string; remainder: string } {
  const trimmed = tag.trim();
  const match = /^([A-Za-z]{2,3})(.*)$/u.exec(trimmed);
  return {
    language: (match?.[1] ?? trimmed).toLocaleLowerCase(),
    remainder: match?.[2] ?? "",
  };
}

function modernLanguage(language: string): string {
  if (language === "iw") return "he";
  if (language === "in") return "id";
  return language;
}

/** Requested tag first, then the known Android/Java alias when one exists. */
export function androidLocaleTagCandidates(tag: string): string[] {
  const trimmed = tag.trim();
  const { language, remainder } = splitTag(trimmed);
  const alias = LANGUAGE_ALIASES[language];
  const candidates = [trimmed];
  if (alias) candidates.push(`${alias}${remainder}`);
  return [...new Set(candidates)];
}

/** True when two tags name the same language after he/iw and id/in folding. */
export function androidLocaleTagsCompatible(left: string, right: string): boolean {
  const a = splitTag(left);
  const b = splitTag(right);
  if (modernLanguage(a.language) !== modernLanguage(b.language)) return false;
  const region = (value: string) => value.replace(/^[-_]/u, "").toLocaleLowerCase();
  const leftRegion = region(a.remainder);
  const rightRegion = region(b.remainder);
  if (leftRegion && rightRegion && leftRegion !== rightRegion) return false;
  return true;
}

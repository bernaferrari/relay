const names = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });

export function languagePresentation(code: string, fallback: string) {
  try {
    const locale = new Intl.Locale(code);
    const label = names.of(locale.baseName) ?? fallback;
    const region = locale.region;
    const flag =
      region && /^[A-Z]{2}$/.test(region)
        ? [...region].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("")
        : undefined;
    return { label, flag };
  } catch {
    return { label: fallback, flag: undefined };
  }
}

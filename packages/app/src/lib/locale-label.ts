export function localeLabel(locale: string): string {
  try {
    const english = new Intl.DisplayNames(["en"], { type: "language" }).of(locale);
    const native = new Intl.DisplayNames([locale], { type: "language" }).of(locale);
    if (english && native && english !== native) return `${english} · ${native}`;
    return english ?? locale;
  } catch {
    return locale;
  }
}

/** A region-specific observation may select an app's language-only option,
 * but must never silently select a different region. */
export function supportedLocaleChoice(
  current: string | undefined,
  supported: readonly string[],
): string {
  if (!current) return "";
  try {
    const observed = new Intl.Locale(current);
    return (
      supported.find((locale) => new Intl.Locale(locale).baseName === observed.baseName) ??
      supported.find((locale) => new Intl.Locale(locale).baseName === observed.language) ??
      ""
    );
  } catch {
    return supported.includes(current) ? current : "";
  }
}

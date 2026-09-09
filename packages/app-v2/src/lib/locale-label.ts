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

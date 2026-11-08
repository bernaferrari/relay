/** Shared readiness vocabulary for live prompts and recorded completion waits.
 * A busy control disappearing establishes readiness, not answer correctness. */
export function isGenerationBusyControl(label: string): boolean {
  return /^(?:stop|(?:stop|cancel) (?:message|response|generation|generating|streaming|image|video))$/iu.test(
    label.trim(),
  );
}

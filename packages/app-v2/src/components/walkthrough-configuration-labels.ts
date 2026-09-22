/** Preserve browser, account and viewport distinctions without displaying engine syntax. */
export function walkthroughConfigurationLabels(variants: readonly { id: string; label: string }[]) {
  const labels = variants.map(({ label }) =>
    label
      .replace(/^browser=/, "")
      .replace(/ @ /g, " · ")
      .replace(/browser:/g, "")
      .replace(/-[a-f0-9]{12,}$/i, "")
      .replace(/(\d+)x(\d+)/g, "$1 × $2")
      .replace(/-/g, " "),
  );
  return variants.map((variant, index) => ({
    value: variant.id,
    label:
      labels.filter((label) => label === labels[index]).length > 1
        ? `${labels[index]} · Configuration ${index + 1}`
        : labels[index]!,
  }));
}

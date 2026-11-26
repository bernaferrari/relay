const LOCALIZED_STRING_KEY = /^LocalizedStringKey\(key: "([^"]+)"/u;

/** Extract a SwiftUI LocalizedStringKey symbolic key when the a11y label carries one. */
export function stableLabelKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const key = LOCALIZED_STRING_KEY.exec(value)?.[1]?.trim();
  return key || undefined;
}

/** Stable control key for one interactive node across locales. */
export function combineEvidenceControlStableKey(node: {
  identifier?: string;
  label?: string;
  value?: string;
  role?: string;
  type?: string;
}): string {
  const identifier = node.identifier?.trim();
  if (identifier) return `id:${identifier.toLocaleLowerCase()}`;
  const key = stableLabelKey(node.label) ?? stableLabelKey(node.value);
  if (key) return `key:${key.toLocaleLowerCase()}`;
  const role = (node.role ?? node.type ?? "control").trim().toLocaleLowerCase() || "control";
  const label = (node.label ?? node.value ?? "").trim().toLocaleLowerCase();
  // Last resort: role+label — locale-bound, but still useful within one pass.
  return `label:${role}:${label}`;
}

export function slugEvidencePathSegment(value: string): string {
  const key = stableLabelKey(value) ?? value;
  const slug = key
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "screen";
}

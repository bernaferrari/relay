/**
 * Structural depth-0 (later depth-N) walk of a screen's child rows.
 * Labels are read live so a language switch does not freeze English copy.
 */
import type { SnapshotNode } from "./device.js";

export type TourStop = {
  label: string;
  identifier?: string;
  point?: { x: number; y: number };
};

export type TourScreenSignature = {
  labels: string[];
};

const HEADER = /^(app|grok|voice|general|other)$/i;
const SKIP = /search|close|back|done|cancel|dismiss|keyboard|undo|redo|paste/i;
const LANGUAGE_ROW = /language|idioma|sprache|langue|言語|语言|語言/i;

export function extractTourStops(
  nodes: SnapshotNode[],
  input: { maxStops?: number; excludeLanguageRows?: boolean } = {},
): TourStop[] {
  const maxStops = input.maxStops ?? 24;
  const candidates: Array<TourStop & { y: number; area: number; isCell: boolean }> = [];
  for (const node of nodes) {
    const label = (node.label ?? node.value ?? "").trim();
    if (!label || label.length > 80) continue;
    const type = (node.type ?? node.role ?? "").toLocaleLowerCase();
    const isCell = type === "cell" || type === "button";
    if (!isCell && type !== "statictext") continue;
    if (HEADER.test(label) && label.length <= 12) continue;
    if (SKIP.test(label)) continue;
    if (input.excludeLanguageRows && LANGUAGE_ROW.test(label)) continue;
    if (label.length > 48 || /@|\bprofile picture\b/i.test(label)) continue;
    const rect = node.rect;
    if (!rect || rect.width * rect.height < 40 * 24) continue;
    candidates.push({
      label,
      ...(node.identifier?.trim() ? { identifier: node.identifier.trim() } : {}),
      y: rect.y,
      area: rect.width * rect.height,
      isCell,
    });
  }
  const preferCells = candidates.some((item) => item.isCell);
  const filtered = preferCells ? candidates.filter((item) => item.isCell) : candidates;
  filtered.sort((left, right) => left.y - right.y || right.area - left.area);
  const seen = new Set<string>();
  const stops: TourStop[] = [];
  for (const item of filtered) {
    const key = item.label.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    stops.push({
      label: item.label,
      ...(item.identifier ? { identifier: item.identifier } : {}),
    });
    if (stops.length >= maxStops) break;
  }
  return stops;
}

/** Live child-row fingerprint. Grok sub-settings often keep the same nav title. */
export function tourScreenSignature(
  nodes: SnapshotNode[],
  input: { excludeLanguageRows?: boolean } = {},
): TourScreenSignature {
  return {
    labels: extractTourStops(nodes, { maxStops: 24, ...input }).map((stop) => stop.label),
  };
}

export function sameTourScreen(origin: TourScreenSignature, current: TourScreenSignature): boolean {
  if (!origin.labels.length) return current.labels.length === 0;
  const currentKeys = new Set(current.labels.map((label) => label.toLocaleLowerCase()));
  const overlap = origin.labels.filter((label) =>
    currentKeys.has(label.toLocaleLowerCase()),
  ).length;
  const needed = Math.max(1, Math.ceil(origin.labels.length * 0.6));
  return overlap >= needed;
}

/** Strip “Open Appearance” → “appearance” so mapped labels overlap live cells. */
export function tourLabelKey(label: string): string {
  return label
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^(open|go to|view|show|select)\s+/u, "")
    .replace(/\s+/gu, " ");
}

export function tourFallbackOverlap(
  stops: ReadonlyArray<{ label: string }>,
  fallback: ReadonlyArray<{ label: string }> | undefined,
): number {
  if (!fallback?.length) return stops.length ? 1 : 0;
  const keys = new Set(fallback.map((stop) => tourLabelKey(stop.label)).filter(Boolean));
  return stops.filter((stop) => {
    const key = tourLabelKey(stop.label);
    if (!key) return false;
    if (keys.has(key)) return true;
    for (const expected of keys) {
      if (key.includes(expected) || expected.includes(key)) return true;
    }
    return false;
  }).length;
}

export function tourOriginFingerprintMatch(
  live: string | undefined,
  origin: string | undefined,
  aliases?: readonly string[],
): boolean {
  const observed = live?.trim().toLowerCase();
  if (!observed) return false;
  const expected = [origin, ...(aliases ?? [])]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  for (const key of expected) {
    if (key === observed) return true;
    const shorter = key.length <= observed.length ? key : observed;
    const longer = key.length <= observed.length ? observed : key;
    if (shorter.length >= 16 && longer.startsWith(shorter)) return true;
  }
  return false;
}

/** True when the live tree is the mapped list — fingerprint first, then row overlap.
 * Nav title is never enough: Grok child sheets keep header “Settings”. */
export function onTourOrigin(input: {
  liveFingerprint?: string;
  originFingerprint?: string;
  originAliases?: readonly string[];
  stops: ReadonlyArray<{ label: string }>;
  fallbackStops?: ReadonlyArray<{ label: string }>;
}): boolean {
  if (
    tourOriginFingerprintMatch(input.liveFingerprint, input.originFingerprint, input.originAliases)
  ) {
    return true;
  }
  if (input.fallbackStops?.length) {
    const hits = tourFallbackOverlap(input.stops, input.fallbackStops);
    return hits >= Math.min(2, input.fallbackStops.length);
  }
  return input.stops.length > 0;
}

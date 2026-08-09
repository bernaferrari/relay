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
  const nodesByIndex = new Map(
    nodes.flatMap((node) => (typeof node.index === "number" ? [[node.index, node] as const] : [])),
  );
  const closestHittableAncestor = (node: SnapshotNode): SnapshotNode | undefined => {
    let parentIndex = node.parentIndex;
    while (typeof parentIndex === "number") {
      const parent = nodesByIndex.get(parentIndex);
      if (!parent) return undefined;
      if (parent.hittable && parent.rect) return parent;
      parentIndex = parent.parentIndex;
    }
    return undefined;
  };
  const candidates: Array<
    TourStop & {
      y: number;
      labelY: number;
      area: number;
      isCell: boolean;
      rowKey?: string;
    }
  > = [];
  for (const node of nodes) {
    const label = (node.label ?? node.value ?? "").trim();
    if (!label || label.length > 80) continue;
    const type = (node.type ?? node.role ?? "").toLocaleLowerCase();
    const isNativeCell = type === "cell" || type === "button" || type.endsWith(".button");
    const isText = type === "statictext" || type.endsWith(".textview");
    if (!isNativeCell && !isText) continue;
    if (HEADER.test(label) && label.length <= 12) continue;
    if (SKIP.test(label)) continue;
    if (input.excludeLanguageRows && LANGUAGE_ROW.test(label)) continue;
    if (label.length > 48 || /@|\bprofile picture\b/i.test(label)) continue;
    const rect = node.rect;
    if (!rect || rect.width * rect.height < 40 * 24) continue;
    // Jetpack Compose often exposes an unlabeled hittable row containing one
    // or more TextViews. Treat that ancestor as the cell so the title becomes
    // a stable tour stop and subtitles in the same row are ignored.
    const row = isNativeCell ? node : closestHittableAncestor(node);
    const rowRect = row?.rect ?? rect;
    candidates.push({
      label,
      ...(row?.identifier?.trim()
        ? { identifier: row.identifier.trim() }
        : node.identifier?.trim()
          ? { identifier: node.identifier.trim() }
          : {}),
      point: { x: rowRect.x + rowRect.width / 2, y: rowRect.y + rowRect.height / 2 },
      y: rowRect.y,
      labelY: rect.y,
      area: rowRect.width * rowRect.height,
      isCell: isNativeCell || Boolean(row),
      ...(typeof row?.index === "number" ? { rowKey: `index:${row.index}` } : {}),
    });
  }
  const preferCells = candidates.some((item) => item.isCell);
  const filtered = preferCells ? candidates.filter((item) => item.isCell) : candidates;
  filtered.sort(
    (left, right) => left.y - right.y || left.labelY - right.labelY || right.area - left.area,
  );
  const seen = new Set<string>();
  const seenRows = new Set<string>();
  const stops: TourStop[] = [];
  for (const item of filtered) {
    if (item.rowKey && seenRows.has(item.rowKey)) continue;
    const key = item.label.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.rowKey) seenRows.add(item.rowKey);
    stops.push({
      label: item.label,
      ...(item.identifier ? { identifier: item.identifier } : {}),
      ...(item.point ? { point: item.point } : {}),
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

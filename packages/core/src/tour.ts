/**
 * Structural depth-0 (later depth-N) walk of a screen's child rows.
 * Labels are read live so a language switch does not freeze English copy.
 */
import type { SnapshotNode } from "./device.js";

export type TourStop = {
  label: string;
  identifier?: string;
  point?: { x: number; y: number };
  capture?: boolean;
};

export type TourScreenSignature = {
  labels: string[];
};

const HEADER = /^(app|grok|voice|general|other)$/i;
const SKIP = /search|close|back|done|cancel|dismiss|keyboard|undo|redo|paste/i;
const LANGUAGE_ROW = /language|idioma|sprache|langue|lingua|língua|لغة|言語|语言|語言/i;

/**
 * Android Compose can leave a logically hittable list row in the accessibility
 * tree after that row has slid under a fixed app bar.  Selecting it by label
 * then activates the chrome behind the bar, rather than the intended row.
 *
 * Use a visible close/back control near the top as the lower edge of that
 * chrome.  This is deliberately conservative: a row must begin below the bar
 * before a tour is allowed to turn it into an action.
 */
function occludedTopForTour(nodes: SnapshotNode[]): number | undefined {
  const screenBottom = Math.max(
    0,
    ...nodes.map((node) => (node.rect ? node.rect.y + node.rect.height : 0)),
  );
  const upperThird = screenBottom / 3;
  const screenWidth = Math.max(0, ...nodes.map((node) => node.rect?.width ?? 0));
  const appBarControls = nodes.filter((node) => {
    const label = (node.label ?? node.value ?? "").trim();
    const isCompactTopControl =
      Boolean(node.hittable && node.rect) &&
      (node.rect?.y ?? Number.POSITIVE_INFINITY) < screenBottom * 0.2 &&
      (node.rect?.width ?? Number.POSITIVE_INFINITY) <= screenWidth * 0.25 &&
      (node.rect?.height ?? Number.POSITIVE_INFINITY) <= screenBottom * 0.12;
    return (
      (/^(close|back)$/i.test(label) || isCompactTopControl) &&
      Boolean(node.rect) &&
      (node.rect?.y ?? Number.POSITIVE_INFINITY) < upperThird
    );
  });
  if (!appBarControls.length) return undefined;
  return Math.max(...appBarControls.map((node) => node.rect!.y + node.rect!.height)) + 12;
}

/** Android's navigation bar can remain in the tree alongside Compose rows
 * that have already scrolled beneath it. A depth-0 tour may only choose a
 * fully visible row, never the clipped tail below the system controls. */
function visibleBottomForTour(nodes: SnapshotNode[]): number | undefined {
  return nodes
    .flatMap((node) => {
      const identifier = node.identifier ?? "";
      return node.rect &&
        /com\.android\.systemui:id\/(?:navigation_bar|nav_buttons|home|back|recent)/i.test(
          identifier,
        )
        ? [node.rect.y]
        : [];
    })
    .sort((left, right) => left - right)[0];
}

export function extractTourStops(
  nodes: SnapshotNode[],
  input: { maxStops?: number; excludeLanguageRows?: boolean } = {},
): TourStop[] {
  const maxStops = input.maxStops ?? 24;
  const occludedTop = occludedTopForTour(nodes);
  const visibleBottom = visibleBottomForTour(nodes);
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
    if (
      /^(?:com\.android\.systemui|com\.google\.android\.inputmethod|com\.samsung\.android\.)/i.test(
        node.bundleId ?? "",
      )
    ) {
      continue;
    }
    const label = (node.label ?? node.value ?? "").trim();
    if (!label || label.length > 80) continue;
    const type = (node.type ?? node.role ?? "").toLocaleLowerCase();
    const isNativeCell = type === "cell" || type === "button" || type.endsWith(".button");
    const isText = type === "statictext" || type.endsWith(".textview");
    if (!isNativeCell && !isText) continue;
    if (SKIP.test(label)) continue;
    if (input.excludeLanguageRows && LANGUAGE_ROW.test(label)) continue;
    if (label.length > 48 || /@|\bprofile picture\b/i.test(label)) continue;
    const rect = node.rect;
    if (!rect || rect.width * rect.height < 40 * 24) continue;
    // Jetpack Compose often exposes an unlabeled hittable row containing one
    // or more TextViews. Treat that ancestor as the cell so the title becomes
    // a stable tour stop and subtitles in the same row are ignored.
    const row = isNativeCell ? node : closestHittableAncestor(node);
    // “Voice” is both a section heading and a real Grok Settings row. Only
    // ignore it as chrome when it has no tappable row behind it; otherwise a
    // valid recorded stop disappears and an exact tour cannot safely run.
    if (
      HEADER.test(label) &&
      label.length <= 12 &&
      (!/^voice$/i.test(label) || isNativeCell || !row)
    ) {
      continue;
    }
    const rowRect = row?.rect ?? rect;
    if (occludedTop !== undefined && rowRect.y < occludedTop) continue;
    if (visibleBottom !== undefined && rowRect.y + rowRect.height > visibleBottom) continue;
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
  // Do not globally discard TextViews merely because one unrelated native
  // cell exists (for example the Settings close button). Compose frequently
  // exposes the actual rows as plain TextViews while only chrome has a
  // hittable ancestor. Keeping both lets the per-row de-duplication below
  // prefer the real row where available without making a whole list vanish.
  candidates.sort(
    (left, right) => left.y - right.y || left.labelY - right.labelY || right.area - left.area,
  );
  const seen = new Set<string>();
  const seenRows = new Set<string>();
  const stops: TourStop[] = [];
  let previousLabelY = Number.NEGATIVE_INFINITY;
  for (const item of candidates) {
    if (item.rowKey && seenRows.has(item.rowKey)) continue;
    // Some Compose cards expose a status/subtitle as an independent TextView
    // (for example “Reset available” under “Usage”) without exposing the
    // shared tappable row as its parent. It is not another destination. Keep
    // real cells and inherited tappable rows intact, but suppress a nearby
    // unbound text fragment so localized dynamic copy cannot shift the tour.
    if (!item.isCell && item.labelY - previousLabelY < 96) continue;
    const key = item.label.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.rowKey) seenRows.add(item.rowKey);
    previousLabelY = item.labelY;
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
  minimumFallbackOverlap?: number;
}): boolean {
  if (
    tourOriginFingerprintMatch(input.liveFingerprint, input.originFingerprint, input.originAliases)
  ) {
    return true;
  }
  if (input.fallbackStops?.length) {
    const hits = tourFallbackOverlap(input.stops, input.fallbackStops);
    // Adjacent scroll positions often share two or three rows. Requiring only
    // two matches lets a tour mistake an upper Settings viewport for a lower
    // one, then replay otherwise-valid coordinates against the wrong rows.
    // A caller may deliberately relax this for a localized map with a stable
    // landmark, but the default must identify the whole visible list.
    const required =
      input.minimumFallbackOverlap ?? Math.max(2, Math.ceil(input.fallbackStops.length * 0.6));
    return hits >= Math.min(required, input.fallbackStops.length);
  }
  return input.stops.length > 0;
}

export type DockSide = "left" | "right" | "top" | "bottom";
export type BrowserLayout =
  | string
  | {
      axis: "horizontal" | "vertical";
      ratio: number;
      first: BrowserLayout;
      second: BrowserLayout;
    };
export type BrowserRect = { x: number; y: number; width: number; height: number };
export type BrowserSplit = BrowserRect & {
  path: string;
  axis: "horizontal" | "vertical";
  ratio: number;
};
export const FULL_BROWSER_RECT: BrowserRect = { x: 0, y: 0, width: 100, height: 100 };
export const clampBrowserSplit = (value: number) => Math.max(25, Math.min(75, value));
const split = (
  axis: "horizontal" | "vertical",
  first: BrowserLayout,
  second: BrowserLayout,
): BrowserLayout => ({ axis, ratio: 50, first, second });

export function defaultBrowserLayout(ids: readonly string[]): BrowserLayout | undefined {
  if (!ids.length) return undefined;
  if (ids.length === 1) return ids[0];
  if (ids.length === 2) return split("horizontal", ids[0]!, ids[1]!);
  return split(
    "horizontal",
    ids.length === 3 ? ids[0]! : split("vertical", ids[0]!, ids[2]!),
    split("vertical", ids[1]!, ids.at(-1)!),
  );
}

/** Prune removed/duplicate leaves, bound persisted depth, and admit newly opened profiles. */
export function restoreBrowserLayout(
  value: unknown,
  ids: readonly string[],
): BrowserLayout | undefined {
  const remaining = new Set(ids);
  function read(node: unknown, depth = 0): BrowserLayout | undefined {
    if (typeof node === "string") {
      if (!remaining.delete(node)) return undefined;
      return node;
    }
    if (!node || typeof node !== "object" || depth > 4) return undefined;
    const row = node as Record<string, unknown>;
    if (row.axis !== "horizontal" && row.axis !== "vertical") return undefined;
    const first = read(row.first, depth + 1);
    const second = read(row.second, depth + 1);
    if (!first || !second) return first ?? second;
    return {
      axis: row.axis,
      ratio:
        typeof row.ratio === "number" && Number.isFinite(row.ratio)
          ? clampBrowserSplit(row.ratio)
          : 50,
      first,
      second,
    };
  }
  let layout = read(value);
  if (!layout) return defaultBrowserLayout(ids);
  for (const id of remaining) layout = split("horizontal", layout, id);
  return layout;
}

function remove(node: BrowserLayout, id: string): BrowserLayout | undefined {
  if (typeof node === "string") return node === id ? undefined : node;
  const first = remove(node.first, id);
  const second = remove(node.second, id);
  return first && second ? { ...node, first, second } : (first ?? second);
}

export function dockBrowser(
  layout: BrowserLayout,
  source: string,
  target: string,
  side: DockSide,
): BrowserLayout {
  const ids = Object.keys(browserLayoutGeometry(layout).tiles);
  if (source === target || !ids.includes(source) || !ids.includes(target)) return layout;
  const pruned = remove(layout, source)!;
  function insert(node: BrowserLayout): BrowserLayout {
    if (typeof node !== "string")
      return { ...node, first: insert(node.first), second: insert(node.second) };
    if (node !== target) return node;
    const before = side === "left" || side === "top";
    return split(
      side === "left" || side === "right" ? "horizontal" : "vertical",
      before ? source : target,
      before ? target : source,
    );
  }
  return insert(pruned);
}

export function resizeBrowserSplit(
  layout: BrowserLayout,
  path: string,
  ratio: number,
): BrowserLayout {
  if (typeof layout === "string") return layout;
  if (!path) return { ...layout, ratio: clampBrowserSplit(ratio) };
  const key = path[0] === "0" ? "first" : "second";
  return { ...layout, [key]: resizeBrowserSplit(layout[key], path.slice(1), ratio) };
}

export function browserLayoutGeometry(layout?: BrowserLayout) {
  const tiles: Record<string, BrowserRect> = {};
  const splits: BrowserSplit[] = [];
  function visit(node: BrowserLayout, rect: BrowserRect, path: string) {
    if (typeof node === "string") {
      tiles[node] = rect;
      return;
    }
    splits.push({ ...rect, path, axis: node.axis, ratio: node.ratio });
    const part = node.ratio / 100;
    const horizontal = node.axis === "horizontal";
    visit(
      node.first,
      {
        ...rect,
        width: rect.width * (horizontal ? part : 1),
        height: rect.height * (horizontal ? 1 : part),
      },
      `${path}0`,
    );
    visit(
      node.second,
      {
        x: rect.x + (horizontal ? rect.width * part : 0),
        y: rect.y + (horizontal ? 0 : rect.height * part),
        width: rect.width * (horizontal ? 1 - part : 1),
        height: rect.height * (horizontal ? 1 : 1 - part),
      },
      `${path}1`,
    );
  }
  if (layout) visit(layout, FULL_BROWSER_RECT, "");
  return { tiles, splits };
}

/** Nearest normalized edge, so top/bottom remain reachable on wide browser tiles. */
export function browserDockSide(x: number, y: number, width: number, height: number): DockSide {
  const edges: [DockSide, number][] = [
    ["left", x / width],
    ["right", 1 - x / width],
    ["top", y / height],
    ["bottom", 1 - y / height],
  ];
  return edges.sort((a, b) => a[1] - b[1])[0]![0];
}

/** Keyboard reordering keeps the user's split directions and divider proportions. */
export function reorderBrowserLayout(
  layout: BrowserLayout,
  previous: readonly string[],
  next: readonly string[],
): BrowserLayout {
  if (typeof layout === "string") return next[previous.indexOf(layout)] ?? layout;
  return {
    ...layout,
    first: reorderBrowserLayout(layout.first, previous, next),
    second: reorderBrowserLayout(layout.second, previous, next),
  };
}

/** Dock to the outside of the entire layout, rather than nesting inside one tile. */
export function dockBrowserToEdge(
  layout: BrowserLayout,
  source: string,
  side: DockSide,
): BrowserLayout {
  if (!browserLayoutGeometry(layout).tiles[source]) return layout;
  const remaining = remove(layout, source);
  if (!remaining) return layout;
  const before = side === "left" || side === "top";
  return split(
    side === "left" || side === "right" ? "horizontal" : "vertical",
    before ? source : remaining,
    before ? remaining : source,
  );
}

export type BrowserArrangement = "grid" | "columns" | "rows";
export function arrangeBrowsers(
  ids: readonly string[],
  arrangement: BrowserArrangement,
): BrowserLayout | undefined {
  if (arrangement === "grid") return defaultBrowserLayout(ids);
  if (ids.length < 2) return ids[0];
  const middle = Math.ceil(ids.length / 2);
  return {
    axis: arrangement === "columns" ? "horizontal" : "vertical",
    ratio: (middle / ids.length) * 100,
    first: arrangeBrowsers(ids.slice(0, middle), arrangement)!,
    second: arrangeBrowsers(ids.slice(middle), arrangement)!,
  };
}

/** Direction follows the visible splits, even after arbitrary nested docking. */
export function neighboringBrowser(
  layout: BrowserLayout,
  id: string,
  direction: DockSide,
): string | undefined {
  const tiles = browserLayoutGeometry(layout).tiles;
  const source = tiles[id];
  if (!source) return undefined;
  const horizontal = direction === "left" || direction === "right";
  const forward = direction === "right" || direction === "bottom";
  const along = horizontal ? "x" : "y",
    across = horizontal ? "y" : "x";
  const length = horizontal ? "width" : "height",
    crossLength = horizontal ? "height" : "width";
  const candidates = Object.entries(tiles).filter(
    ([other, rect]) =>
      other !== id &&
      (forward
        ? rect[along] >= source[along] + source[length] - 0.01
        : rect[along] + rect[length] <= source[along] + 0.01),
  );
  const score = (rect: BrowserRect) => {
    const overlap =
      Math.min(source[across] + source[crossLength], rect[across] + rect[crossLength]) -
      Math.max(source[across], rect[across]);
    return (
      (overlap > 0 ? 0 : 1000) +
      Math.abs(rect[along] + rect[length] / 2 - source[along] - source[length] / 2) +
      Math.abs(rect[across] + rect[crossLength] / 2 - source[across] - source[crossLength] / 2) / 10
    );
  };
  return candidates.sort((a, b) => score(a[1]) - score(b[1]))[0]?.[0];
}

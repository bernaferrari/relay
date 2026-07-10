/**
 * Screen graph layout for Stage Map — free-form nodes + curved edges.
 * Pure functions so layout/path math can be unit-tested without DOM.
 *
 * Supports:
 *  - Organic wrap layout
 *  - Fail/heal branch lanes (status-aware Y offsets)
 *  - Per-node card size (flexible aspect)
 *  - Typed edges (flow / fail / heal)
 */

export type ScreenStatus = "pass" | "fail" | "heal" | "idle";
export type EdgeKind = "flow" | "fail" | "heal";

export type ScreenNode = {
  id: string;
  index: number;
  x: number;
  y: number;
  /** Resolved card width in world px */
  w: number;
  /** Resolved card height in world px */
  h: number;
  caption: string;
  src: string;
  status: ScreenStatus;
  /** Edge label into this node (from previous). */
  edgeLabel?: string;
  /** Optional image aspect (width/height). Defaults to phone portrait. */
  aspect?: number;
};

export type ScreenEdge = {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  /** SVG path `d` in world space */
  path: string;
  /** Midpoint for label placement */
  midX: number;
  midY: number;
};

export type GraphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

/** Default phone-ish portrait (~9:19.5). */
export const SCREEN_ASPECT = 9 / 19.5;
export const SCREEN_CARD_W = 200;
/** Default height from phone aspect (rounded). */
export const SCREEN_CARD_H = Math.round(SCREEN_CARD_W / SCREEN_ASPECT);
export const SCREEN_PAD = 88;
/** Horizontal gap between cards — scale-friendly breathing room. */
export const SCREEN_GAP_X = 88;
/** Vertical gap between wrapped rows (main lane). */
export const SCREEN_GAP_Y = 96;
/** Within-row organic Y amplitude. */
export const SCREEN_ROW_STAGGER = 36;
/** Start a new row every N screens so the map never becomes an infinite strip. */
export const SCREEN_WRAP_COLS = 5;
/** Fail branch sits below the main lane. */
export const BRANCH_FAIL_Y = 168;
/** Heal recovery sits between main and fail. */
export const BRANCH_HEAL_Y = 72;

export type ScreenNodeInput = Omit<ScreenNode, "x" | "y" | "w" | "h"> & {
  w?: number;
  h?: number;
  aspect?: number;
};

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Resolve card pixel size from optional aspect / explicit dims.
 * Aspect is width/height (e.g. 9/19.5 for phone). Landscape > 1.
 */
export function cardSize(opts?: { aspect?: number; width?: number; height?: number }): {
  w: number;
  h: number;
} {
  const width = opts?.width ?? SCREEN_CARD_W;
  if (opts?.height != null && opts.height > 0) {
    return { w: width, h: Math.round(opts.height) };
  }
  const aspect =
    opts?.aspect != null && opts.aspect > 0.15 && opts.aspect < 4 ? opts.aspect : SCREEN_ASPECT;
  // Cap extreme aspects so layout stays stable
  const a = clamp(aspect, 0.35, 2.2);
  return { w: width, h: Math.round(width / a) };
}

/** Row/col for sequential index with fixed column wrap. */
export function wrapIndex(
  index: number,
  cols: number = SCREEN_WRAP_COLS,
): { row: number; col: number } {
  const c = Math.max(1, cols);
  return { row: Math.floor(index / c), col: index % c };
}

/**
 * Deterministic vertical offset so a row feels free-form, not a rigid strip.
 * Wave: 0, +1, +0.55, 0, −0.55, −1, …
 */
export function staggerY(index: number): number {
  const phase = index % 6;
  const table = [0, 1, 0.55, 0, -0.55, -1] as const;
  return table[phase]! * SCREEN_ROW_STAGGER;
}

/** Tiny deterministic horizontal jitter for organic Atlas energy. */
export function staggerX(index: number): number {
  const phase = index % 5;
  const table = [0, 10, -6, 14, -10] as const;
  return table[phase]!;
}

/** Extra Y for fail/heal so the path visually branches. */
export function branchLaneY(status: ScreenStatus): number {
  if (status === "fail") return BRANCH_FAIL_Y;
  if (status === "heal") return BRANCH_HEAL_Y;
  return 0;
}

/**
 * Default world position for a node index on the main grid (no branch offset).
 */
export function defaultNodePosition(
  index: number,
  cols: number = SCREEN_WRAP_COLS,
  cardH: number = SCREEN_CARD_H,
): { x: number; y: number } {
  const { row, col } = wrapIndex(index, cols);
  const cellW = SCREEN_CARD_W + SCREEN_GAP_X;
  const cellH = cardH + SCREEN_GAP_Y;
  // Brick offset on odd rows keeps the freeform feel without serpentine chaos
  const brick = row % 2 === 1 ? cellW * 0.22 : 0;
  return {
    x: SCREEN_PAD + col * cellW + brick + staggerX(index),
    y: SCREEN_PAD + row * cellH + staggerY(index),
  };
}

/**
 * Auto-layout screens with organic free-form grid (wrap + stagger) and
 * status-aware branch lanes (fail below, heal mid).
 * Optional overrides pin user-dragged positions.
 * Optional aspectOverrides map id → width/height aspect for flexible cards.
 */
export function layoutScreenGraph(
  inputs: ScreenNodeInput[],
  overrides?: Map<string, { x: number; y: number }>,
  cols: number = SCREEN_WRAP_COLS,
  aspectOverrides?: Map<string, number>,
): ScreenNode[] {
  // Use max card height in each wrap-row for vertical packing of main grid
  const sizes = inputs.map((n) => {
    const aspect = aspectOverrides?.get(n.id) ?? n.aspect;
    return cardSize({ aspect, width: n.w, height: n.h });
  });
  const rowMaxH = new Map<number, number>();
  for (let i = 0; i < inputs.length; i++) {
    const { row } = wrapIndex(i, cols);
    rowMaxH.set(row, Math.max(rowMaxH.get(row) ?? 0, sizes[i]!.h));
  }

  // Cumulative row base Y
  const rowBaseY = new Map<number, number>();
  let accY = SCREEN_PAD;
  const maxRow = inputs.length === 0 ? 0 : wrapIndex(inputs.length - 1, cols).row;
  for (let r = 0; r <= maxRow; r++) {
    rowBaseY.set(r, accY);
    accY += (rowMaxH.get(r) ?? SCREEN_CARD_H) + SCREEN_GAP_Y;
  }

  return inputs.map((n, i) => {
    const size = sizes[i]!;
    const pinned = overrides?.get(n.id);
    if (pinned) {
      return {
        ...n,
        x: pinned.x,
        y: pinned.y,
        w: size.w,
        h: size.h,
        aspect: aspectOverrides?.get(n.id) ?? n.aspect,
      };
    }
    const { row, col } = wrapIndex(i, cols);
    const cellW = SCREEN_CARD_W + SCREEN_GAP_X;
    const brick = row % 2 === 1 ? cellW * 0.22 : 0;
    const baseY = rowBaseY.get(row) ?? SCREEN_PAD;
    const x = SCREEN_PAD + col * cellW + brick + staggerX(i);
    const y = baseY + staggerY(i) + branchLaneY(n.status);
    return {
      ...n,
      x,
      y,
      w: size.w,
      h: size.h,
      aspect: aspectOverrides?.get(n.id) ?? n.aspect,
    };
  });
}

export function graphBounds(nodes: ScreenNode[]): GraphBounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  const pad = SCREEN_PAD;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

type Port = { x: number; y: number };

function cardPorts(n: ScreenNode): {
  left: Port;
  right: Port;
  top: Port;
  bottom: Port;
  cx: number;
  cy: number;
} {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  return {
    left: { x: n.x, y: cy },
    right: { x: n.x + n.w, y: cy },
    top: { x: cx, y: n.y },
    bottom: { x: cx, y: n.y + n.h },
    cx,
    cy,
  };
}

/**
 * Pick exit/entry ports based on relative placement so edges look good
 * after wrap rows, branch lanes, and free-form drag.
 */
export function pickEdgePorts(from: ScreenNode, to: ScreenNode): { start: Port; end: Port } {
  const a = cardPorts(from);
  const b = cardPorts(to);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const avgH = (from.h + to.h) / 2;

  // Mostly vertical (row wrap, branch lane, or stacked drags)
  if (absY > absX * 0.85 && absY > avgH * 0.35) {
    if (dy > 0) return { start: a.bottom, end: b.top };
    return { start: a.top, end: b.bottom };
  }

  // Mostly horizontal
  if (dx >= 0) return { start: a.right, end: b.left };
  return { start: a.left, end: b.right };
}

/** Estimate label chip width (px) for mono-ish 9–10px UI type. */
export function estimateLabelWidth(label: string): number {
  if (!label) return 0;
  // ~5.6px per char at 9.5px medium + horizontal padding
  return Math.min(148, Math.max(28, Math.round(label.length * 5.6 + 18)));
}

/**
 * Cubic bezier between smart ports. Control points follow the dominant axis
 * so wrap-row elbows, branch dives, and freeform drags stay readable.
 */
export function edgePath(
  from: ScreenNode,
  to: ScreenNode,
): { path: string; midX: number; midY: number } {
  const { start, end } = pickEdgePorts(from, to);
  const x1 = start.x;
  const y1 = start.y;
  const x2 = end.x;
  const y2 = end.y;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  let c1x: number;
  let c1y: number;
  let c2x: number;
  let c2y: number;

  if (absY > absX * 0.85) {
    // Vertical-dominant: pull control points along Y
    const pull = Math.max(56, absY * 0.42);
    c1x = x1;
    c1y = y1 + Math.sign(dy || 1) * pull;
    c2x = x2;
    c2y = y2 - Math.sign(dy || 1) * pull;
  } else {
    // Horizontal-dominant (or diagonal): classic side handles
    const pull = Math.max(48, absX * 0.42);
    c1x = x1 + Math.sign(dx || 1) * pull;
    c1y = y1;
    c2x = x2 - Math.sign(dx || 1) * pull;
    c2y = y2;
  }

  const path = `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
  // Cubic midpoint at t=0.5
  const t = 0.5;
  const u = 1 - t;
  const midX = u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2;
  const midY = u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2;
  return { path, midX, midY };
}

/** Classify sequential edge from node statuses. */
export function edgeKindFor(from: ScreenNode, to: ScreenNode): EdgeKind {
  if (to.status === "fail") return "fail";
  if (to.status === "heal") return "heal";
  // Recovery: left a fail and landed on pass/idle → heal path back
  if (from.status === "fail" && (to.status === "pass" || to.status === "idle")) return "heal";
  if (from.status === "heal" && to.status === "pass") return "heal";
  return "flow";
}

export function buildEdges(nodes: ScreenNode[]): ScreenEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ordered = [...nodes].sort((a, b) => a.index - b.index);
  const edges: ScreenEdge[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i]!;
    const b = ordered[i + 1]!;
    const from = byId.get(a.id)!;
    const to = byId.get(b.id)!;
    const kind = edgeKindFor(from, to);
    const { path, midX, midY } = edgePath(from, to);
    const defaultLabel =
      kind === "fail"
        ? "fail"
        : kind === "heal"
          ? "heal"
          : b.edgeLabel || shortEdgeLabel(b.caption);
    edges.push({
      from: a.id,
      to: b.id,
      kind,
      label: kind === "flow" ? b.edgeLabel || shortEdgeLabel(b.caption) : defaultLabel,
      path,
      midX,
      midY,
    });
  }
  return edges;
}

function shortEdgeLabel(caption: string): string {
  const c = caption.trim();
  if (!c) return "→";
  if (c.length <= 22) return c;
  return `${c.slice(0, 20)}…`;
}

/** Fit scale so world bounds sit inside a viewport with padding. */
export function fitViewport(
  bounds: GraphBounds,
  viewW: number,
  viewH: number,
  pad = 48,
  minScale = 0.15,
  maxScale = 1.2,
): { x: number; y: number; scale: number } {
  if (viewW <= 0 || viewH <= 0) return { x: 0, y: 0, scale: 0.6 };
  const scale = clamp(
    Math.min((viewW - pad * 2) / bounds.width, (viewH - pad * 2) / bounds.height),
    minScale,
    maxScale,
  );
  const x = (viewW - bounds.width * scale) / 2 - bounds.minX * scale;
  const y = (viewH - bounds.height * scale) / 2 - bounds.minY * scale;
  return { x, y, scale };
}

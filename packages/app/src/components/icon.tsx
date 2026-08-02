import { type JSX } from "solid-js";

/**
 * Crisp, consistent icon set (lucide-style, 1.5 stroke, currentColor).
 * Replaces the emoji / unicode glyphs that made the old UI look amateurish.
 *
 * Two flavors:
 *  - stroke (default): outline icons
 *  - fill: solid marks (play, dots) where a filled glyph reads better
 */
export type IconName =
  | "chevron-up"
  | "chevron-down"
  | "chevron-right"
  | "chevron-left"
  | "play"
  | "pause"
  | "square"
  | "refresh"
  | "undo"
  | "redo"
  | "search"
  | "panel-left"
  | "sliders"
  | "command"
  | "camera"
  | "video"
  | "scan"
  | "grid"
  | "trash"
  | "check"
  | "x"
  | "alert"
  | "info"
  | "smartphone"
  | "server"
  | "folder"
  | "bolt"
  | "external"
  | "slash"
  | "arrow-right"
  | "pointer"
  | "keyboard"
  | "clock"
  | "move"
  | "hand"
  | "map"
  | "download"
  | "upload"
  | "bag"
  | "login"
  | "sparkle"
  | "circle"
  | "dot"
  | "wave"
  | "plus"
  | "copy"
  | "edit"
  | "more";

type Path = { d: string; fill?: boolean };

const STROKE: Record<string, Path[]> = {
  "chevron-down": [{ d: "m6 9 6 6 6-6" }],
  "chevron-right": [{ d: "m9 18 6-6-6-6" }],
  "chevron-left": [{ d: "m15 18-6-6 6-6" }],
  "chevron-up": [{ d: "m18 15-6-6-6 6" }],
  refresh: [
    { d: "M20 11a8 8 0 0 0-14.7-4.3L4 9" },
    { d: "M4 4v5h5" },
    { d: "M4 13a8 8 0 0 0 14.7 4.3L20 15" },
    { d: "M20 20v-5h-5" },
  ],
  undo: [{ d: "m9 14-5-5 5-5" }, { d: "M4 9h10a6 6 0 0 1 6 6v1" }],
  redo: [{ d: "m15 14 5-5-5-5" }, { d: "M20 9H10a6 6 0 0 0-6 6v1" }],
  search: [{ d: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" }, { d: "m21 21-4.3-4.3" }],
  "panel-left": [
    { d: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
    { d: "M9 3v18" },
  ],
  sliders: [{ d: "M4 6h16M4 12h16M4 18h16" }, { d: "M7 3v6M17 9v6M12 15v6" }],
  command: [{ d: "M9 9a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v6a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" }],
  camera: [
    {
      d: "M4 7h3l1.8-2.2a1 1 0 0 1 .77-.37h4.86a1 1 0 0 1 .77.37L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z",
    },
    { d: "M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
  ],
  video: [
    { d: "M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" },
    { d: "m17 10 5-3v10l-5-3z" },
  ],
  scan: [
    {
      d: "M4 8V5a1 1 0 0 1 1-1h3M17 4h3a1 1 0 0 1 1 1v3M21 16v3a1 1 0 0 1-1 1h-3M7 20H5a1 1 0 0 1-1-1v-3",
    },
    { d: "M4 12h16" },
  ],
  grid: [{ d: "M4 4h6v6H4zM14 4h6v6h-6zM14 14h6v6h-6zM4 14h6v6H4z" }],
  trash: [
    { d: "M4 6h16M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" },
    { d: "M6 6v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6M10 11v5M14 11v5" },
  ],
  check: [{ d: "M5 12.5 10 17 19 6.5" }],
  x: [{ d: "M6 6l12 12M18 6 6 18" }],
  alert: [
    { d: "M12 3 2.5 19a1 1 0 0 0 .9 1.5h17.2a1 1 0 0 0 .9-1.5L12 3z" },
    { d: "M12 10v4M12 17.5h.01" },
  ],
  info: [{ d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" }, { d: "M12 11v5M12 7.5h.01" }],
  smartphone: [
    { d: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" },
    { d: "M11 18h2" },
  ],
  server: [
    { d: "M5 3h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" },
    { d: "M5 14h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z" },
    { d: "M8 6.5h.01M8 17.5h.01" },
  ],
  folder: [
    {
      d: "M4 20a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5.5a1 1 0 0 1 .8.4L12 6h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1z",
    },
  ],
  external: [{ d: "M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" }],
  slash: [{ d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" }, { d: "m5.6 5.6 12.8 12.8" }],
  "arrow-right": [{ d: "M4 12h16M14 6l6 6-6 6" }],
  pointer: [{ d: "M4 3l6.5 17 2.2-6.3 6.3-2.2z" }],
  keyboard: [
    { d: "M3 6h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" },
    { d: "M7 10h.01M11 10h.01M15 10h.01M9 13h.01M13 13h.01M7 16h10" },
  ],
  clock: [{ d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" }, { d: "M12 7.5V12l3 2" }],
  move: [{ d: "M3 12h18M8 7l-4 5 4 5M16 7l4 5-4 5" }],
  hand: [
    { d: "M7.5 11V7.5a1.5 1.5 0 0 1 3 0V11" },
    { d: "M10.5 11V5.5a1.5 1.5 0 0 1 3 0V11" },
    { d: "M13.5 11V7a1.5 1.5 0 0 1 3 0v5" },
    {
      d: "M16.5 12V9.5a1.5 1.5 0 0 1 3 0v4.75C19.5 18.5 16.5 21 12.5 21h-1c-2.7 0-4.4-1.2-5.8-3.2L3.3 14.4a1.6 1.6 0 0 1 2.5-2l1.7 1.5",
    },
  ],
  map: [{ d: "M3 6.5 8 4l8 2.5L21 4v13.5L16 20l-8-2.5L3 20z" }, { d: "M8 4v13.5M16 6.5V20" }],
  download: [{ d: "M12 3v12M7 10l5 5 5-5M5 21h14" }],
  upload: [{ d: "M12 21V9M7 14l5-5 5 5M5 3h14" }],
  bag: [{ d: "M5 7h14l-1 13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 7z" }, { d: "M9 7a3 3 0 0 1 6 0" }],
  login: [{ d: "M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l4 4-4 4M14 12H3" }],
  wave: [{ d: "M3 12c2 0 2-5 4-5s2 10 4 10 2-10 4-10 2 5 4 5" }],
  plus: [{ d: "M12 5v14M5 12h14" }],
  copy: [
    { d: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z" },
    { d: "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" },
  ],
  edit: [{ d: "M4 20h4L19 9l-4-4L4 16z" }, { d: "m13.5 6.5 4 4" }],
};

const FILL: Record<string, Path[]> = {
  play: [{ d: "M6 4.5v15l13-7.5z", fill: true }],
  square: [{ d: "M6 6h12v12H6z", fill: true }],
  pause: [
    { d: "M6 4.5h4v15H6z", fill: true },
    { d: "M14 4.5h4v15h-4z", fill: true },
  ],
  sparkle: [
    {
      d: "M12 2c.6 6.2 3.8 9.4 10 10-6.2.6-9.4 3.8-10 10-.6-6.2-3.8-9.4-10-10 6.2-.6 9.4-3.8 10-10z",
      fill: true,
    },
  ],
  circle: [{ d: "M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0", fill: true }],
  dot: [{ d: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0", fill: true }],
  more: [
    { d: "M5 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0", fill: true },
    { d: "M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0", fill: true },
    { d: "M19 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0", fill: true },
  ],
};

const ALL: Record<string, Path[]> = { ...STROKE, ...FILL };

const INFO_FALLBACK: Path[] = [
  { d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" },
  { d: "M12 11v5M12 7.5h.01" },
];

export function Icon(props: {
  name: IconName;
  size?: number;
  class?: string;
  style?: JSX.CSSProperties;
  "aria-hidden"?: boolean;
  strokeWidth?: number;
}): JSX.Element {
  const size = () => props.size ?? 16;
  const paths = (): Path[] => ALL[props.name] ?? INFO_FALLBACK;
  const isFill = (p: Path) => p.fill;
  return (
    <svg
      class={`ic ${props.class ?? ""}`}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth ?? 1.6}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={props["aria-hidden"] ?? true}
      style={props.style}
    >
      {paths().map((p) =>
        isFill(p) ? <path d={p.d} fill="currentColor" stroke="none" /> : <path d={p.d} />,
      )}
    </svg>
  );
}

/** glyph → { icon, label } metadata for step badges (single source of truth). */
export const GLYPH_META: Record<string, { icon: IconName; label: string }> = {
  tap: { icon: "pointer", label: "tap" },
  type: { icon: "keyboard", label: "type" },
  wait: { icon: "clock", label: "wait" },
  shot: { icon: "camera", label: "screenshot" },
  swipe: { icon: "move", label: "swipe" },
  ok: { icon: "check", label: "check" },
  fail: { icon: "x", label: "fail" },
  ai: { icon: "sparkle", label: "AI heal" },
  dl: { icon: "download", label: "download" },
  re: { icon: "refresh", label: "retry" },
  store: { icon: "bag", label: "store" },
  login: { icon: "login", label: "login" },
};

/** glyph → icon name (derived from GLYPH_META for backward compat). */
export const GLYPH_ICON: Record<string, IconName> = Object.fromEntries(
  Object.entries(GLYPH_META).map(([k, v]) => [k, v.icon]),
);

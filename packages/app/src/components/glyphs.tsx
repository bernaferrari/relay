import { For } from "solid-js";

/** Unicode stand-ins for qa-viewer lucide glyphs (no icon pack required). */
const MAP: Record<string, string> = {
  tap: "🖱",
  type: "⌨",
  wait: "⏱",
  shot: "📷",
  swipe: "↕",
  ok: "✓",
  fail: "✗",
  ai: "✦",
  dl: "↓",
  re: "↺",
  store: "▣",
  login: "⌁",
};

export function Glyphs(props: { glyphs?: string[]; size?: "sm" | "md" }) {
  const list = () => props.glyphs ?? [];
  return (
    <span class="gly" classList={{ "gly--md": props.size === "md" }} aria-hidden="true">
      <For each={list()}>
        {(g) => (
          <span class="gly__i" title={g}>
            {MAP[g] ?? "·"}
          </span>
        )}
      </For>
    </span>
  );
}

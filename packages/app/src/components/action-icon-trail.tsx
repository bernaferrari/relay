import { For, Show, type JSX } from "solid-js";
import { Icon, GLYPH_ICON, GLYPH_META } from "./icon";
import { cn } from "../lib/cn";

/**
 * Tiny per-action icon trail — one glyph per low-level action a step
 * performed (tap, wait, type, ...), overflow collapsed as "+N". Steps
 * without recorded glyph data render nothing; callers should gate on
 * `glyphs.length > 0` rather than always mounting this.
 */
export function ActionIconTrail(props: {
  glyphs: string[];
  max?: number;
  class?: string;
}): JSX.Element {
  const max = () => props.max ?? 6;
  const shown = () => props.glyphs.slice(0, max());
  const overflow = () => Math.max(0, props.glyphs.length - max());
  return (
    <span class={cn("inline-flex shrink-0 items-center gap-0.5", props.class)} aria-hidden="true">
      <For each={shown()}>
        {(glyph) => (
          <span
            class="grid size-4 shrink-0 place-items-center rounded text-text-weaker"
            data-tip={GLYPH_META[glyph]?.label ?? glyph}
          >
            <Show
              when={GLYPH_ICON[glyph]}
              fallback={<i class="size-1 rounded-full bg-text-weaker" />}
            >
              {(name) => <Icon name={name()} size={10} />}
            </Show>
          </span>
        )}
      </For>
      <Show when={overflow() > 0}>
        <span class="pl-0.5 font-mono text-micro tabular-nums text-text-weaker">+{overflow()}</span>
      </Show>
    </span>
  );
}

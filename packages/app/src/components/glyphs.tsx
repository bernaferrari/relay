import { For, Show } from "solid-js";
import { Icon, GLYPH_ICON, GLYPH_META } from "./icon";

/** Step-action glyphs rendered as crisp SVG (replaces the old unicode emoji). */
export function Glyphs(props: { glyphs?: string[]; size?: "sm" | "md"; max?: number }) {
  const list = () => props.glyphs ?? [];
  const shown = () =>
    props.max && list().length > props.max ? list().slice(0, props.max) : list();
  const extra = () => (props.max ? Math.max(0, list().length - props.max) : 0);
  return (
    <span class="gly" classList={{ "gly--md": props.size === "md" }} aria-hidden="true">
      <For each={shown()}>
        {(g) => (
          <Show when={GLYPH_ICON[g]} fallback={<span class="gly__dot" />}>
            {(name) => (
              <span class="gly__i" title={GLYPH_META[g]?.label ?? g}>
                <Icon name={name()} size={props.size === "md" ? 16 : 13} />
              </span>
            )}
          </Show>
        )}
      </For>
      <Show when={extra() > 0}>
        <span class="gly__more mono">+{extra()}</span>
      </Show>
    </span>
  );
}

import { For, Show } from "solid-js";
import { Icon, GLYPH_ICON } from "./icon";

/** Step-action glyphs rendered as crisp SVG (replaces the old unicode emoji). */
export function Glyphs(props: { glyphs?: string[]; size?: "sm" | "md" }) {
  const list = () => props.glyphs ?? [];
  return (
    <span class="gly" classList={{ "gly--md": props.size === "md" }} aria-hidden="true">
      <For each={list()}>
        {(g) => (
          <Show when={GLYPH_ICON[g]} fallback={<span class="gly__dot" />}>
            {(name) => (
              <span class="gly__i" title={g}>
                <Icon name={name()} size={props.size === "md" ? 16 : 13} />
              </span>
            )}
          </Show>
        )}
      </For>
    </span>
  );
}

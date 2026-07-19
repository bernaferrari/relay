import { For, Show, createSignal, onMount } from "solid-js";
import { useTheme, type ColorScheme } from "@relay/ui/theme/context";
import { cn } from "../lib/cn";
import { seg, segBtn, segBtnOn } from "../lib/ui";
import { Icon } from "./icon";

const rowCls =
  "flex items-center justify-between gap-4 border-b border-border-weak-base py-3 last:border-b-0";
const rowCopyCls = "flex min-w-0 flex-col gap-0.5";
const rowTitleCls = "text-12-medium text-text-strong";
const rowDescCls = "text-12-regular leading-snug text-text-weak";

export function AppearanceSettingsPanel() {
  const theme = useTheme();
  const [themeIds, setThemeIds] = createSignal<string[]>([]);
  const [query, setQuery] = createSignal("");
  const [showAllThemes, setShowAllThemes] = createSignal(false);
  onMount(() => {
    void theme.loadThemes().then(() => setThemeIds(theme.ids()));
  });
  const filteredThemes = () => {
    const queryValue = query().trim().toLowerCase();
    const list = themeIds().length ? themeIds() : theme.ids();
    const filtered = queryValue
      ? list.filter((id) => {
          const name = theme.name(id).toLowerCase();
          return name.includes(queryValue) || id.includes(queryValue);
        })
      : list;
    if (queryValue || showAllThemes()) return filtered;
    const preferred = [
      "relay",
      "system",
      "github",
      "vercel",
      "opencode",
      "vesper",
      "nord",
      "rosepine",
    ];
    const curated = preferred.filter((id) => filtered.includes(id));
    return [...curated, ...filtered.filter((id) => !curated.includes(id))].slice(0, 8);
  };
  return (
    <>
      <div class={rowCls}>
        <div class={rowCopyCls}>
          <span class={rowTitleCls}>Color scheme</span>
          <span class={rowDescCls}>
            Light, dark, or follow the OS. Active:{" "}
            <span class="font-mono tabular-nums">{theme.mode()}</span>
          </span>
        </div>
        <div class="shrink-0">
          <div class={seg} role="group" aria-label="Color scheme">
            {(
              [
                ["system", "System"],
                ["light", "Light"],
                ["dark", "Dark"],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                class={cn(segBtn, theme.colorScheme() === id && segBtnOn)}
                onClick={() => theme.setColorScheme(id as ColorScheme)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div class="mt-4 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3">
          <div>
            <span class="block text-14-medium text-text-strong">Theme</span>
            <span class="mt-0.5 block text-12-regular text-text-weak">
              A curated set of comfortable defaults.
            </span>
          </div>
          <Show when={showAllThemes()}>
            <input
              class="h-8 w-[200px] rounded-control border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-12-regular text-text-strong focus:border-border-focus focus:outline-none"
              type="search"
              placeholder="Search themes…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </Show>
        </div>
        <div class="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2.5">
          <For each={filteredThemes()}>
            {(id) => {
              const sw = () => theme.swatches(id);
              return (
                <button
                  type="button"
                  class={cn(
                    "ui-hover-lift flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha p-3 text-left",
                    "transition-[border-color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                    "hover:border-border-strong-base ",
                    theme.themeId() === id &&
                      "border-border-interactive-base shadow-[0_0_0_1px_var(--surface-brand-base)]",
                  )}
                  onClick={() => theme.setTheme(id)}
                  title={theme.name(id)}
                >
                  <span
                    class="relative h-12 overflow-hidden rounded-lg border border-border-weak-base"
                    style={{
                      background: sw()?.bg ?? "var(--background-base)",
                      "border-color": sw()?.primary ?? "var(--border-weak-base)",
                    }}
                  >
                    <span
                      class="absolute top-2 right-2 size-3 rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-strong)_20%,transparent)]"
                      style={{ background: sw()?.primary ?? "var(--button-primary-base)" }}
                    />
                    <span
                      class="absolute right-0 bottom-0 left-0 h-3.5"
                      style={{ background: sw()?.surface ?? "var(--surface-raised-base)" }}
                    />
                  </span>
                  <span class="truncate text-12-medium text-text-strong">{theme.name(id)}</span>
                </button>
              );
            }}
          </For>
        </div>
        <button
          type="button"
          class="mt-1 inline-flex min-h-9 items-center justify-center gap-1.5 self-start rounded-md px-2.5 text-12-medium text-text-base hover:bg-surface-raised-base-hover hover:text-text-strong"
          onClick={() => {
            setShowAllThemes((open) => !open);
            setQuery("");
          }}
        >
          {showAllThemes()
            ? "Show curated themes"
            : `Browse all ${themeIds().length || theme.ids().length} themes`}
          <Icon name={showAllThemes() ? "chevron-up" : "chevron-down"} size={13} />
        </button>
      </div>
    </>
  );
}

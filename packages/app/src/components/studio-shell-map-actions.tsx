import { Show, createSignal } from "solid-js";
import { cn } from "../lib/cn";
import { createStudioActionMenuBehavior } from "../lib/studio-action-menu-behavior";
import { chromeMenuItem, chromeMenuItemDanger, productIconButton } from "../lib/ui";
import { Icon } from "./icon";

export type StudioShellMapAction =
  | "toggle-properties"
  | "open-properties"
  | "undo"
  | "redo"
  | "tidy"
  | "history"
  | "duplicate"
  | "export"
  | "help"
  | "delete";

export function StudioShellMapActions(props: {
  propertiesOpen: boolean;
  onAction: (action: StudioShellMapAction) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  const behavior = createStudioActionMenuBehavior({
    open,
    setOpen,
    trigger: () => trigger,
    menu: () => menu,
  });

  function choose(action: StudioShellMapAction): void {
    setOpen(false);
    if (action === "help") trigger?.focus({ preventScroll: true });
    props.onAction(action);
    if (action === "tidy") queueMicrotask(() => trigger?.focus());
  }

  return (
    <div class="relative flex items-center gap-1.5">
      <button
        type="button"
        aria-pressed={props.propertiesOpen}
        class={cn(
          productIconButton,
          "max-[760px]:hidden",
          props.propertiesOpen && "bg-surface-base-active",
        )}
        aria-label="Map properties"
        data-tip="Map properties"
        onClick={() => choose("toggle-properties")}
      >
        <Icon name="sliders" size={16} />
      </button>
      <button
        ref={(element) => (trigger = element)}
        class={productIconButton}
        type="button"
        aria-label="More map options"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls="app-map-options-menu"
        data-tip="More map options"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" size={16} />
      </button>
      <Show when={open()}>
        <div
          ref={(element) => (menu = element)}
          id="app-map-options-menu"
          class="ui-pop absolute top-[calc(100%+6px)] right-0 z-40 grid w-[200px] gap-0.5 rounded-xl border border-[var(--border-strong-base)] bg-surface-raised-stronger-non-alpha p-1 shadow-[var(--shadow-lg)]"
          role="menu"
          aria-label="Map options"
          onFocusOut={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && event.currentTarget.contains(next)) return;
            setOpen(false);
          }}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            const items = behavior.visibleItems();
            if (!items.length) return;
            event.preventDefault();
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : event.key === "ArrowDown"
                    ? (current + 1 + items.length) % items.length
                    : (current - 1 + items.length) % items.length;
            items[next]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            class={cn("hidden max-[760px]:flex", chromeMenuItem)}
            onClick={() => choose("open-properties")}
          >
            <Icon name="sliders" size={14} /> Map properties
          </button>
          <button
            type="button"
            role="menuitem"
            class={cn("flex", chromeMenuItem)}
            onClick={() => choose("undo")}
          >
            <Icon name="undo" size={14} />
            <span class="flex-1">Undo</span>
            <kbd class="text-micro font-normal text-[var(--text-weaker)]">⌘Z</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            class={cn("flex", chromeMenuItem)}
            onClick={() => choose("redo")}
          >
            <Icon name="redo" size={14} />
            <span class="flex-1">Redo</span>
            <kbd class="text-micro font-normal text-[var(--text-weaker)]">⇧⌘Z</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            class={cn("flex", chromeMenuItem)}
            aria-label="Tidy map"
            data-tip="Arrange every screen into a compact path"
            onClick={() => choose("tidy")}
          >
            <Icon name="grid" size={14} /> Tidy map
          </button>
          <button
            type="button"
            role="menuitem"
            class={cn("flex", chromeMenuItem)}
            onClick={() => choose("history")}
          >
            <Icon name="clock" size={14} /> Version history
          </button>
          <button
            type="button"
            role="menuitem"
            class={cn("flex", chromeMenuItem)}
            onClick={() => choose("duplicate")}
          >
            <Icon name="copy" size={14} /> Duplicate map
          </button>
          <button
            type="button"
            role="menuitem"
            class={cn("flex", chromeMenuItem)}
            onClick={() => choose("export")}
          >
            <Icon name="download" size={14} /> Export map
          </button>
          <button
            type="button"
            role="menuitem"
            class={cn("flex", chromeMenuItem)}
            onClick={() => choose("help")}
          >
            <Icon name="info" size={14} /> Help
            <kbd class="ml-auto text-micro font-normal text-[var(--text-weaker)]">⌘K</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            class={cn("flex", chromeMenuItemDanger)}
            onClick={() => choose("delete")}
          >
            <Icon name="trash" size={14} /> Delete map
          </button>
        </div>
      </Show>
    </div>
  );
}

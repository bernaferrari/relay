import { For, onMount } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { recordGoldenLoopHelp } from "../lib/golden-loop-telemetry";
import { modalPanel, modalScrim, productIconButton } from "../lib/ui";
import { Icon } from "./icon";

/**
 * The shortcut cheat sheet behind ⌘K / Help. Rendered as a centered dialog
 * so the canvas stays visible behind it.
 */
export function StudioShellShortcutsSheet(props: { onClose: () => void }) {
  const server = useServer();
  onMount(() => recordGoldenLoopHelp(server.selectedAppMapId() ?? "local-workspace"));
  return (
    <div
      class={cn(modalScrim, "z-[var(--z-modal-nested)] flex items-center justify-center p-5")}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        class={cn(modalPanel, "w-[min(100%,420px)] outline-none")}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <header class="flex items-center justify-between border-b border-border-weak-base px-4 py-3">
          <h2 class="m-0 text-title font-medium tracking-tight text-text-strong">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            class={productIconButton}
            aria-label="Close shortcuts"
            onClick={() => props.onClose()}
          >
            <Icon name="x" size={14} />
          </button>
        </header>
        <div class="grid gap-0.5 p-3">
          <For
            each={[
              ["Tools", "V / H / D", "Select, pan (hand), and device"],
              ["Pan canvas", "Space + drag", "Temporarily grab the canvas"],
              ["Command palette", "⌘K", "Search every command"],
              ["Zoom", "+ / −", "Zoom the map in and out"],
              ["Undo", "⌘Z", "Undo the last canvas edit"],
              ["Redo", "⇧⌘Z", "Redo an undone edit"],
            ]}
          >
            {([name, keys, description]) => (
              <div class="flex min-h-9 items-center gap-3 rounded-md px-2 hover:bg-surface-raised-base-hover">
                <span class="min-w-0 flex-1">
                  <span class="block text-caption font-medium text-text-strong">{name}</span>
                  <span class="block text-micro text-text-weak">{description}</span>
                </span>
                <kbd class="shrink-0 rounded bg-surface-base px-1.5 py-0.5 font-mono text-micro text-text-weak">
                  {keys}
                </kbd>
              </div>
            )}
          </For>
          <p class="m-0 px-2 pt-2 text-micro/[1.5] text-text-weak">
            Product flows and walkthroughs live in{" "}
            <code class="font-mono">docs/PRODUCT_FLOWS.md</code>.
          </p>
        </div>
      </section>
    </div>
  );
}

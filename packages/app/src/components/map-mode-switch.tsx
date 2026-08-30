import { cn } from "../lib/cn";
import { Icon } from "./icon";

/**
 * Every destination a single map has. Relay used to carry two tab strips forty
 * pixels apart — a document switcher ("Test | Canvas") in the top bar and a
 * floating view strip ("Canvas | Screens | Results") over the canvas — which
 * left no honest answer to "which row am I in?". A file has one row of modes.
 *
 * "map" rather than "canvas" as the identifier so the canvas keeps the name the
 * workspace, the wheel guard and the reveal-screen command already use for it.
 */
export type MapMode = "map" | "screens" | "coverage" | "test";

/** The canvas owns three of the four modes; the fourth swaps the whole pane. */
export type MapCanvasView = Exclude<MapMode, "test">;

const MODES = [
  ["test", "play", "Test", "Author and run one trusted path"],
  ["map", "map", "Map", "The screens and the paths between them"],
  ["screens", "grid", "Screens", "Every screen as a grid"],
  ["coverage", "check", "Results", "What ran, and how it went"],
] as const;

export function MapModeSwitch(props: { value: MapMode; onChange: (value: MapMode) => void }) {
  const moveFocus = (event: KeyboardEvent, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? MODES.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + MODES.length) % MODES.length;
    const mode = MODES[next]![0];
    props.onChange(mode);
    queueMicrotask(() =>
      document.querySelector<HTMLButtonElement>(`[data-map-mode="${mode}"]`)?.focus(),
    );
  };

  return (
    <div
      class="flex h-10 items-center rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-0.5 max-[900px]:h-11 max-[560px]:w-full"
      role="tablist"
      aria-label="Workspace view"
    >
      {MODES.map(([mode, icon, label, tip], index) => (
        <button
          type="button"
          role="tab"
          data-map-mode={mode}
          data-tip={tip}
          aria-selected={props.value === mode}
          tabindex={props.value === mode ? 0 : -1}
          class={cn(
            "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 text-caption font-medium transition-[background-color,color,box-shadow] duration-hover active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-[var(--border-strong-focus)] max-[900px]:min-h-10 max-[560px]:flex-1",
            props.value === mode
              ? "bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-sm"
              : "text-[var(--text-weak)] hover:text-[var(--text-base)]",
          )}
          aria-label={label}
          onClick={() => props.onChange(mode)}
          onKeyDown={(event) => moveFocus(event, index)}
        >
          <Icon name={icon} size={12} />
          {/* These are primary destinations, so their names must remain visible
              on touch screens where hover-only tips do not exist. At phone
              widths the shell gives this switcher its own full-width row. */}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

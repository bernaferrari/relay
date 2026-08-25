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
  ["map", "map", "Canvas", "The screens and the paths between them"],
  ["screens", "grid", "Screens", "Every screen as a grid"],
  ["coverage", "check", "Results", "What ran, and how it went"],
  ["test", "play", "Test", "Author and run one path"],
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
      class="flex h-9 items-center rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-0.5"
      role="tablist"
      aria-label="Map mode"
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
            "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-caption font-medium transition-[background-color,color,box-shadow] duration-hover active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-[var(--border-strong-focus)]",
            props.value === mode
              ? "bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-sm"
              : "text-[var(--text-weak)] hover:text-[var(--text-base)]",
          )}
          aria-label={label}
          onClick={() => props.onChange(mode)}
          onKeyDown={(event) => moveFocus(event, index)}
        >
          <Icon name={icon} size={12} />
          {/* Four labelled segments plus the device picker overrun a narrow
              window, so the three modes a person is not in give up their labels
              first. The one they are in never does: "where am I" has to stay
              answered without hovering for a tooltip. */}
          <span class={cn(props.value !== mode && "max-[1180px]:hidden")}>{label}</span>
        </button>
      ))}
    </div>
  );
}

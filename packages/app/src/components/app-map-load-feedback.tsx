import { Show } from "solid-js";
import { Icon } from "./icon";

export function AppMapLoadFeedback(props: {
  status: "loading" | "error";
  failure?: { title: string; guidance: string; detail?: string };
  onRetry: () => void;
}) {
  return (
    <div class="app-map-canvas relative grid h-full min-h-0 w-full min-w-0 place-items-center overflow-hidden px-6 text-center">
      <div
        class="app-map-grid pointer-events-none absolute inset-0 opacity-60"
        aria-hidden="true"
      />
      <section
        class="relative z-[1] grid max-w-[380px] justify-items-center gap-3"
        role={props.status === "error" ? "alert" : "status"}
        aria-live={props.status === "error" ? "assertive" : "polite"}
      >
        <span class="grid size-11 place-items-center rounded-[13px] bg-[var(--map-control-surface)] text-[var(--text-interactive-base)] shadow-[var(--map-elevation-control)]">
          <Icon
            name={props.status === "error" ? "alert" : "refresh"}
            size={17}
            class={props.status === "loading" ? "ui-refresh-spin motion-reduce:opacity-70" : ""}
          />
        </span>
        <div class="grid gap-1.5">
          <h2 class="m-0 text-[18px]/[1.25] font-semibold tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            {props.status === "error"
              ? (props.failure?.title ?? "This map couldn’t be opened")
              : "Opening map…"}
          </h2>
          <p class="m-0 text-[12.5px]/[1.55] text-[var(--text-weak)]">
            {props.status === "error"
              ? (props.failure?.guidance ??
                "Your saved map has not been replaced. Check Relay’s connection and try again.")
              : "Loading its screens, paths, and screenshots."}
          </p>
        </div>
        <Show when={props.status === "error" && props.failure?.detail}>
          <details class="w-full rounded-[10px] bg-[var(--map-control-surface)] px-3 py-2 text-left text-[11px]/[1.5] text-[var(--text-base)] shadow-[var(--map-elevation-control)]">
            <summary class="cursor-pointer font-medium text-[var(--text-strong)]">
              Technical details
            </summary>
            <p class="m-0 mt-2 break-words font-mono text-[10px] text-[var(--text-weak)]">
              {props.failure?.detail}
            </p>
          </details>
        </Show>
        <Show when={props.status === "error"}>
          <button
            type="button"
            class="canvas-tool-control inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-[var(--product-accent-soft)] px-4 text-[12px] font-semibold text-[var(--text-interactive-base)] outline-none transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--text-interactive-base)_18%,transparent)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--background-base)]"
            onClick={props.onRetry}
          >
            <Icon name="refresh" size={13} /> Try again
          </button>
        </Show>
      </section>
    </div>
  );
}

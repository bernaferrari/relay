import { Show } from "solid-js";
import type { AppMap } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import { eyebrow, modalPanel, modalScrim, productIconButton } from "../lib/ui";
import { Icon } from "./icon";

export type ImportReview = { yaml: string; appMap: AppMap; exists: boolean };

/**
 * Importing a portable map is the one place a person can silently overwrite
 * work, so the file states its own name, size and text before anything lands.
 */
export function StudioImportReviewDialog(props: {
  review: ImportReview;
  /** The shell traps focus in whatever element this reports. */
  ref: (element: HTMLElement) => void;
  onCancel: () => void;
  onConfirm: (conflict: "replace" | "copy") => void;
}) {
  const screenCount = () => Object.keys(props.review.appMap.screens).length;
  const connectionCount = () => Object.keys(props.review.appMap.connections).length;
  return (
    <div
      class={cn(modalScrim, "z-[var(--z-modal-nested)] flex items-center justify-center p-5")}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onCancel();
      }}
    >
      <section
        ref={props.ref}
        class={cn(modalPanel, "grid w-[min(100%,480px)] gap-0 overflow-hidden rounded-xl")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-review-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onCancel();
        }}
      >
        <header class="flex items-start justify-between gap-3 border-b border-[var(--border-weak-base)] px-4 py-3.5">
          <div>
            <span class={eyebrow}>Map file</span>
            <h3
              id="import-review-title"
              class="mt-1 text-title font-semibold text-[var(--text-strong)]"
            >
              {props.review.exists ? "This map already exists" : "Import this map?"}
            </h3>
          </div>
          <button
            type="button"
            class={productIconButton}
            aria-label="Close import review"
            onClick={props.onCancel}
          >
            <Icon name="x" size={14} />
          </button>
        </header>
        <div class="mx-4 mt-3.5 flex items-center gap-3 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-3">
          <span class="grid size-9 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--icon-success-base)_12%,transparent)] text-[var(--icon-success-base)]">
            <Icon name="check" size={16} />
          </span>
          <div class="min-w-0">
            <strong class="block text-body text-[var(--text-strong)]">
              {props.review.appMap.name}
            </strong>
            <small class="block text-caption text-[var(--text-weak)]">
              {props.review.appMap.id} · {screenCount()} screen{screenCount() === 1 ? "" : "s"} ·{" "}
              {connectionCount()} connection{connectionCount() === 1 ? "" : "s"}
            </small>
          </div>
        </div>
        <details class="mx-4 my-3 rounded-lg border border-[var(--border-weak-base)] bg-[var(--background-deep)] px-3 py-2">
          <summary class="cursor-pointer text-caption text-[var(--text-base)]">
            Preview portable YAML
          </summary>
          <pre class="mt-2 max-h-48 overflow-auto font-mono text-caption/[1.5] text-[var(--text-weak)]">
            {props.review.yaml}
          </pre>
        </details>
        <footer class="flex items-center justify-between gap-3 border-t border-[var(--border-weak-base)] px-4 py-3">
          <p class="m-0 max-w-[28ch] text-caption/[1.45] text-[var(--text-weak)]">
            {props.review.exists
              ? "Replace this map, or import a separate copy with the same screens and paths."
              : "Relay will add this portable map to the current project."}
          </p>
          <div class="flex shrink-0 flex-wrap justify-end gap-2">
            <Button variant="secondary" size="lg" onClick={props.onCancel}>
              Cancel
            </Button>
            <Show when={props.review.exists}>
              <Button variant="secondary" size="lg" onClick={() => props.onConfirm("copy")}>
                Import copy
              </Button>
            </Show>
            <Button variant="primary" size="lg" onClick={() => props.onConfirm("replace")}>
              {props.review.exists ? "Replace map" : "Import map"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

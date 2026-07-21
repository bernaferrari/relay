import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { cn } from "../lib/cn";
import { modalPanel, modalScrim, productSecondary } from "../lib/ui";

export type ConfirmRequest = {
  title: string;
  /** One sentence describing what is about to happen and to what. */
  body: string;
  confirmLabel: string;
  /** Destructive styles the confirm button red; default is the neutral primary. */
  tone?: "destructive" | "default";
  onConfirm: () => void | Promise<void>;
};

const [request, setRequest] = createSignal<ConfirmRequest | null>(null);

/**
 * In-app confirmation. `window.confirm` is suppressed in embedded shells
 * (Electron webviews, browser panes), which silently turns "confirm then
 * delete" into "delete" — so destructive actions must confirm here instead.
 */
export function confirmAction(next: ConfirmRequest): void {
  setRequest(next);
}

export function ConfirmDialogHost(): JSX.Element {
  let confirmButton: HTMLButtonElement | undefined;
  const close = () => setRequest(null);
  const confirm = () => {
    const active = request();
    close();
    if (active) void active.onConfirm();
  };
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!request()) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
  });
  return (
    <Show when={request()}>
      {(active) => {
        queueMicrotask(() => confirmButton?.focus());
        return (
          <div
            class={cn(modalScrim, "z-[160] flex items-center justify-center p-5")}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <section
              class={cn(modalPanel, "w-[min(100%,400px)] rounded-xl p-4")}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              aria-describedby="confirm-dialog-body"
            >
              <h2
                id="confirm-dialog-title"
                class="m-0 text-[15px] font-semibold text-[var(--text-strong)]"
              >
                {active().title}
              </h2>
              <p id="confirm-dialog-body" class="mt-1.5 mb-4 text-[12.5px]/[1.5] text-text-weak">
                {active().body}
              </p>
              <div class="flex justify-end gap-2">
                <button type="button" class={productSecondary} onClick={close}>
                  Cancel
                </button>
                <button
                  ref={(element) => (confirmButton = element)}
                  type="button"
                  class={cn(
                    productSecondary,
                    active().tone !== "default" &&
                      "bg-[color-mix(in_srgb,var(--icon-critical-base)_14%,transparent)] text-icon-critical-base shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--icon-critical-base)_38%,transparent)] hover:enabled:bg-[color-mix(in_srgb,var(--icon-critical-base)_22%,transparent)] hover:enabled:text-icon-critical-base",
                  )}
                  onClick={confirm}
                >
                  {active().confirmLabel}
                </button>
              </div>
            </section>
          </div>
        );
      }}
    </Show>
  );
}

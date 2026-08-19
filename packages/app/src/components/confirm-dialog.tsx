import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import { modalPanel, modalScrim } from "../lib/ui";
import { trapFocus } from "../lib/modal";

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
  let dialog: HTMLElement | undefined;
  let releaseFocus: (() => void) | undefined;
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
  createEffect(() => {
    if (!request()) {
      releaseFocus?.();
      releaseFocus = undefined;
      return;
    }
    queueMicrotask(() => {
      if (request() && dialog) releaseFocus = trapFocus(dialog);
    });
  });
  onCleanup(() => releaseFocus?.());
  return (
    <Show when={request()}>
      {(active) => {
        return (
          <div
            class={cn(modalScrim, "z-[var(--z-alert)] flex items-center justify-center p-5")}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <section
              ref={(element) => (dialog = element)}
              class={cn(modalPanel, "w-[min(100%,400px)] rounded-xl p-4")}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              aria-describedby="confirm-dialog-body"
            >
              <h2
                id="confirm-dialog-title"
                class="m-0 text-title font-semibold text-[var(--text-strong)]"
              >
                {active().title}
              </h2>
              <p id="confirm-dialog-body" class="mt-1.5 mb-4 text-body/[1.5] text-text-weak">
                {active().body}
              </p>
              <div class="flex justify-end gap-2">
                <Button variant="secondary" size="lg" onClick={close}>
                  Cancel
                </Button>
                <Button
                  variant={active().tone === "default" ? "primary" : "danger"}
                  size="lg"
                  onClick={confirm}
                >
                  {active().confirmLabel}
                </Button>
              </div>
            </section>
          </div>
        );
      }}
    </Show>
  );
}

import { Show, type JSX } from "solid-js";
import { cn } from "../lib/cn";
import { eyebrow, mono, modalPanel } from "../lib/ui";
import { Icon } from "./icon";

const START_COMMAND = "pnpm dev:serve";

/**
 * A missing local service is an unmet prerequisite, not a fault: the work
 * behind the scrim is still mounted and inert, so the card says so first and
 * then names the one command that clears it. The state is carried by an icon,
 * a subject label and a tint together — never by colour alone.
 */
export function OfflineGateSurface(props: {
  children: JSX.Element;
  retryControl: JSX.Element;
  offline: boolean;
  /** Why the last manual retry failed. Replaces the automatic-recheck line. */
  retryError?: string;
  serverUrl?: string;
  overlay?: boolean;
  dialogRef?: (element: HTMLDivElement) => void;
}) {
  return (
    <div class={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", props.overlay && "h-full")}>
      <div
        class="flex min-h-0 min-w-0 flex-1 flex-col"
        aria-hidden={props.offline ? "true" : undefined}
        // Keep stale work visible as context without leaving its controls in the tab order.
        inert={props.offline}
      >
        {props.children}
      </div>
      <Show when={props.offline}>
        <div
          class={cn(
            "ui-scrim absolute inset-0 z-[var(--z-scrim)] grid place-items-center p-6",
            "backdrop-blur-[3px]",
          )}
        >
          <div
            class={cn(modalPanel, "w-[min(100%,384px)] p-5")}
            role="alertdialog"
            aria-labelledby="offline-gate-subject offline-gate-title"
            aria-describedby="offline-gate-desc"
            ref={props.dialogRef}
            tabIndex={-1}
          >
            <div class="flex items-start gap-3">
              <span
                class="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-critical-weak text-icon-critical-base ring-1 ring-inset ring-border-critical-base/30"
                aria-hidden="true"
              >
                <Icon name="server" size={16} />
              </span>
              <div class="min-w-0 pt-px">
                <span id="offline-gate-subject" class={eyebrow}>
                  Local service
                </span>
                <h2
                  id="offline-gate-title"
                  class="m-0 mt-0.5 text-title font-semibold tracking-[-0.01em] text-balance text-text-strong"
                >
                  Not connected
                </h2>
              </div>
            </div>

            <p id="offline-gate-desc" class="m-0 mt-3 max-w-[44ch] text-body/[1.5] text-text-base">
              Your open work is still here. Start the service and the app picks up where you left
              off.
            </p>

            <details class="group mt-3">
              <summary class="-mx-1 flex min-h-8 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-caption font-medium text-text-weak marker:content-none hover:text-text-strong focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--border-focus)] [&::-webkit-details-marker]:hidden">
                <Icon
                  name="chevron-right"
                  size={12}
                  class="transition-transform duration-hover group-open:rotate-90 motion-reduce:transition-none"
                />
                Connection details
              </summary>
              <div class="mt-1.5 grid gap-2.5 rounded-lg bg-surface-base p-2.5 ring-1 ring-inset ring-border-weak-base">
                <div class="grid gap-1.5">
                  <span class="text-caption text-text-weak">Start it with</span>
                  {/* One click selects the whole command — the retry button stays
                      the only focusable control, so it still owns opening focus. */}
                  <code
                    class={cn(
                      mono,
                      "flex min-h-8 select-all items-center rounded-md bg-surface-raised-stronger-non-alpha px-2",
                      "cursor-text text-caption text-text-strong ring-1 ring-inset ring-border-weak-base",
                    )}
                  >
                    {START_COMMAND}
                  </code>
                </div>
                <Show when={props.serverUrl}>
                  {(url) => (
                    <div class="grid gap-1">
                      <span class="text-caption text-text-weak">Expecting</span>
                      <p class={cn(mono, "m-0 truncate text-caption text-text-base")}>{url()}</p>
                    </div>
                  )}
                </Show>
              </div>
            </details>

            <footer class="-mx-5 -mb-5 mt-4 flex items-center justify-between gap-3 border-t border-border-weak-base bg-surface-base px-5 py-3">
              <Show
                when={props.retryError}
                fallback={
                  <p class="m-0 flex items-center gap-1.5 text-caption text-text-weak">
                    <span
                      class="size-1.5 shrink-0 rounded-full bg-text-weaker motion-safe:animate-pulse"
                      aria-hidden="true"
                    />
                    Waiting for the local service…
                  </p>
                }
              >
                {(message) => (
                  <p
                    class="m-0 flex max-w-[26ch] items-start gap-1.5 text-caption/[1.35] text-text-critical-base"
                    role="alert"
                  >
                    {/* Dark-mode critical text is a pale tint, so the mark — not
                        the colour — is what makes a failed attempt legible. */}
                    <Icon name="alert" size={12} class="mt-px shrink-0 text-icon-critical-base" />
                    {message()}
                  </p>
                )}
              </Show>
              {props.retryControl}
            </footer>
          </div>
        </div>
      </Show>
    </div>
  );
}

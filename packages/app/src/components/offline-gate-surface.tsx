import { Show, type JSX } from "solid-js";
import { cn } from "../lib/cn";
import { mono, modalPanel } from "../lib/ui";

export function OfflineGateSurface(props: {
  children: JSX.Element;
  retryControl: JSX.Element;
  offline: boolean;
  serverUrl?: string;
  overlay?: boolean;
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
            "ui-scrim absolute inset-0 z-40 grid place-items-center",
            props.overlay && "rounded-none",
          )}
          role="alertdialog"
          aria-labelledby="offline-gate-title"
          aria-describedby="offline-gate-desc"
        >
          <div
            class={cn(
              modalPanel,
              "flex max-w-[340px] flex-col items-center gap-1.5 px-9 py-8 text-center shadow-lg-border-base",
            )}
          >
            <span class="mb-1 size-2 rounded-full bg-icon-critical-base" aria-hidden="true" />
            <h2 id="offline-gate-title" class="m-0 text-14-medium tracking-tight text-text-strong">
              Relay isn’t connected
            </h2>
            <p
              id="offline-gate-desc"
              class="m-0 max-w-[260px] text-14-regular leading-relaxed text-text-base"
            >
              Start Relay’s local service, then try again.
            </p>
            <div class="mt-5">{props.retryControl}</div>
            <details class="mt-3 w-full text-left">
              <summary class="cursor-pointer text-12-regular text-text-weaker hover:text-text-weak">
                Connection details
              </summary>
              <div class="mt-2 grid gap-1.5 rounded-md bg-surface-base px-2.5 py-2">
                <code class={cn(mono, "text-12-regular text-text-strong")}>pnpm dev:serve</code>
                <Show when={props.serverUrl}>
                  <p class={cn(mono, "m-0 text-12-regular text-text-weak")}>{props.serverUrl}</p>
                </Show>
              </div>
            </details>
          </div>
        </div>
      </Show>
    </div>
  );
}

import { Show, type JSX, createSignal } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { Button } from "@relay/ui/button";
import { mono, modalPanel } from "../lib/ui";

/**
 * Full-stage / full-workspace overlay when the API is offline.
 * Keeps chrome (topbar) usable so theme/settings still work.
 */
export function OfflineGate(props: {
  children: JSX.Element;
  /** When true, only overlay the stage area (parent positions relatively). */
  overlay?: boolean;
}) {
  const server = useServer();
  const [busy, setBusy] = createSignal(false);

  async function retry() {
    setBusy(true);
    try {
      await server.retryConnection();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", props.overlay && "h-full")}>
      {props.children}
      <Show when={server.isOffline()}>
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
              Server offline
            </h2>
            <p
              id="offline-gate-desc"
              class="m-0 max-w-[260px] text-14-regular leading-relaxed text-text-base"
            >
              Stage can’t reach the API. Start the local server, then retry.
            </p>
            <code
              class={cn(
                mono,
                "mt-3 rounded-md bg-surface-base px-2.5 py-1 text-12-regular text-text-strong shadow-xs-border-base",
              )}
            >
              pnpm dev:serve
            </code>
            <Show when={server.serverUrl()}>
              <p class={cn(mono, "mt-1.5 text-12-regular text-text-weak")}>{server.serverUrl()}</p>
            </Show>
            <div class="mt-5">
              <Button
                variant="primary"
                size="normal"
                disabled={busy()}
                onClick={() => void retry()}
              >
                {busy() ? "Checking…" : "Retry connection"}
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

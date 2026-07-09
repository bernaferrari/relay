import { Show, type JSX, createSignal } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { btnAcc, mono } from "../lib/ui";

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
            "absolute inset-0 z-30 grid place-items-center bg-deep/70 backdrop-blur-sm",
            props.overlay && "rounded-none",
          )}
          role="alertdialog"
          aria-labelledby="offline-gate-title"
          aria-describedby="offline-gate-desc"
        >
          <div class="flex max-w-[360px] flex-col items-center gap-1.5 rounded-card bg-layer-1 px-10 py-9 text-center shadow-[0_16px_48px_rgb(0_0_0/0.32)]">
            <div class="relative mb-2.5 h-10 w-14" aria-hidden="true">
              <span class="absolute bottom-0 left-0 h-2 w-3 origin-bottom animate-pulse rounded-[3px] bg-fail opacity-35" />
              <span class="absolute bottom-0 left-4 h-2 w-3 origin-bottom animate-pulse rounded-[3px] bg-fail opacity-35 [animation-delay:200ms]" />
              <span class="absolute bottom-0 left-8 h-2 w-3 origin-bottom animate-pulse rounded-[3px] bg-fail opacity-35 [animation-delay:400ms]" />
              <span class="absolute top-[-2px] left-1/2 size-1.5 -translate-x-1/2 animate-pulse rounded-full bg-fail" />
            </div>
            <h2
              id="offline-gate-title"
              class="m-0 text-title font-semibold tracking-tight text-text"
            >
              Server offline
            </h2>
            <p id="offline-gate-desc" class="m-0 mt-1 text-body leading-normal text-text-muted">
              The Specimen API is not reachable. Start it locally, then retry.
            </p>
            <code
              class={cn(
                mono,
                "mt-2.5 rounded-md bg-layer-2 px-2.5 py-1 text-meta text-accent-soft",
              )}
            >
              pnpm dev:serve
            </code>
            <Show when={server.serverUrl()}>
              <p class={cn(mono, "text-meta text-text-faint")}>{server.serverUrl()}</p>
            </Show>
            <div class="mt-4">
              <button type="button" class={btnAcc} disabled={busy()} onClick={() => void retry()}>
                {busy() ? "Checking…" : "Retry connection"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

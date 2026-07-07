import { Show, type JSX, createSignal } from "solid-js";
import { useServer } from "../context/server";

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
    <>
      {props.children}
      <Show when={server.isOffline()}>
        <div
          class={props.overlay ? "offline-gate offline-gate--overlay" : "offline-gate"}
          role="alertdialog"
          aria-labelledby="offline-gate-title"
          aria-describedby="offline-gate-desc"
        >
          <div class="offline-gate__card">
            <div class="offline-gate__illus" aria-hidden="true">
              <span class="offline-gate__bar" />
              <span class="offline-gate__bar offline-gate__bar--mid" />
              <span class="offline-gate__bar offline-gate__bar--short" />
              <span class="offline-gate__pulse" />
            </div>
            <h2 id="offline-gate-title" class="offline-gate__title">
              Server offline
            </h2>
            <p id="offline-gate-desc" class="offline-gate__desc">
              The Specimen API is not reachable. Start it locally, then retry.
            </p>
            <code class="offline-gate__code mono">pnpm dev:serve</code>
            <Show when={server.serverUrl()}>
              <p class="offline-gate__url mono">{server.serverUrl()}</p>
            </Show>
            <div class="offline-gate__actions">
              <button
                type="button"
                class="btn btn-acc"
                disabled={busy()}
                onClick={() => void retry()}
              >
                {busy() ? "Checking…" : "Retry connection"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}

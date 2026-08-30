import { Show, type JSX, createEffect, createSignal, onCleanup } from "solid-js";
import { useServer } from "../context/server";
import { Button } from "@relay/ui/button";
import { createGuardedRetry } from "../lib/offline-retry";
import { Icon } from "./icon";
import { OfflineGateSurface } from "./offline-gate-surface";
import { focusFirstAndRestore } from "../lib/modal";

/**
 * Full-stage / full-workspace overlay when the API is offline.
 * Keeps chrome (topbar) usable so theme/settings still work.
 */
export function OfflineGate(props: {
  children: JSX.Element;
  /** When true, only overlay the stage area (parent positions relatively). */
  overlay?: boolean;
  /** Narrow injectable boundary keeps connection state host-agnostic and testable. */
  connection?: {
    isOffline: () => boolean;
    serverUrl: () => string;
    retryConnection: () => Promise<void>;
  };
}) {
  const server = props.connection ?? useServer();
  const [busy, setBusy] = createSignal(false);
  const [retryError, setRetryError] = createSignal("");
  const retry = createGuardedRetry(server.retryConnection, setBusy);
  let dialog: HTMLDivElement | undefined;
  let releaseFocus: (() => void) | undefined;

  createEffect(() => {
    if (server.isOffline() && dialog) {
      releaseFocus?.();
      releaseFocus = focusFirstAndRestore(dialog);
    } else {
      releaseFocus?.();
      releaseFocus = undefined;
    }
  });
  onCleanup(() => releaseFocus?.());

  async function retrySafely(): Promise<void> {
    setRetryError("");
    try {
      await retry();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <OfflineGateSurface
      offline={server.isOffline()}
      serverUrl={server.serverUrl()}
      overlay={props.overlay}
      dialogRef={(element) => {
        dialog = element;
      }}
      retryError={retryError()}
      retryControl={
        <Button
          variant="primary"
          size="normal"
          class="shrink-0"
          disabled={busy()}
          aria-busy={busy()}
          onClick={() => void retrySafely()}
        >
          <Show when={busy()}>
            <Icon name="refresh" size={13} class="ui-refresh-spin motion-reduce:opacity-70" />
          </Show>
          {busy() ? "Checking…" : "Check now"}
        </Button>
      }
    >
      {props.children}
    </OfflineGateSurface>
  );
}

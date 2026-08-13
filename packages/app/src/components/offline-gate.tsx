import { type JSX, createSignal } from "solid-js";
import { useServer } from "../context/server";
import { Button } from "@relay/ui/button";
import { createGuardedRetry } from "../lib/offline-retry";
import { OfflineGateSurface } from "./offline-gate-surface";

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
  const retry = createGuardedRetry(server.retryConnection, setBusy);

  return (
    <OfflineGateSurface
      offline={server.isOffline()}
      serverUrl={server.serverUrl()}
      overlay={props.overlay}
      retryControl={
        <Button
          variant="primary"
          size="normal"
          disabled={busy()}
          aria-busy={busy()}
          onClick={() => void retry()}
        >
          {busy() ? "Checking…" : "Retry connection"}
        </Button>
      }
    >
      {props.children}
    </OfflineGateSurface>
  );
}

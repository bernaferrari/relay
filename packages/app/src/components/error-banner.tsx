import { createEffect, on } from "solid-js";
import { useServer } from "../context/server";

/**
 * Bridge server.error() into the toast queue (AB-quiet: no global critical strip).
 * Offline is OfflineGate only — never double-shout.
 */
export function ErrorBanner() {
  const server = useServer();
  let last = "";

  createEffect(
    on(
      () => ({ msg: server.error(), offline: server.isOffline() }),
      ({ msg, offline }) => {
        if (!msg || offline) {
          if (!msg) last = "";
          return;
        }
        if (msg === last) return;
        last = msg;
        window.dispatchEvent(
          new CustomEvent("stage:toast", {
            detail: { text: msg, tone: "error" as const, ttl: 5600 },
          }),
        );
      },
    ),
  );

  return null;
}

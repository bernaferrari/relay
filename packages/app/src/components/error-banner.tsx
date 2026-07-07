import { Show } from "solid-js";
import { Icon } from "./icon";
import { useServer } from "../context/server";

/** Dismissible global error strip — only when server.error() is set. */
export function ErrorBanner() {
  const server = useServer();

  return (
    <Show when={server.error() && !server.isOffline()}>
      <div class="error-banner" role="alert">
        <span class="error-banner__mark" aria-hidden="true">
          <Icon name="alert" size={11} />
        </span>
        <p class="error-banner__text">{server.error()}</p>
        <button
          type="button"
          class="btn btn-ghost error-banner__dismiss"
          aria-label="Dismiss error"
          onClick={() => server.dismissError()}
        >
          <Icon name="x" size={13} />
          Dismiss
        </button>
      </div>
    </Show>
  );
}

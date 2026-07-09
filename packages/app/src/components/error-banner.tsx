import { Show } from "solid-js";
import { Icon } from "./icon";
import { useServer } from "../context/server";

/** Dismissible global error strip — only when server.error() is set. */
export function ErrorBanner() {
  const server = useServer();

  return (
    <Show when={server.error() && !server.isOffline()}>
      <div
        class="flex h-9 shrink-0 items-center gap-2.5 border-b border-[var(--v2-state-border-danger)] bg-[var(--v2-state-bg-danger)] px-3.5 text-meta text-fail"
        role="alert"
      >
        <span
          class="grid size-[18px] shrink-0 place-items-center rounded-full bg-fail text-meta font-bold text-[var(--v2-text-text-contrast,#fff)]"
          aria-hidden="true"
        >
          <Icon name="alert" size={11} />
        </span>
        <p class="m-0 min-w-0 flex-1 truncate">{server.error()}</p>
        <button
          type="button"
          class="btn btn-ghost shrink-0"
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

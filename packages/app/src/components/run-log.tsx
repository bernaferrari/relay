import { For, Show, createEffect } from "solid-js";
import { Button } from "@grok-device/ui/button";
import { useServer } from "../context/server";

export function ActivityLog() {
  const server = useServer();
  let scroller: HTMLDivElement | undefined;

  createEffect(() => {
    server.logs();
    queueMicrotask(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  return (
    <aside class="activity">
      <div class="sidebar__head">
        <h2 class="app-panel__title">Activity</h2>
        <Button variant="ghost" size="sm" onClick={() => server.clearLogs()}>
          Clear
        </Button>
      </div>
      <div class="activity__body" ref={scroller}>
        <Show
          when={server.logs().length > 0}
          fallback={<div class="empty">Live job logs stream here (SSE).</div>}
        >
          <For each={server.logs()}>
            {(line) => (
              <div class={`log-line log-line--${line.level}`}>
                <span class="log-line__time">
                  {new Date(line.at).toLocaleTimeString(undefined, { hour12: false })}
                </span>
                <span class="log-line__text">{line.text}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
      <Show when={server.error()}>
        <div class="activity__error">{server.error()}</div>
      </Show>
    </aside>
  );
}

import { For, Show, createEffect, on } from "solid-js";
import { Button } from "@grok-device/ui/button";
import { useServer } from "../context/server";

export function RunLog() {
  const server = useServer();
  let scroller: HTMLDivElement | undefined;

  createEffect(
    on(
      () => server.logs().length,
      () => {
        queueMicrotask(() => {
          if (scroller) scroller.scrollTop = scroller.scrollHeight;
        });
      },
    ),
  );

  return (
    <section class="app-panel" aria-label="Run log">
      <div class="run-bar">
        <h2 class="app-panel__title" style={{ margin: 0 }}>
          Log
        </h2>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <Button variant="ghost" size="sm" onClick={() => server.clearLogs()}>
            Clear
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={server.running() || !server.selectedAction() || !server.selectedDevice()}
            onClick={() => void server.runAction()}
          >
            {server.running() ? "Running…" : "Run"}
          </Button>
        </div>
      </div>
      <div class="run-log" ref={scroller} role="log" aria-live="polite">
        <Show
          when={server.logs().length > 0}
          fallback={<div class="run-log__empty">Select a device and action, then press Run.</div>}
        >
          <For each={server.logs()}>
            {(line) => (
              <div class="run-log__line" data-level={line.level}>
                {line.text}
              </div>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}

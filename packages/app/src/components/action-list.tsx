import { For, Show, createMemo } from "solid-js";
import { Button } from "@grok-device/ui/button";
import { useServer, type ActionInfo } from "../context/server";

export function ActionPanel() {
  const server = useServer();

  const groups = createMemo(() => {
    const byCat = new Map<string, ActionInfo[]>();
    for (const a of server.actions()) {
      const list = byCat.get(a.category) ?? [];
      list.push(a);
      byCat.set(a.category, list);
    }
    return [...byCat.entries()];
  });

  return (
    <div class="workspace-panel">
      <div class="workspace-toolbar">
        <div class="workspace-toolbar__left">
          <h2 class="app-panel__title" style={{ margin: 0 }}>
            Test actions
          </h2>
          <Show when={server.selectedAction()}>
            <span class="header-chip">{server.selectedAction()}</span>
          </Show>
        </div>
        <div class="workspace-toolbar__right">
          <label class="check">
            <input
              type="checkbox"
              checked={server.skipAccountSwitch()}
              onChange={(e) => server.setSkipAccountSwitch(e.currentTarget.checked)}
            />
            skip account
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={server.skipRestoreHome()}
              onChange={(e) => server.setSkipRestoreHome(e.currentTarget.checked)}
            />
            skip restore
          </label>
          <Button
            variant="primary"
            size="sm"
            disabled={server.running() || !server.selectedAction() || server.health() !== "online"}
            onClick={() => void server.runSelected()}
          >
            {server.running() ? "Running…" : "Run"}
          </Button>
        </div>
      </div>

      <div class="action-groups">
        <For each={groups()}>
          {([category, actions]) => (
            <section class="action-group">
              <h3 class="action-group__title">{category}</h3>
              <div class="list">
                <For each={actions}>
                  {(a) => (
                    <button
                      type="button"
                      class="list-item list-item--action"
                      classList={{ "list-item--selected": server.selectedAction() === a.id }}
                      onClick={() => server.setSelectedAction(a.id)}
                      onDblClick={() => {
                        server.setSelectedAction(a.id);
                        void server.runSelected();
                      }}
                    >
                      <span class="list-item__title">{a.title}</span>
                      <span class="list-item__meta">{a.description ?? a.id}</span>
                    </button>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>
      <p class="hint">Double-click an action to run · ⌘K for command palette</p>
    </div>
  );
}

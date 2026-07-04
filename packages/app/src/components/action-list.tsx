import { For, Show, createMemo } from "solid-js";
import { Badge } from "@grok-device/ui/badge";
import { useServer, type ActionInfo } from "../context/server";

const CATEGORY_ORDER = ["play-store", "grok"] as const;

const CATEGORY_LABEL: Record<string, string> = {
  "play-store": "Play Store",
  grok: "Grok",
};

export function ActionList() {
  const server = useServer();

  const grouped = createMemo(() => {
    const map = new Map<string, ActionInfo[]>();
    for (const action of server.actions()) {
      const cat = action.category || "other";
      const list = map.get(cat) ?? [];
      list.push(action);
      map.set(cat, list);
    }
    const keys = [
      ...CATEGORY_ORDER.filter((k) => map.has(k)),
      ...[...map.keys()].filter((k) => !(CATEGORY_ORDER as readonly string[]).includes(k)).sort(),
    ];
    return keys.map((key) => ({
      key,
      label: CATEGORY_LABEL[key] ?? key,
      items: map.get(key) ?? [],
    }));
  });

  return (
    <section class="app-panel" aria-label="Actions" style={{ "border-right": "none" }}>
      <div class="run-bar">
        <h2 class="app-panel__title" style={{ margin: 0 }}>
          Actions
        </h2>
      </div>
      <Show
        when={server.actions().length > 0}
        fallback={<p class="empty-state">No actions available from server.</p>}
      >
        <For each={grouped()}>
          {(group) => (
            <div class="category-group">
              <h3 class="category-group__label">
                <Badge variant={group.key === "grok" ? "primary" : "default"}>{group.label}</Badge>
              </h3>
              <div class="list" role="listbox" aria-label={`${group.label} actions`}>
                <For each={group.items}>
                  {(action) => (
                    <button
                      type="button"
                      class="list-item"
                      role="option"
                      data-selected={server.selectedAction() === action.id ? "true" : undefined}
                      aria-selected={server.selectedAction() === action.id}
                      onClick={() => server.setSelectedAction(action.id)}
                    >
                      <span class="list-item__title">{action.title}</span>
                      <Show when={action.description}>
                        <span class="list-item__meta">{action.description}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </Show>
    </section>
  );
}

/**
 * OpenCode-style left rail: recipes + run history (clean rows, no chip soup).
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useServer, type ActionInfo } from "../context/server";
import { useRecorder, type CustomRecipe } from "../context/recorder";
import { Icon } from "./icon";
import { EmptyState } from "./empty-state";
import { RecipeEditor } from "./recipe-editor";
import { statusTone, fmtDur } from "../lib/job";

export function Sidebar() {
  const server = useServer();
  const rec = useRecorder();
  const [editingRecipe, setEditingRecipe] = createSignal<CustomRecipe | "new" | null>(null);

  const groups = createMemo(() => {
    const byCat = new Map<string, ActionInfo[]>();
    for (const a of server.actions()) {
      const list = byCat.get(a.category) ?? [];
      list.push(a);
      byCat.set(a.category, list);
    }
    return [...byCat.entries()];
  });

  const catLabel = (c: string) => {
    if (c === "play-store") return "Play Store";
    if (c === "grok") return "Grok app";
    return c;
  };

  return (
    <aside class="sidebar" aria-label="Recipes and history">
      <div class="sidebar__section">
        <div class="sidebar__head">
          <span class="sidebar__label">Recipes</span>
          <span class="sidebar__count mono">{server.actions().length}</span>
        </div>
        <div class="sidebar__scroll">
          <div class="sidebar__group">
            <div class="sidebar__group-label">
              Custom
              <button
                type="button"
                class="sidebar__new-btn"
                title="Create a new recipe"
                onClick={() => setEditingRecipe("new")}
              >
                <Icon name="chevron-right" size={12} />
                New
              </button>
            </div>
            <For each={rec.recipes()}>
              {(r) => (
                <button
                  type="button"
                  class="nav-row"
                  classList={{ on: rec.selectedRecipeId() === r.id }}
                  title={`Custom · ${r.steps.length} steps — double-click to replay`}
                  onClick={() => {
                    rec.setSelectedRecipeId(r.id);
                    server.setSelectedAction(null);
                    server.setPanelTab("steps");
                  }}
                  onDblClick={() => void rec.runRecipe(r)}
                >
                  <span class="nav-row__title">{r.title}</span>
                  <span class="nav-row__meta">
                    <Show when={r.steps.length > 0}>
                      <span class="mono nav-row__count">{r.steps.length}</span>
                    </Show>
                    <span class="nav-row__actions">
                      <span
                        class="nav-row__action"
                        title="Edit recipe"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingRecipe(r);
                        }}
                      >
                        <Icon name="sliders" size={11} />
                      </span>
                      <span
                        class="nav-row__action"
                        title="Delete recipe"
                        onClick={(e) => {
                          e.stopPropagation();
                          rec.deleteRecipe(r.id);
                        }}
                      >
                        <Icon name="trash" size={11} />
                      </span>
                    </span>
                  </span>
                </button>
              )}
            </For>
          </div>
          <Show
            when={server.actions().length > 0}
            fallback={
              <EmptyState
                size="sm"
                icon="run"
                title={server.isOffline() ? "Offline" : "No recipes"}
                description={
                  server.isOffline() ? "Start the API to load recipes." : "Waiting for catalog…"
                }
                actionLabel={server.isOffline() ? "Retry" : undefined}
                onAction={server.isOffline() ? () => void server.retryConnection() : undefined}
              />
            }
          >
            <For each={groups()}>
              {([category, actions]) => (
                <div class="sidebar__group">
                  <div class="sidebar__group-label">{catLabel(category)}</div>
                  <For each={actions}>
                    {(a) => {
                      const on = () => server.selectedAction() === a.id;
                      const last = () => server.jobs().findLast((j) => j.action === a.id);
                      return (
                        <button
                          type="button"
                          class="nav-row"
                          classList={{ on: on() }}
                          title={
                            a.description
                              ? `${a.description}\nBuilt-in recipe — steps are code-defined\nDouble-click to run`
                              : "Built-in recipe — steps are code-defined\nDouble-click to run"
                          }
                          onClick={() => {
                            server.setSelectedAction(a.id);
                            rec.setSelectedRecipeId(null);
                            server.setPanelTab("steps");
                          }}
                          onDblClick={() => {
                            server.setSelectedAction(a.id);
                            rec.setSelectedRecipeId(null);
                            void server.runSelected();
                          }}
                        >
                          <span class="nav-row__title">{a.title}</span>
                          <span class="nav-row__meta">
                            <Show when={last()}>
                              {(j) => (
                                <span class={`tone tone--${statusTone(j().status)}`}>
                                  {j().status}
                                </span>
                              )}
                            </Show>
                            <span class="nav-row__actions">
                              <span
                                class="nav-row__action"
                                title="Fork to custom recipe"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rec.forkRecipe({ title: a.title, description: a.description });
                                }}
                              >
                                <Icon name="external" size={11} />
                              </span>
                            </span>
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>

      <div class="sidebar__section sidebar__section--history">
        <div class="sidebar__head">
          <span class="sidebar__label">History</span>
          <span class="sidebar__count mono">{server.jobs().length}</span>
        </div>
        <div class="sidebar__scroll">
          <Show
            when={server.jobs().length > 0}
            fallback={
              <p class="sidebar__empty-hint">Runs appear here. Double-click a recipe to start.</p>
            }
          >
            <For each={server.jobs()}>
              {(j) => (
                <button
                  type="button"
                  class="nav-row nav-row--job"
                  classList={{ on: server.selectedJobId() === j.id }}
                  onClick={() => {
                    server.jumpToJob(j.id);
                    server.setPanelTab("steps");
                  }}
                >
                  <span class={`nav-row__dot nav-row__dot--${statusTone(j.status)}`} aria-hidden />
                  <span class="nav-row__title">{j.title ?? j.action}</span>
                  <span class="nav-row__meta mono">{fmtDur(j, server.clock())}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </div>
      <Show when={editingRecipe()}>
        {(() => {
          const er = editingRecipe();
          return (
            <RecipeEditor
              recipe={er === "new" ? null : er}
              onClose={() => setEditingRecipe(null)}
            />
          );
        })()}
      </Show>
    </aside>
  );
}

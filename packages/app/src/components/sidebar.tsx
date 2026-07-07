/**
 * OpenCode-style left rail: recipes + run history (clean rows, no chip soup).
 */
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { useServer, type RecipeInfo, type JobInfo } from "../context/server";
import { useRecorder } from "../context/recorder";
import { Icon } from "./icon";
import { EmptyState } from "./empty-state";
import { RecipeEditor } from "./recipe-editor";
import { statusTone, fmtDur, fmtAgo, n } from "../lib/job";

/** Derive a sidebar group for a builtin recipe id (plan-002 builtins carry no category). */
function builtinCategory(id: string): string {
  if (id.startsWith("login-") || id === "logout" || id.startsWith("grok")) return "grok";
  return "play-store";
}

const CAT_LABEL: Record<string, string> = {
  "play-store": "Play Store",
  grok: "Grok app",
};

type Group = { key: string; label: string; items: RecipeInfo[]; custom: boolean };

export function Sidebar() {
  const server = useServer();
  const rec = useRecorder();
  const [editingRecipe, setEditingRecipe] = createSignal<RecipeInfo | "new" | null>(null);
  // Delete confirmation: first click arms a 3s "Sure?" state per recipe id.
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null);
  function armDelete(id: string): void {
    if (confirmDeleteId() === id) {
      setConfirmDeleteId(null);
      void server.deleteRecipeRemote(id);
      return;
    }
    setConfirmDeleteId(id);
    const t = setTimeout(() => setConfirmDeleteId((cur) => (cur === id ? null : cur)), 3000);
    onCleanup(() => clearTimeout(t));
  }

  // One unified list from server.recipes(): custom recipes group as "Recipes"
  // (with New/Edit/Delete), builtins group by their derived category.
  const groups = createMemo<Group[]>(() => {
    const custom: RecipeInfo[] = [];
    const byCat = new Map<string, RecipeInfo[]>();
    for (const r of server.recipes()) {
      if (r.source === "custom") {
        custom.push(r);
        continue;
      }
      const cat = builtinCategory(r.id);
      const list = byCat.get(cat) ?? [];
      list.push(r);
      byCat.set(cat, list);
    }
    const built: Group[] = [...byCat.entries()].map(([key, items]) => ({
      key,
      label: CAT_LABEL[key] ?? key,
      items,
      custom: false,
    }));
    return [{ key: "Recipes", label: "Recipes", items: custom, custom: true }, ...built];
  });

  const select = (id: string) => {
    server.setSelectedRecipeId(id);
    server.setPersistedRunId(null);
  };

  /** Disk-only runs: persisted runs with no matching live job (plan 008 step 4).
   *  Folded into History so the Artifacts tab's one useful residue survives. */
  const diskOnlyRuns = createMemo(() => {
    const live = new Set(server.jobs().map((j) => j.id));
    return server.persistedRuns().filter((r) => !live.has(r.id));
  });

  return (
    <aside class="sidebar" aria-label="Recipes and history">
      <div class="sidebar__section">
        <div class="sidebar__head">
          <span class="sidebar__label">Recipes</span>
          <span class="sidebar__count mono">{server.recipes().length}</span>
        </div>
        <div class="sidebar__scroll">
          <Show
            when={server.recipes().length > 0}
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
              {(g) => (
                <div class="sidebar__group">
                  <div class="sidebar__group-label">
                    {g.label}
                    <Show when={g.custom}>
                      <button
                        type="button"
                        class="sidebar__new-btn"
                        title="Create a new recipe"
                        onClick={() => setEditingRecipe("new")}
                      >
                        <Icon name="plus" size={12} />
                      </button>
                    </Show>
                  </div>
                  <For each={g.items}>
                    {(r) => {
                      const on = () => server.selectedRecipeId() === r.id;
                      const last = () => server.jobs().findLast((j) => j.action === r.id);
                      const stepCount = () => r.steps.length;
                      return (
                        <div class="nav-row-wrap">
                          <button
                            type="button"
                            class="nav-row"
                            classList={{ on: on() }}
                            title={`${r.source === "custom" ? "Custom" : "Built-in"} · ${n(r.steps.length, "step")} — double-click to run`}
                            onClick={() => select(r.id)}
                            onDblClick={() => void server.runRecipeRemote(r.id)}
                          >
                            <span class="nav-row__title">{r.title}</span>
                            <span class="nav-row__meta">
                              <Show when={r.source === "custom" && stepCount() > 0}>
                                <span class="mono nav-row__count">{stepCount()}</span>
                              </Show>
                              <Show when={last()}>
                                {(j) => (
                                  <span class={`tone tone--${statusTone(j().status)}`}>
                                    {j().status}
                                  </span>
                                )}
                              </Show>
                            </span>
                          </button>
                          <span class="nav-row__actions">
                            <Show when={r.source === "custom"}>
                              <button
                                type="button"
                                class="nav-row__action"
                                aria-label={`Edit ${r.title}`}
                                title="Edit recipe"
                                onClick={() => setEditingRecipe(r)}
                              >
                                <Icon name="sliders" size={11} />
                              </button>
                              <button
                                type="button"
                                class="nav-row__action nav-row__action--del"
                                aria-label={`Delete ${r.title}`}
                                title={
                                  confirmDeleteId() === r.id
                                    ? "Click again to confirm"
                                    : "Delete recipe"
                                }
                                onClick={() => armDelete(r.id)}
                              >
                                <Show
                                  when={confirmDeleteId() !== r.id}
                                  fallback={<span class="nav-row__action-sure">Sure?</span>}
                                >
                                  <Icon name="trash" size={11} />
                                </Show>
                              </button>
                            </Show>
                            <Show when={r.source === "builtin"}>
                              <button
                                type="button"
                                class="nav-row__action"
                                aria-label={`Fork ${r.title} to a custom recipe`}
                                title="Fork to custom recipe"
                                onClick={() => void rec.forkRecipe(r)}
                              >
                                <Icon name="external" size={11} />
                              </button>
                            </Show>
                          </span>
                        </div>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>

      <Show when={server.queuedJobs().length > 0}>
        <div class="sidebar__section">
          <div class="sidebar__head">
            <span class="sidebar__label">Queue · {server.queuedJobs().length}</span>
          </div>
          <div class="sidebar__scroll">
            <For each={server.queuedJobs()}>
              {(j, i) => (
                <div class="nav-row nav-row--queued" title={`Queued · ${j.title ?? j.action}`}>
                  <span class="nav-row__pos mono">{i() + 1}</span>
                  <span class="nav-row__title">{j.title ?? j.action}</span>
                  <span class="nav-row__actions">
                    <button
                      type="button"
                      class="nav-row__action"
                      aria-label={`Remove ${j.title ?? j.action} from queue`}
                      title="Remove from queue"
                      onClick={() => void server.cancelJob(j.id)}
                    >
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div class="sidebar__section sidebar__section--history">
        <div class="sidebar__head">
          <span class="sidebar__label">History</span>
          <span class="sidebar__count mono">{server.jobs().length + diskOnlyRuns().length}</span>
        </div>
        <div class="sidebar__scroll">
          <Show
            when={server.jobs().length > 0 || diskOnlyRuns().length > 0}
            fallback={
              <p class="sidebar__empty-hint">Runs appear here. Double-click a recipe to start.</p>
            }
          >
            <For each={server.jobs()}>
              {(j) => (
                <div class="nav-row-wrap">
                  <button
                    type="button"
                    class="nav-row nav-row--job"
                    classList={{
                      on: server.selectedJobId() === j.id,
                      "nav-row--active": j.status === "running" || j.status === "paused",
                    }}
                    onClick={() => {
                      server.jumpToJob(j.id);
                      server.setPersistedRunId(null);
                    }}
                  >
                    <span
                      class={`nav-row__dot nav-row__dot--${statusTone(j.status)}`}
                      aria-hidden
                    />
                    <span class="nav-row__title">{j.title ?? j.action}</span>
                    <span class="nav-row__meta mono">
                      <Show
                        when={
                          j.status === "ok" ||
                          j.status === "error" ||
                          j.status === "healed" ||
                          j.status === "cancelled"
                        }
                        fallback={fmtDur(j, server.clock())}
                      >
                        <span class={`tone tone--${statusTone(j.status)}`}>
                          {j.status === "error" ? "failed" : j.status}
                        </span>
                        <span class="nav-row__sep">·</span>
                        <span>{fmtAgo(j.finishedAt, server.clock())}</span>
                        <span class="nav-row__sep">·</span>
                        <span>{fmtDur(j, server.clock())}</span>
                      </Show>
                    </span>
                  </button>
                  <span class="nav-row__actions">
                    <Show when={j.status === "error"}>
                      <button
                        type="button"
                        class="nav-row__action"
                        aria-label={`Retry ${j.title ?? j.action}`}
                        title="Retry / heal job"
                        onClick={() => void server.retrySelectedJob(j.id)}
                      >
                        <Icon name="refresh" size={11} />
                      </button>
                    </Show>
                  </span>
                </div>
              )}
            </For>
            <Show when={diskOnlyRuns().length > 0}>
              <div class="sidebar__group-label">Disk</div>
              <For each={diskOnlyRuns()}>
                {(run) => (
                  <div class="nav-row-wrap">
                    <button
                      type="button"
                      class="nav-row nav-row--job"
                      classList={{ on: server.persistedRunId() === run.id }}
                      title={`Disk run · ${run.dir}`}
                      onClick={() => {
                        server.setSelectedJobId(null);
                        server.setPersistedRunId(run.id);
                      }}
                    >
                      <span
                        class={`nav-row__dot nav-row__dot--${statusTone(run.status as JobInfo["status"])}`}
                        aria-hidden
                      />
                      <span class="nav-row__title">{run.action}</span>
                      <span class="nav-row__meta mono">
                        <span class={`tone tone--${statusTone(run.status as JobInfo["status"])}`}>
                          {run.healed ? "healed" : run.status}
                        </span>
                        <span class="nav-row__sep">·</span>
                        <span class="nav-row__disk">disk</span>
                        <span class="nav-row__sep">·</span>
                        <span>{run.frames?.length ?? 0}f</span>
                      </span>
                    </button>
                  </div>
                )}
              </For>
            </Show>
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

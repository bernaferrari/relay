import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useServer, type RecipeInfo, type RecipeStep } from "../../context/server";
import { cn } from "../../lib/cn";
import { Icon } from "../icon";
import { AtlasWorkspace } from "./atlas-workspace";
import { DiscoveryWorkspace } from "./discovery-workspace";
import {
  eyebrow,
  productPrimary,
  productSecondary,
  productIconButton,
  productIconButtonDanger,
} from "../../lib/ui";

export function MapsWorkspace(props: { onOpenRecipe: (id: string) => void }) {
  const server = useServer();
  const [mode, setMode] = createSignal<"atlas" | "workflows" | "discovery">("discovery");
  const [atlas, setAtlas] = createSignal<import("../../context/server").TestAtlas | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [adding, setAdding] = createSignal("");
  const workflows = createMemo(() =>
    server
      .recipes()
      .filter(
        (recipe) =>
          recipe.description?.startsWith("Workflow ·") ||
          (recipe.steps.length > 0 && recipe.steps.every((step) => step.kind === "module")),
      ),
  );
  const selected = () =>
    workflows().find((item) => item.id === selectedId()) ?? workflows()[0] ?? null;

  createEffect(() => {
    if (!selectedId() && workflows()[0]) setSelectedId(workflows()[0]!.id);
  });
  createEffect(() => {
    server.recipes();
    void server
      .loadAtlas()
      .then(setAtlas)
      .catch(() => setAtlas(null));
  });
  createEffect(() => {
    if (mode() === "discovery") void server.refreshDiscoverySessions();
  });

  const createWorkflow = async () => {
    const saved = await server.saveRecipeRemote({
      title: `Workflow ${workflows().length + 1}`,
      description: "Workflow · Run reusable tests in order",
      steps: [],
    });
    if (saved) setSelectedId(saved.id);
  };
  const replaceSteps = (recipe: RecipeInfo, steps: RecipeStep[]) =>
    server.saveRecipeRemote({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      steps,
    });
  const duplicateWorkflow = async (recipe: RecipeInfo) => {
    const saved = await server.saveRecipeRemote({
      title: `${recipe.title} copy`,
      description: recipe.description,
      steps: recipe.steps,
    });
    if (saved) setSelectedId(saved.id);
  };
  const deleteWorkflow = async (recipe: RecipeInfo) => {
    if (!window.confirm(`Delete “${recipe.title}”? This cannot be undone.`)) return;
    await server.deleteRecipeRemote(recipe.id);
    setSelectedId(null);
  };

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0">
      <header class="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--relay-line)] bg-[var(--relay-panel)] px-3">
        <div
          class="inline-flex items-center gap-0.5 rounded-[9px] border border-[var(--relay-line)] bg-[color-mix(in_srgb,var(--relay-panel)_86%,var(--relay-bg))] p-0.5"
          role="tablist"
          aria-label="Product map view"
        >
          {(
            [
              ["discovery", "Product"],
              ["atlas", "Coverage"],
              ["workflows", "Reuse"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={mode() === id}
              class={cn(
                "min-h-8 rounded-[7px] px-3.5 text-[12px] font-medium text-[var(--relay-text-tertiary)] transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_srgb,var(--relay-accent-2)_66%,transparent)]",
                mode() === id &&
                  "bg-[var(--relay-surface-strong)] text-[var(--relay-text)] shadow-[inset_0_0_0_1px_var(--relay-line-strong)]",
              )}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <Show when={mode() === "workflows" && workflows().length > 0}>
          <button type="button" class={productPrimary} onClick={() => void createWorkflow()}>
            <Icon name="plus" size={15} /> New workflow
          </button>
        </Show>
      </header>
      <Show
        when={mode() === "discovery"}
        fallback={
          <Show
            when={mode() === "workflows"}
            fallback={
              <div class="min-h-0 w-full flex-1">
                <AtlasWorkspace atlas={atlas()} onOpen={props.onOpenRecipe} />
              </div>
            }
          >
            <div class="mx-auto grid min-h-0 w-full min-h-[520px] flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden max-[850px]:grid-cols-1">
              <aside class="border-r border-border-weak-base bg-surface-weak p-2 max-[850px]:border-r-0 max-[850px]:border-b">
                <For
                  each={workflows()}
                  fallback={
                    <div class="grid min-h-28 place-items-center text-[12px]/[1.4] text-text-weaker">
                      No workflows yet.
                    </div>
                  }
                >
                  {(workflow) => (
                    <button
                      type="button"
                      aria-current={selected()?.id === workflow.id ? "true" : undefined}
                      class={cn(
                        "grid min-h-12 w-full grid-cols-[minmax(0,1fr)_14px] items-center gap-2 rounded-lg px-2.5 text-left hover:bg-surface-base-hover",
                        selected()?.id === workflow.id && "bg-surface-base-active",
                      )}
                      onClick={() => setSelectedId(workflow.id)}
                    >
                      <span class="min-w-0">
                        <strong class="block truncate text-[13px]/[1.25] text-text-base">
                          {workflow.title}
                        </strong>
                        <small class="mt-1 block text-[10px]/[1.25] text-text-weaker">
                          {workflow.steps.length} test{workflow.steps.length === 1 ? "" : "s"}
                        </small>
                      </span>
                      <Icon name="chevron-right" size={14} />
                    </button>
                  )}
                </For>
              </aside>
              <Show
                when={selected()}
                fallback={
                  <div class="grid place-items-center p-10 text-center">
                    <div class="max-w-md">
                      <span class={eyebrow}>Reusable building blocks</span>
                      <h3 class="mt-2 text-[20px]/[1.2] text-text-base">
                        Turn trusted tests into complete journeys
                      </h3>
                      <p class="mt-2 text-[13px]/[1.5] text-text-weak">
                        Add existing tests, arrange their order, and run the whole sequence.
                      </p>
                      <button
                        type="button"
                        class={cn(productPrimary, "mt-5")}
                        onClick={() => void createWorkflow()}
                      >
                        <Icon name="plus" size={15} /> Create your first flow
                      </button>
                    </div>
                  </div>
                }
              >
                {(workflow) => (
                  <div class="flex min-w-0 flex-col">
                    <header class="flex min-h-16 items-center justify-between gap-3 border-b border-border-weak-base px-4">
                      <input
                        aria-label="Workflow title"
                        class="min-w-0 flex-1 bg-transparent text-[16px]/[1.25] font-semibold text-text-base outline-none focus:ring-1 focus:ring-border-focus"
                        value={workflow().title}
                        onChange={(event) =>
                          void server.saveRecipeRemote({
                            id: workflow().id,
                            title: event.currentTarget.value,
                            description: workflow().description,
                            steps: workflow().steps,
                          })
                        }
                      />
                      <div class="flex items-center gap-1">
                        <button
                          type="button"
                          class={productIconButton}
                          aria-label="Duplicate workflow"
                          onClick={() => void duplicateWorkflow(workflow())}
                        >
                          <Icon name="copy" size={14} />
                        </button>
                        <button
                          type="button"
                          class={productIconButtonDanger}
                          aria-label="Delete workflow"
                          onClick={() => void deleteWorkflow(workflow())}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                        <button
                          type="button"
                          class={productSecondary}
                          onClick={() => props.onOpenRecipe(workflow().id)}
                        >
                          Open as test
                        </button>
                        <button
                          type="button"
                          class={productPrimary}
                          onClick={() => void server.runRecipeRemote(workflow().id)}
                        >
                          <Icon name="play" size={13} /> Run sequence
                        </button>
                      </div>
                    </header>
                    <div class="grid flex-1 content-start gap-2 overflow-y-auto p-4">
                      <For
                        each={workflow().steps}
                        fallback={
                          <div class="grid min-h-32 place-items-center text-center">
                            <div>
                              <strong class="text-[13px]/[1.25] text-text-base">
                                No tests in this workflow
                              </strong>
                              <p class="mt-1 text-[11px]/[1.4] text-text-weaker">
                                Add tests below; they run top to bottom.
                              </p>
                            </div>
                          </div>
                        }
                      >
                        {(step, index) => (
                          <Show when={step.kind === "module" ? step : null}>
                            {(module) => {
                              const child = () =>
                                server.recipes().find((recipe) => recipe.id === module().recipeId);
                              return (
                                <div class="grid min-h-14 grid-cols-[24px_20px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border-weak-base bg-surface-weak px-3">
                                  <span class="grid size-6 place-items-center rounded-md bg-surface-base-active text-[10px]/none text-text-weak">
                                    {index() + 1}
                                  </span>
                                  <Icon name="bolt" size={15} />
                                  <div class="min-w-0">
                                    <strong class="block truncate text-[13px]/[1.25] text-text-base">
                                      {child()?.title ?? module().recipeId}
                                    </strong>
                                    <small class="mt-1 block text-[10px]/[1.25] text-text-weaker">
                                      {child()?.steps.length ?? 0} steps
                                    </small>
                                  </div>
                                  <div class="flex">
                                    <button
                                      type="button"
                                      class="grid size-10 place-items-center"
                                      aria-label="Move up"
                                      disabled={index() === 0}
                                      onClick={() => {
                                        const next = [...workflow().steps];
                                        [next[index() - 1], next[index()]] = [
                                          next[index()]!,
                                          next[index() - 1]!,
                                        ];
                                        void replaceSteps(workflow(), next);
                                      }}
                                    >
                                      <Icon name="chevron-up" size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      class="grid size-10 place-items-center"
                                      aria-label="Move down"
                                      disabled={index() === workflow().steps.length - 1}
                                      onClick={() => {
                                        const next = [...workflow().steps];
                                        [next[index()], next[index() + 1]] = [
                                          next[index() + 1]!,
                                          next[index()]!,
                                        ];
                                        void replaceSteps(workflow(), next);
                                      }}
                                    >
                                      <Icon name="chevron-down" size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      class="grid size-10 place-items-center text-text-critical-base"
                                      aria-label="Remove from workflow"
                                      onClick={() =>
                                        void replaceSteps(
                                          workflow(),
                                          workflow().steps.filter(
                                            (_, itemIndex) => itemIndex !== index(),
                                          ),
                                        )
                                      }
                                    >
                                      <Icon name="trash" size={13} />
                                    </button>
                                  </div>
                                </div>
                              );
                            }}
                          </Show>
                        )}
                      </For>
                    </div>
                    <footer class="flex min-h-16 items-center justify-end gap-2 border-t border-border-weak-base px-4">
                      <select
                        class="min-h-9 min-w-52 rounded-lg border border-border-weak-base bg-background-base px-2.5 text-[12px]/[1.25] text-text-base"
                        aria-label="Test to add"
                        value={adding()}
                        onChange={(event) => setAdding(event.currentTarget.value)}
                      >
                        <option value="">Choose a test…</option>
                        <For
                          each={server
                            .recipes()
                            .filter(
                              (recipe) =>
                                recipe.id !== workflow().id &&
                                !workflows().some((flow) => flow.id === recipe.id),
                            )}
                        >
                          {(recipe) => <option value={recipe.id}>{recipe.title}</option>}
                        </For>
                      </select>
                      <button
                        type="button"
                        class={productSecondary}
                        disabled={!adding()}
                        onClick={() => {
                          if (!adding()) return;
                          void replaceSteps(workflow(), [
                            ...workflow().steps,
                            { kind: "module", recipeId: adding() },
                          ]);
                          setAdding("");
                        }}
                      >
                        <Icon name="plus" size={14} /> Add test
                      </button>
                    </footer>
                  </div>
                )}
              </Show>
            </div>
          </Show>
        }
      >
        <div class="min-h-0 w-full flex-1 overflow-hidden">
          <DiscoveryWorkspace onOpenRecipe={props.onOpenRecipe} />
        </div>
      </Show>
    </section>
  );
}

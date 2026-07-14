import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useServer, type RecipeInfo, type RecipeStep } from "../../context/server";
import { cn } from "../../lib/cn";
import { Icon } from "../icon";
import { AtlasWorkspace } from "./atlas-workspace";
import { DiscoveryWorkspace } from "./discovery-workspace";
import {
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
      <header class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--relay-line)] bg-[color-mix(in_srgb,var(--relay-panel)_82%,var(--relay-bg))] px-4">
        <div
          class="inline-flex items-center gap-1 rounded-[10px] bg-black/[0.12] p-1 ring-1 ring-inset ring-white/[0.05]"
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
                "min-h-8 rounded-[7px] px-3.5 text-[12px] font-medium text-[var(--relay-text-tertiary)] transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_srgb,var(--text-interactive-base)_66%,transparent)]",
                mode() === id &&
                  "bg-white/[0.075] text-[var(--relay-text)] shadow-[inset_0_0_0_1px_rgb(255_255_255/7%),0_3px_10px_rgb(0_0_0/14%)]",
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
            <div
              class={cn(
                "mx-auto grid min-h-0 w-full min-h-[520px] flex-1 overflow-hidden",
                workflows().length > 0
                  ? "grid-cols-[248px_minmax(0,1fr)] max-[850px]:grid-cols-1"
                  : "grid-cols-1",
              )}
            >
              <Show when={workflows().length > 0}>
                <aside class="border-r border-border-weak-base bg-[color-mix(in_srgb,var(--relay-panel)_86%,var(--relay-bg))] p-2.5 max-[850px]:border-r-0 max-[850px]:border-b">
                  <For each={workflows()}>
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
              </Show>
              <Show
                when={selected()}
                fallback={
                  <div class="relative grid place-items-center overflow-hidden px-8 py-12 text-center">
                    <div
                      class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgb(126_101_255/10%),transparent_34%),radial-gradient(circle_at_1px_1px,rgb(255_255_255/3%)_1px,transparent_0)] bg-size-[auto,20px_20px]"
                      aria-hidden="true"
                    />
                    <div class="relative w-full max-w-[720px]">
                      <span class="mx-auto grid size-11 place-items-center rounded-[14px] bg-[color-mix(in_srgb,var(--relay-accent)_14%,transparent)] text-[var(--text-interactive-base)] ring-1 ring-[color-mix(in_srgb,var(--relay-accent)_24%,transparent)] shadow-[0_12px_34px_rgb(67_52_180/18%)]">
                        <Icon name="move" size={19} />
                      </span>
                      <span class="mt-4 block text-[10px] font-semibold tracking-[0.12em] text-[var(--text-interactive-base)] uppercase">
                        Reusable journeys
                      </span>
                      <h3 class="mx-auto mt-2 max-w-[580px] text-[27px]/[1.12] font-semibold tracking-[-0.035em] text-text-strong">
                        Compose trusted tests into one complete customer journey.
                      </h3>
                      <p class="mx-auto mt-2 max-w-[540px] text-[12.5px]/[1.55] text-text-weak">
                        Arrange existing tests, pass shared inputs between them, and run the entire
                        sequence with one result.
                      </p>

                      <div
                        class="relative mx-auto mt-8 grid max-w-[620px] grid-cols-3 items-center gap-12 max-[680px]:gap-4"
                        aria-hidden="true"
                      >
                        <span class="absolute top-1/2 right-[16%] left-[16%] h-px -translate-y-1/2 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--relay-accent)_45%,transparent)_12%,color-mix(in_srgb,var(--relay-accent)_45%,transparent)_88%,transparent)]" />
                        {["Sign in", "Choose plan", "Confirm"].map((label, index) => (
                          <span class="relative z-[1] grid min-h-[78px] place-items-center rounded-[15px] border border-[var(--relay-line)] bg-[color-mix(in_srgb,var(--relay-panel)_94%,transparent)] px-3 shadow-[0_14px_34px_rgb(0_0_0/18%)] backdrop-blur-sm">
                            <i class="grid size-7 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--relay-accent)_12%,transparent)] font-mono text-[10px] not-italic text-[var(--text-interactive-base)]">
                              {String(index + 1).padStart(2, "0")}
                            </i>
                            <strong class="text-[11.5px] font-medium text-text-base">
                              {label}
                            </strong>
                          </span>
                        ))}
                      </div>

                      <button
                        type="button"
                        class={cn(productPrimary, "mt-8 min-h-10 px-4 text-[12.5px]")}
                        onClick={() => void createWorkflow()}
                      >
                        <Icon name="plus" size={15} /> Create first journey
                      </button>
                      <small class="mt-3 block text-[10.5px] text-text-weaker">
                        Start empty, then add tests from your library.
                      </small>
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

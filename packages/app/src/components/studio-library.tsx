import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { RecipeInfo } from "../context/server";
import { cn } from "../lib/cn";
import { displayTitle, fmtAgo } from "../lib/job";
import { Icon, type IconName } from "./icon";
import { mono, popover, productIconButton, productIconButtonSolid } from "../lib/ui";
import { shellLibrary, shellLibraryClosed } from "../lib/shell-layout";
import { SelectableRow } from "./selectable-row";

export function LibraryPanel(props: {
  open: boolean;
  query: string;
  onQuery: (value: string) => void;
  items: RecipeInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: (yaml: string) => Promise<void>;
}) {
  let searchInput: HTMLInputElement | undefined;
  let importInput: HTMLInputElement | undefined;
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [draftsOpen, setDraftsOpen] = createSignal(false);
  const tests = () => props.items.filter((recipe) => recipe.steps.length > 0);
  const drafts = () => props.items.filter((recipe) => recipe.steps.length === 0);
  createEffect(() => {
    if (drafts().some((recipe) => recipe.id === props.selectedId)) setDraftsOpen(true);
  });
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!props.open) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput?.focus();
        searchInput?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <aside
      class={cn(shellLibrary, !props.open && shellLibraryClosed)}
      aria-label="Test library"
      aria-hidden={!props.open}
      inert={!props.open}
      data-recipe-count={props.items.length}
    >
      <div class="flex min-h-[56px] items-center justify-between px-3.5 py-2.5">
        <h1 class="text-[15px] font-semibold leading-[1.2] tracking-[-0.025em] text-text-strong">
          Tests
        </h1>
        <div class="relative flex items-center gap-0.5">
          <input
            ref={(element) => (importInput = element)}
            class="sr-only"
            type="file"
            accept=".yaml,.yml,text/yaml,application/yaml"
            aria-label="Import Relay test file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              void file.text().then(props.onImport);
            }}
          />
          <button
            type="button"
            class={productIconButtonSolid}
            aria-label="Create test"
            data-tip="Create test"
            onClick={props.onCreate}
          >
            <Icon name="plus" size={17} />
          </button>
          <button
            type="button"
            class={productIconButton}
            aria-label="More library actions"
            aria-expanded={menuOpen()}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="more" size={16} />
          </button>
          <Show when={menuOpen()}>
            <div
              class={cn(
                popover,
                "absolute top-[calc(100%+7px)] right-0 z-40 w-[230px] origin-top-right p-1.5",
              )}
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                class="flex min-h-[46px] w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-text-base hover:bg-surface-raised-base-hover"
                onClick={() => {
                  setMenuOpen(false);
                  importInput?.click();
                }}
              >
                <Icon name="upload" size={14} />
                <span class="min-w-0">
                  <strong class="block text-[11px] font-medium text-text-strong">
                    Import test file
                  </strong>
                  <small class="mt-0.5 block text-[9px] text-text-weaker">
                    Open a Relay YAML file
                  </small>
                </span>
              </button>
            </div>
          </Show>
        </div>
      </div>
      <label class="relative mx-2.5 mb-2.5 flex h-[34px] shrink-0 items-center gap-2 rounded-[9px] bg-v2-background-bg-base px-2.5 text-text-weaker shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus-within:text-text-base focus-within:shadow-[inset_0_0_0_1px_var(--border-interactive-base),0_0_0_3px_color-mix(in_srgb,var(--surface-brand-base)_10%,transparent)]">
        <Icon name="search" size={15} />
        <span class="sr-only">Search tests</span>
        <input
          ref={(element) => (searchInput = element)}
          class="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-text-strong outline-none placeholder:text-text-weaker"
          type="search"
          value={props.query}
          placeholder="Search tests"
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => props.onQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            if (props.query) props.onQuery("");
            else event.currentTarget.blur();
          }}
        />
      </label>
      <div class="min-h-0 flex-1 overflow-y-auto px-1.5">
        <RecipeGroup
          title="Tests"
          items={tests()}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
        />
        <Show when={drafts().length > 0}>
          <section class="mt-2.5 border-t border-border-weak-base pt-1.5">
            <button
              type="button"
              class="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-2 rounded-lg px-2 text-left text-[11px]/[1.25] font-semibold tracking-[0.055em] text-text-weaker uppercase transition-colors hover:bg-surface-base-hover hover:text-text-weak focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus"
              aria-expanded={draftsOpen()}
              onClick={() => setDraftsOpen((open) => !open)}
            >
              <span>Drafts</span>
              <span>{drafts().length}</span>
              <Icon name={draftsOpen() ? "chevron-up" : "chevron-down"} size={13} />
            </button>
            <Show when={draftsOpen()}>
              <div>
                <For each={drafts()}>
                  {(recipe) => (
                    <RecipeRow
                      recipe={recipe}
                      selected={props.selectedId === recipe.id}
                      onSelect={props.onSelect}
                    />
                  )}
                </For>
              </div>
            </Show>
          </section>
        </Show>
        <Show when={props.query.trim().length > 0 && props.items.length === 0}>
          <div class="px-3 py-6 text-center text-12-regular text-text-weak">
            No tests match “{props.query}”.
          </div>
        </Show>
      </div>
    </aside>
  );
}

function RecipeGroup(props: {
  title: string;
  items: RecipeInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Show when={props.items.length > 0}>
      <section class="mt-4 first:mt-0">
        <header class="flex items-center justify-between px-2 pb-1 text-[11px]/[1.25] font-semibold tracking-[0.055em] text-text-weaker uppercase">
          <span>{props.title}</span>
          <span>{props.items.length}</span>
        </header>
        <div>
          <For each={props.items}>
            {(recipe) => (
              <RecipeRow
                recipe={recipe}
                selected={props.selectedId === recipe.id}
                onSelect={props.onSelect}
              />
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

function RecipeRow(props: {
  recipe: RecipeInfo;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <SelectableRow
      selected={props.selected}
      class="grid min-h-[46px] grid-cols-[26px_minmax(0,1fr)_14px] items-center gap-2 px-2 py-1"
      title={displayTitle(props.recipe.title)}
      onClick={() => props.onSelect(props.recipe.id)}
    >
      <span
        class={cn(
          "grid size-[26px] place-items-center rounded-lg text-text-weaker",
          props.selected && "bg-surface-interactive-weak text-text-interactive-base",
        )}
        aria-hidden="true"
      >
        <Icon name={recipeIcon(props.recipe)} size={14} />
      </span>
      <span class="min-w-0">
        <strong
          class={cn(
            "block truncate text-[13px]/[1.25] font-[550] text-text-weak",
            props.selected && "text-text-base",
          )}
        >
          {displayTitle(props.recipe.title)}
        </strong>
        <small class="mt-0.5 flex items-center gap-1 text-[11px]/[1.25] text-text-weaker">
          {props.recipe.steps.length > 0
            ? `${props.recipe.steps.length} step${props.recipe.steps.length === 1 ? "" : "s"}`
            : "Draft"}
          <span class="opacity-50">·</span>
          <span class={mono}>{fmtAgo(props.recipe.updatedAt, Date.now()) || "now"}</span>
        </small>
      </span>
      <Icon
        name="chevron-right"
        size={14}
        class={cn(
          "justify-self-end text-text-weaker opacity-0 transition-opacity duration-100",
          props.selected && "opacity-100",
        )}
      />
    </SelectableRow>
  );
}

function recipeIcon(recipe: RecipeInfo): IconName {
  const kind = recipe.steps[0]?.kind;
  if (kind === "module" || kind === "flow" || kind === "branch" || kind === "repeat") return "move";
  if (kind === "expect" || kind === "assert-content" || kind === "evaluate-semantic")
    return "check";
  if (kind === "type" || kind === "clipboard") return "keyboard";
  if (kind === "screenshot") return "camera";
  if (kind === "tap" || kind === "long-press") return "pointer";
  return recipe.steps.length === 0 ? "circle" : "bolt";
}

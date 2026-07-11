import { For, Show, onCleanup, onMount } from "solid-js";
import type { RecipeInfo } from "../context/server";
import { cn } from "../lib/cn";
import { displayTitle, fmtAgo } from "../lib/job";
import { Icon } from "./icon";

export function LibraryPanel(props: {
  open: boolean;
  query: string;
  onQuery: (value: string) => void;
  items: RecipeInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  let searchInput: HTMLInputElement | undefined;
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
      class="relay-library"
      aria-label="Test library"
      aria-hidden={!props.open}
      inert={!props.open}
    >
      <div class="relay-library__head">
        <div>
          <span class="relay-eyebrow">Workspace</span>
          <h1>Mobile QA</h1>
        </div>
        <button
          type="button"
          class="relay-icon-button relay-icon-button--solid"
          aria-label="Create test"
          onClick={props.onCreate}
        >
          <Icon name="plus" size={17} />
        </button>
      </div>
      <label class="relay-search">
        <Icon name="search" size={15} />
        <span class="sr-only">Search tests</span>
        <input
          ref={(element) => (searchInput = element)}
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
      <div class="relay-library__scroll">
        <RecipeGroup
          title="Tests"
          items={props.items}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
        />
        <Show when={props.query.trim().length > 0 && props.items.length === 0}>
          <div class="relay-library__empty">No tests match “{props.query}”.</div>
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
      <section class="relay-recipe-group">
        <header>
          <span>{props.title}</span>
          <span>{props.items.length}</span>
        </header>
        <div>
          <For each={props.items}>
            {(recipe) => (
              <button
                type="button"
                class={cn("relay-recipe-row", props.selectedId === recipe.id && "is-active")}
                onClick={() => props.onSelect(recipe.id)}
              >
                <span class="relay-recipe-row__copy">
                  <strong>{displayTitle(recipe.title)}</strong>
                  <small>
                    <Show when={recipe.steps.length > 0}>
                      {recipe.steps.length} step{recipe.steps.length === 1 ? "" : "s"} ·{" "}
                    </Show>
                    {fmtAgo(recipe.updatedAt, Date.now()) || "now"}
                  </small>
                </span>
                <Icon name="chevron-right" size={14} class="relay-recipe-row__chevron" />
              </button>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

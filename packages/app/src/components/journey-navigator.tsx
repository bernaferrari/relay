import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useRecorder } from "../context/recorder";
import { useServer, type JobInfo, type RecipeInfo } from "../context/server";
import { cn } from "../lib/cn";
import { displayTitle, fmtAgo, fmtDur, titleize } from "../lib/job";
import { persistedAsJob } from "../lib/persisted-run";
import { shellNav, shellNavClosed } from "../lib/shell-layout";
import { mono } from "../lib/ui";
import { RelayMark } from "./relay-mark";
import { Icon, type IconName } from "./icon";

export type NavigatorArea = "tests" | "suites" | "runs";
type RunFilter = "all" | "attention" | "active";

const AREA_TABS: { id: NavigatorArea; label: string }[] = [
  { id: "tests", label: "Journeys" },
  { id: "suites", label: "Collections" },
  { id: "runs", label: "Runs" },
];

const RUN_FILTERS: { id: RunFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attention", label: "Failed" },
  { id: "active", label: "Running" },
];

/** Row heights are tuned for ~50 journeys × ~15 steps in one scroller. */
const createRow = cn(
  "grid min-h-8 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2",
  "text-left text-[12px] font-medium text-text-weak",
  "transition-colors duration-100 hover:bg-surface-raised-base-hover hover:text-text-strong",
  "focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus",
);

const groupLabel = cn(
  "grid min-h-8 w-full grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-2 rounded-lg px-2",
  "text-left text-[10.5px]/[1.25] font-semibold tracking-[0.06em] text-text-weaker uppercase",
  "transition-colors hover:bg-surface-base-hover hover:text-text-weak",
  "focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus",
);

/**
 * One navigator for every area.
 *
 * The rail, the journey library, and the step outline used to be separate
 * columns showing the same row grammar at three zoom levels — and Collections and
 * Runs then opened a *fourth* list inside the main pane. Everything nameable
 * lives here instead: areas at the top and journeys below. A journey's actual
 * screen/action structure belongs to the center canvas, its only source of
 * truth, rather than being duplicated in a narrow navigation column.
 */
export function JourneyNavigator(props: {
  open: boolean;
  area: NavigatorArea;
  onArea: (area: NavigatorArea) => void;
  query: string;
  onQuery: (value: string) => void;
  items: RecipeInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onCreateFlow: () => void;
  onOpenRun: (id: string) => void;
  onImport: (yaml: string) => Promise<void>;
  onOpenSettings: () => void;
}) {
  let searchInput: HTMLInputElement | undefined;
  const recorder = useRecorder();
  const [draftsOpen, setDraftsOpen] = createSignal(false);
  const [allDraftsVisible, setAllDraftsVisible] = createSignal(false);
  const journeys = () => props.items.filter((recipe) => recipe.steps.length > 0);
  const drafts = () => props.items.filter((recipe) => recipe.steps.length === 0);
  const visibleDrafts = createMemo(() => {
    const items = drafts();
    if (allDraftsVisible() || props.query.trim()) return items;
    const recent = items.slice(0, 6);
    const selected = items.find((recipe) => recipe.id === props.selectedId);
    return selected && !recent.some((recipe) => recipe.id === selected.id)
      ? [selected, ...recent.slice(0, 5)]
      : recent;
  });
  const hiddenDraftCount = () => Math.max(0, drafts().length - visibleDrafts().length);

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
      class={cn(shellNav, !props.open && shellNavClosed)}
      aria-label="Navigator"
      aria-hidden={!props.open}
      inert={!props.open}
      data-recipe-count={props.items.length}
    >
      {/* Clearance for the desktop traffic lights only — the wordmark and the
          overflow menu are parked until they have a real home. */}
      <div class="shell-drag relative h-[var(--nav-top-pad,56px)] shrink-0" aria-hidden="true">
        <span class="absolute right-3 bottom-[13px] hidden items-center gap-1.5 text-[12px] font-semibold tracking-[-0.02em] text-text-base [.qa--desktop_&]:flex">
          <RelayMark size={17} />
          Relay
        </span>
      </div>

      {/* Padding, never margin: direct children are pinned to the panel width
          so the text does not reflow while the panel collapses. A horizontal
          margin on top of that width overflows and scrolls the whole panel. */}
      <div class="mb-2 shrink-0 px-2.5">
        <div
          class="flex items-center gap-0.5 rounded-lg bg-v2-background-bg-base p-0.5"
          role="tablist"
          aria-label="Workspace area"
        >
          <For each={AREA_TABS}>
            {(tab) => {
              const active = () => props.area === tab.id;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active()}
                  class={cn(
                    "min-h-7 flex-1 rounded-[7px] text-[11.5px] font-medium transition-colors duration-150",
                    active()
                      ? "bg-surface-raised-stronger-non-alpha text-text-strong shadow-xs-border-base"
                      : "text-text-weak hover:text-text-base",
                  )}
                  onClick={() => props.onArea(tab.id)}
                >
                  {tab.label}
                </button>
              );
            }}
          </For>
        </div>
      </div>

      <Show when={props.area === "tests"}>
        <div class="mb-1.5 shrink-0 px-2.5">
          <label class="relative flex h-[32px] w-full items-center gap-2 rounded-[9px] bg-v2-background-bg-base px-2.5 text-text-weaker shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus-within:text-text-base focus-within:shadow-[inset_0_0_0_1px_var(--border-interactive-base),0_0_0_3px_color-mix(in_srgb,var(--surface-brand-base)_10%,transparent)]">
            <Icon name="search" size={14} />
            <span class="sr-only">Search journeys</span>
            <input
              ref={(element) => (searchInput = element)}
              class="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-text-strong outline-none placeholder:text-text-weaker"
              type="search"
              value={props.query}
              placeholder="Search journeys"
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
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          <For each={journeys()}>
            {(recipe) => (
              <JourneyBranch
                recipe={recipe}
                selected={props.selectedId === recipe.id}
                onSelect={props.onSelect}
                onDelete={props.onDelete}
              />
            )}
          </For>

          <Show when={drafts().length > 0}>
            <section class="mt-2 border-t border-border-weak-base pt-1.5">
              <button
                type="button"
                class={groupLabel}
                aria-expanded={draftsOpen()}
                onClick={() => setDraftsOpen((open) => !open)}
              >
                <span>Drafts</span>
                <span>{drafts().length}</span>
                <Icon name={draftsOpen() ? "chevron-up" : "chevron-down"} size={13} />
              </button>
              <Show when={draftsOpen()}>
                <For each={visibleDrafts()}>
                  {(recipe) => (
                    <JourneyBranch
                      recipe={recipe}
                      selected={props.selectedId === recipe.id}
                      onSelect={props.onSelect}
                      onDelete={props.onDelete}
                    />
                  )}
                </For>
                <Show when={hiddenDraftCount() > 0}>
                  <button
                    type="button"
                    class="flex min-h-9 w-full items-center justify-center rounded-lg text-[11px] font-medium text-text-weaker transition-colors hover:bg-surface-base-hover hover:text-text-base"
                    onClick={() => setAllDraftsVisible(true)}
                  >
                    Show {hiddenDraftCount()} more
                  </button>
                </Show>
                <Show when={allDraftsVisible() && drafts().length > 6 && !props.query.trim()}>
                  <button
                    type="button"
                    class="flex min-h-9 w-full items-center justify-center rounded-lg text-[11px] font-medium text-text-weaker transition-colors hover:bg-surface-base-hover hover:text-text-base"
                    onClick={() => setAllDraftsVisible(false)}
                  >
                    Show fewer
                  </button>
                </Show>
              </Show>
            </section>
          </Show>

          <Show when={props.query.trim().length > 0 && props.items.length === 0}>
            <p class="px-3 py-6 text-center text-[11.5px] text-text-weak">
              No journeys match “{props.query}”.
            </p>
          </Show>
        </div>
      </Show>

      <Show when={props.area === "suites"}>
        <FlowList onCreate={props.onCreateFlow} />
      </Show>

      <Show when={props.area === "runs"}>
        <RunList onOpenRun={props.onOpenRun} />
      </Show>

      <footer class="shrink-0 border-t border-border-weak-base p-1.5">
        <Show when={props.area === "tests" && !recorder.recording() && !recorder.take()}>
          {/* Creating a board is instant; recording is a contextual action on
              the board once a device is involved. */}
          <button
            type="button"
            class={cn(
              "group/record mb-1 flex min-h-10 w-full items-center justify-center gap-2 rounded-[9px] px-3",
              "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
              "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--v2-background-bg-accent)_24%,transparent)]",
              "transition-[background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_17%,transparent)]",
              "active:scale-[0.98] focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus",
            )}
            onClick={props.onCreate}
          >
            <Icon name="plus" size={14} />
            <span class="text-[12px] font-semibold">New journey</span>
            <Icon
              name="arrow-right"
              size={13}
              class="opacity-65 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/record:translate-x-px"
            />
          </button>
        </Show>
        <button
          type="button"
          class="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] font-medium text-text-weak transition-colors hover:bg-surface-base-hover hover:text-text-strong"
          onClick={props.onOpenSettings}
        >
          <Icon name="sliders" size={15} /> Settings
        </button>
      </footer>
    </aside>
  );
}

/** A library row deliberately stops at the journey boundary. The screen tree
 * is authored in the canvas, so the same action never competes for attention
 * in both the sidebar and the workspace. */
function JourneyBranch(props: {
  recipe: RecipeInfo;
  selected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div class="group relative flex min-h-[38px] items-center gap-1 rounded-lg px-1">
      <button
        type="button"
        class={cn(
          "grid min-w-0 flex-1 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] px-2 py-1.5 text-left transition-colors duration-100",
          props.selected
            ? "bg-surface-base-active text-text-strong"
            : "text-text-weak hover:bg-surface-raised-base-hover hover:text-text-base",
          "focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus",
        )}
        aria-current={props.selected ? "page" : undefined}
        title={displayTitle(props.recipe.title)}
        onClick={() => props.onSelect(props.recipe.id)}
      >
        <span
          class={cn(
            "justify-self-center text-text-weaker",
            props.selected && "text-text-interactive-base",
          )}
          aria-hidden="true"
        >
          <Icon name={recipeIcon(props.recipe)} size={13} />
        </span>
        <span
          class={cn("truncate text-[12.5px]/[1.3] font-[550]", !props.selected && "text-text-weak")}
        >
          {displayTitle(props.recipe.title)}
        </span>
        <Show when={props.recipe.steps.length > 0}>
          <small class={cn("shrink-0 text-[10px] text-text-weaker", mono)}>
            {props.recipe.steps.length}
          </small>
        </Show>
      </button>
      <Show when={props.selected}>
        <button
          type="button"
          class="grid size-7 shrink-0 place-items-center rounded-[6px] text-text-weaker transition-colors hover:bg-surface-raised-base-hover hover:text-[var(--icon-critical-base)] focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus"
          aria-label={`Delete ${displayTitle(props.recipe.title)}`}
          title="Delete journey"
          onClick={() => props.onDelete(props.recipe.id)}
        >
          <Icon name="trash" size={13} />
        </button>
      </Show>
    </div>
  );
}

/** Saved collections — ordered groups of journeys. */
function FlowList(props: { onCreate: () => void }) {
  const server = useServer();
  return (
    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      <button type="button" class={cn(createRow, "mb-1")} onClick={props.onCreate}>
        <Icon name="plus" size={14} class="justify-self-center" />
        <span>New collection</span>
      </button>
      <For
        each={server.suites()}
        fallback={
          <p class="px-3 py-6 text-center text-[11.5px]/[1.5] text-text-weak">
            No collections yet. A collection runs journeys in order.
          </p>
        }
      >
        {(suite) => {
          const count = () =>
            suite.sections.reduce((sum, section) => sum + section.entries.length, 0);
          const selected = () => server.selectedSuiteId() === suite.id;
          return (
            <button
              type="button"
              class={cn(
                "grid min-h-[34px] w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-lg px-2 text-left transition-colors duration-100",
                selected() ? "bg-surface-base-active" : "hover:bg-surface-raised-base-hover",
              )}
              aria-current={selected() ? "page" : undefined}
              title={suite.title}
              onClick={() => server.setSelectedSuiteId(suite.id)}
            >
              <span
                class={cn(
                  "justify-self-center text-text-weaker",
                  selected() && "text-text-interactive-base",
                )}
                aria-hidden="true"
              >
                <Icon name="check" size={13} />
              </span>
              <span
                class={cn(
                  "truncate text-[12.5px]/[1.3] font-[550] text-text-weak",
                  selected() && "text-text-strong",
                )}
              >
                {suite.title}
              </span>
              <small class={cn("shrink-0 text-[10px] text-text-weaker", mono)}>
                {count() || "—"}
              </small>
            </button>
          );
        }}
      </For>
    </div>
  );
}

/** Recent runs — filtered, since this list grows without bound. */
function RunList(props: { onOpenRun: (id: string) => void }) {
  const server = useServer();
  const [filter, setFilter] = createSignal<RunFilter>("all");

  const rows = createMemo(() => {
    const live = server.jobs();
    const liveIds = new Set(live.map((run) => run.id));
    const disk = server
      .persistedRuns()
      .filter((run) => !liveIds.has(run.id))
      .map(persistedAsJob);
    const all = [...live, ...disk].sort(
      (a, b) => (b.startedAt ?? b.queuedAt) - (a.startedAt ?? a.queuedAt),
    );
    const current = filter();
    if (current === "attention")
      return all.filter((row) => row.status === "error" || row.status === "cancelled");
    if (current === "active")
      return all.filter((row) => ["queued", "running", "paused"].includes(row.status));
    return all;
  });

  return (
    <>
      <div class="mb-1.5 shrink-0 px-2.5">
        <div class="flex items-center gap-0.5 rounded-lg bg-v2-background-bg-base p-0.5">
          <For each={RUN_FILTERS}>
            {(option) => {
              const active = () => filter() === option.id;
              return (
                <button
                  type="button"
                  aria-pressed={active()}
                  class={cn(
                    "min-h-6 flex-1 rounded-[6px] text-[11px] font-medium transition-colors duration-150",
                    active()
                      ? "bg-surface-raised-stronger-non-alpha text-text-strong shadow-xs-border-base"
                      : "text-text-weak hover:text-text-base",
                  )}
                  onClick={() => setFilter(option.id)}
                >
                  {option.label}
                </button>
              );
            }}
          </For>
        </div>
      </div>
      <nav class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" aria-label="Runs">
        <For
          each={rows()}
          fallback={
            <p class="px-3 py-6 text-center text-[11.5px]/[1.5] text-text-weak">
              {filter() === "all" ? "No runs yet." : "Nothing matches this filter."}
            </p>
          }
        >
          {(job) => <RunRow job={job} onOpen={props.onOpenRun} />}
        </For>
      </nav>
    </>
  );
}

function RunRow(props: { job: JobInfo; onOpen: (id: string) => void }) {
  const server = useServer();
  const selected = () => server.selectedJobId() === props.job.id;
  const title = () =>
    server.recipes().find((item) => item.id === props.job.action)?.title ??
    props.job.title ??
    titleize(props.job.action);
  return (
    <button
      type="button"
      class={cn(
        "grid min-h-[38px] w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-lg px-2 text-left transition-colors duration-100",
        selected() ? "bg-surface-base-active" : "hover:bg-surface-raised-base-hover",
      )}
      aria-current={selected() ? "page" : undefined}
      title={title()}
      onClick={() => props.onOpen(props.job.id)}
    >
      <i
        class={cn("justify-self-center size-1.5 rounded-full", statusTint(props.job.status))}
        aria-hidden="true"
      />
      <span class="min-w-0">
        <span
          class={cn(
            "block truncate text-[12px]/[1.3] font-[550] text-text-weak",
            selected() && "text-text-strong",
          )}
        >
          {title()}
        </span>
        <small class="block truncate text-[9.5px]/[1.35] text-text-weaker">
          {fmtAgo(
            props.job.finishedAt ?? props.job.startedAt ?? props.job.queuedAt,
            server.clock(),
          )}
        </small>
      </span>
      <small class={cn("shrink-0 text-[10px] text-text-weaker", mono)}>
        {fmtDur(props.job, server.clock()) || "—"}
      </small>
    </button>
  );
}

function statusTint(status: string): string {
  if (status === "pass" || status === "ok" || status === "healed")
    return "bg-[var(--icon-success-base)]";
  if (status === "fail" || status === "error" || status === "cancelled")
    return "bg-[var(--icon-critical-base)]";
  if (status === "running" || status === "queued" || status === "paused")
    return "bg-[var(--v2-background-bg-accent)] shadow-[0_0_8px_var(--v2-background-bg-accent)]";
  return "bg-[var(--text-weak)]";
}

function recipeIcon(recipe: RecipeInfo): IconName {
  const kind = recipe.steps[0]?.kind;
  if (kind === "module" || kind === "flow" || kind === "branch" || kind === "repeat") return "move";
  if (kind === "expect" || kind === "assert-content" || kind === "evaluate-semantic")
    return "check";
  if (kind === "type" || kind === "clipboard") return "keyboard";
  if (kind === "screenshot") return "camera";
  if (kind === "tap") return "pointer";
  return recipe.steps.length === 0 ? "circle" : "bolt";
}

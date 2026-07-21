import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useServer, type SuiteSection, type TestSuite } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import {
  listPanel,
  popover,
  productIconButton,
  productIconButtonDanger,
  productPrimary,
  productSecondary,
} from "../lib/ui";
import { shellStageWrap } from "../lib/shell-layout";
import { DeviceStage } from "./stage";
import { ExecutionInspector } from "./execution-inspector";
import { ExecutionTimeline } from "./execution-timeline";
import { EmptyState } from "./empty-state";
import { Icon } from "./icon";
import { SelectableRow } from "./selectable-row";
import { executionDuration, executionElapsedAt, executionMoments } from "../lib/execution-moments";
import { displayTitle } from "../lib/job";
import { confirmAction } from "./confirm-dialog";

/**
 * Static, non-interactive illustration of a populated suite section — no
 * real data, just the checklist shape so the empty state reads like a real
 * product screen instead of a blank placeholder.
 */
function SuiteChecklistPreview() {
  return (
    <div class={cn(listPanel, "w-full select-none p-3")} aria-hidden="true">
      <div class="flex items-center justify-between px-1 pb-2">
        <span class="text-[10px] font-semibold tracking-[0.1em] text-text-weaker uppercase">
          Smoke tests
        </span>
        <span class="text-[10px] tabular-nums text-text-weaker">3</span>
      </div>
      <div class="grid gap-1">
        <div class="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-[8px] px-1.5 py-1.5">
          <span class="grid size-4 place-items-center rounded-full bg-surface-success-weak text-icon-success-base ring-1 ring-inset ring-border-success-base/40">
            <Icon name="check" size={10} />
          </span>
          <span class="h-2 w-[62%] rounded-full bg-surface-weak" />
        </div>
        <div class="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-[8px] px-1.5 py-1.5">
          <span class="size-4 rounded-full ring-1 ring-inset ring-border-weak-base" />
          <span class="h-2 w-[78%] rounded-full bg-surface-weak" />
        </div>
        <div class="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-[8px] px-1.5 py-1.5">
          <span class="size-4 rounded-full ring-1 ring-inset ring-border-weak-base" />
          <span class="h-2 w-[45%] rounded-full bg-surface-weak" />
        </div>
      </div>
    </div>
  );
}

export function SuitesWorkspace(props: {
  onOpenTest: (id: string) => void;
  onOpenRun: (id: string) => void;
  onOpenTargets: () => void;
  onRecordTest: (suiteId: string, sectionId: string) => void;
}) {
  const server = useServer();
  const workbench = useWorkbench();
  const [selectedEntryId, setSelectedEntryId] = createSignal<string | null>(null);
  const [addPopoverSection, setAddPopoverSection] = createSignal<string | null>(null);
  const [addQuery, setAddQuery] = createSignal("");
  const [history, setHistory] = createSignal<TestSuite[] | null>(null);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  let suiteTitleInput: HTMLInputElement | undefined;
  let addSearchInput: HTMLInputElement | undefined;
  const sectionTitleInputs = new Map<string, HTMLInputElement>();

  const closeAddPopover = () => {
    setAddPopoverSection(null);
    setAddQuery("");
  };

  onMount(() => {
    const onPointer = (event: MouseEvent) => {
      if (!(event.target as HTMLElement)?.closest?.("[data-add-test-popover]")) closeAddPopover();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && addPopoverSection()) closeAddPopover();
    };
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    });
  });

  createEffect(() => {
    if (!addPopoverSection()) return;
    queueMicrotask(() => addSearchInput?.focus());
  });

  const selectedSuite = createMemo(() =>
    server.suites().find((suite) => suite.id === server.selectedSuiteId()),
  );
  const selectedEntry = createMemo(() =>
    selectedSuite()
      ?.sections.flatMap((section) => section.entries)
      .find((entry) => entry.id === selectedEntryId()),
  );
  const selectedTest = createMemo(() =>
    server.recipes().find((test) => test.id === selectedEntry()?.testId),
  );
  const suiteExecutionJob = createMemo(() => {
    const suite = selectedSuite();
    if (!suite) return null;
    const contains = (testId: string) =>
      suite.sections.some((section) => section.entries.some((entry) => entry.testId === testId));
    const active = server.activeJob();
    if (active && contains(active.action)) return active;
    const selected = server.jobs().find((job) => job.id === server.selectedJobId());
    return selected && contains(selected.action) ? selected : null;
  });
  const moments = createMemo(() =>
    executionMoments({
      recipe: selectedTest(),
      job: suiteExecutionJob(),
      recipes: server.recipes(),
    }),
  );
  const selectedMoment = createMemo(() => workbench.focusedIndex() ?? 0);

  const save = (suite: TestSuite, sections = suite.sections, title = suite.title) =>
    server.saveSuiteRemote({
      id: suite.id,
      title,
      description: suite.description,
      sections,
    });

  const patchSection = (suite: TestSuite, sectionId: string, next: SuiteSection) =>
    void save(
      suite,
      suite.sections.map((section) => (section.id === sectionId ? next : section)),
    );

  const createSuite = async () => {
    const suite = await server.saveSuiteRemote({
      title: `Suite ${server.suites().length + 1}`,
      sections: [{ title: "Tests", entries: [] }],
    });
    if (!suite) return;
    server.setSelectedSuiteId(suite.id);
    queueMicrotask(() => {
      suiteTitleInput?.focus();
      suiteTitleInput?.select();
    });
  };

  const selectEntry = (entryId: string, testId: string) => {
    setSelectedEntryId(entryId);
    server.setSelectedRecipeId(testId);
  };

  createEffect(() => {
    const suite = selectedSuite();
    const job = suiteExecutionJob();
    if (!suite || !job) return;
    const entry = suite.sections
      .flatMap((section) => section.entries)
      .find((item) => item.testId === job.action);
    if (!entry || selectedEntryId() === entry.id) return;
    selectEntry(entry.id, entry.testId);
  });

  const latestJob = (testId: string) =>
    server
      .jobs()
      .filter((job) => job.action === testId)
      .sort((a, b) => b.queuedAt - a.queuedAt)[0];

  const statusTone = (status?: string) =>
    status === "ok" || status === "healed"
      ? "bg-[var(--icon-success-base)]"
      : status === "error"
        ? "bg-[var(--icon-critical-base)]"
        : status === "running" || status === "queued" || status === "paused"
          ? "bg-[var(--text-interactive-base)]"
          : "bg-[var(--text-weak)]";

  const usedIn = (testId: string) =>
    server
      .suites()
      .filter((suite) =>
        suite.sections.some((section) => section.entries.some((entry) => entry.testId === testId)),
      ).length;

  const libraryTests = createMemo(() => server.recipes().filter((test) => test.steps.length > 0));
  const libraryTitleCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const test of libraryTests()) {
      const title = displayTitle(test.title);
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }
    return counts;
  });
  const filteredLibraryTests = createMemo(() => {
    const needle = addQuery().trim().toLowerCase();
    if (!needle) return libraryTests();
    return libraryTests().filter((test) => displayTitle(test.title).toLowerCase().includes(needle));
  });

  const addTestToSection = (suite: TestSuite, section: SuiteSection, testId: string) => {
    patchSection(suite, section.id, {
      ...section,
      entries: [
        ...section.entries,
        { id: crypto.randomUUID(), testId, enabled: true, version: "latest" },
      ],
    });
    closeAddPopover();
  };

  return (
    <section
      class={cn(
        "grid min-h-0 min-w-0 flex-1 overflow-hidden max-[900px]:grid-cols-1",
        selectedSuite()
          ? "grid-cols-[224px_minmax(420px,1fr)_390px] max-[1160px]:grid-cols-[200px_minmax(360px,1fr)_340px]"
          : "grid-cols-[224px_minmax(0,1fr)] max-[1160px]:grid-cols-[200px_minmax(0,1fr)]",
      )}
    >
      <aside class="flex min-h-0 flex-col border-r border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]">
        <header class="flex min-h-14 items-center justify-between gap-2 border-b border-[var(--v2-border-border-muted)] px-3">
          <div>
            <strong class="block text-[13px] font-semibold text-[var(--text-strong)]">
              Suites
            </strong>
            <small class="text-[10px] text-[var(--text-weak)]">
              {server.suites().length} saved
            </small>
          </div>
          <button
            type="button"
            class={productIconButton}
            aria-label="New suite"
            data-tip="Create a new suite"
            onClick={() => void createSuite()}
          >
            <Icon name="plus" size={14} />
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <For
            each={server.suites()}
            fallback={
              <EmptyState
                size="sm"
                icon="check"
                title="No suites yet"
                description="Your release checklists will appear here."
                class="min-h-48 justify-center"
              />
            }
          >
            {(suite) => {
              const count = () =>
                suite.sections.reduce((sum, section) => sum + section.entries.length, 0);
              return (
                <SelectableRow
                  selected={selectedSuite()?.id === suite.id}
                  class="flex min-h-12 items-center gap-2 px-2.5"
                  onClick={() => {
                    server.setSelectedSuiteId(suite.id);
                    setSelectedEntryId(null);
                    setHistoryOpen(false);
                  }}
                >
                  <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--v2-background-bg-layer-02)] text-[var(--text-base)]">
                    <Icon name="check" size={14} />
                  </span>
                  <span class="min-w-0">
                    <strong class="block truncate text-[12px] font-medium text-[var(--text-strong)]">
                      {suite.title}
                    </strong>
                    <small class="text-[10px] text-[var(--text-weak)]">
                      {count()} {count() === 1 ? "test" : "tests"}
                    </small>
                  </span>
                </SelectableRow>
              );
            }}
          </For>
        </div>
      </aside>

      <div class={cn(shellStageWrap, "flex min-h-0 flex-col")}>
        <Show
          when={selectedSuite()}
          fallback={
            <div class="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-6 py-10">
              <div class="grid w-full max-w-[380px] justify-items-center gap-6">
                <SuiteChecklistPreview />
                <EmptyState
                  size="lg"
                  icon="check"
                  title="Create a release suite"
                  description="Group existing tests into a checklist your team can edit, reuse, and run together."
                  actionLabel="Create a suite"
                  onAction={() => void createSuite()}
                />
              </div>
            </div>
          }
        >
          <Show
            when={selectedTest()}
            fallback={
              <EmptyState
                size="lg"
                icon="smartphone"
                title="Select a test"
                description="Its real device capture and latest evidence appear here."
                class="h-full justify-center"
              />
            }
          >
            <div class="flex h-full min-h-0 flex-col">
              <div class="min-h-0 flex-1">
                <DeviceStage
                  onExpandBoard={() => props.onOpenTest(selectedTest()!.id)}
                  onOpenTargets={props.onOpenTargets}
                />
              </div>
              <Show when={moments().length > 0}>
                <ExecutionTimeline
                  moments={moments()}
                  selectedIndex={selectedMoment()}
                  onSelect={workbench.focusStep}
                  mode={suiteExecutionJob() ? "live" : "plan"}
                  elapsedMs={executionElapsedAt(moments(), selectedMoment())}
                  totalDurationMs={executionDuration(moments())}
                />
              </Show>
            </div>
          </Show>
        </Show>
      </div>

      <Show when={selectedSuite()}>
        {(suite) => (
          <aside class="relative flex min-h-0 flex-col border-l border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]">
            <Show
              when={
                suiteExecutionJob() &&
                ["queued", "running", "paused"].includes(suiteExecutionJob()!.status)
                  ? suiteExecutionJob()
                  : null
              }
            >
              {(job) => (
                <div class="absolute inset-0 z-10 bg-[var(--v2-background-bg-base)]">
                  <ExecutionInspector job={job()} onOpenReport={props.onOpenRun} />
                </div>
              )}
            </Show>
            <header class="border-b border-[var(--v2-border-border-muted)] px-4 py-3.5">
              <div class="flex items-center gap-2">
                <div class="group/title relative flex min-w-0 flex-1 items-center">
                  <input
                    ref={(element) => (suiteTitleInput = element)}
                    aria-label="Suite name"
                    class="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-[16px] font-semibold tracking-[-0.015em] text-[var(--text-strong)] outline-none transition hover:shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus:bg-[var(--v2-background-bg-layer-01)] focus:shadow-[inset_0_0_0_1px_var(--border-interactive-base)]"
                    value={suite().title}
                    onChange={(event) =>
                      void save(suite(), suite().sections, event.currentTarget.value)
                    }
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    class="grid size-6 shrink-0 place-items-center rounded-md text-[var(--text-weak)] opacity-0 transition-opacity hover:text-[var(--text-strong)] group-hover/title:opacity-100 group-focus-within/title:opacity-100"
                    aria-label="Rename suite"
                    data-tip="Rename suite"
                    onClick={() => {
                      suiteTitleInput?.focus();
                      suiteTitleInput?.select();
                    }}
                  >
                    <Icon name="edit" size={13} />
                  </button>
                </div>
                <button
                  type="button"
                  class={productIconButton}
                  aria-label="Suite history"
                  data-tip="View version history"
                  aria-expanded={historyOpen()}
                  onClick={() => {
                    const open = !historyOpen();
                    setHistoryOpen(open);
                    if (open) void server.loadSuiteHistory(suite().id).then(setHistory);
                  }}
                >
                  <Icon name="clock" size={14} />
                </button>
                <button
                  type="button"
                  class={productIconButtonDanger}
                  aria-label="Delete suite"
                  data-tip="Delete this suite"
                  onClick={() => {
                    confirmAction({
                      title: "Delete suite?",
                      body: `"${suite().title}" and its checklist will be removed. Tests inside it are not deleted.`,
                      confirmLabel: "Delete suite",
                      onConfirm: () => void server.deleteSuite(suite().id),
                    });
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div class="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  class={cn(productPrimary, "flex-1")}
                  disabled={
                    Boolean(
                      suiteExecutionJob() &&
                      ["queued", "running", "paused"].includes(suiteExecutionJob()!.status),
                    ) ||
                    !suite().sections.some((section) =>
                      section.entries.some((entry) => entry.enabled),
                    )
                  }
                  onClick={() => void server.runSuiteRemote(suite().id)}
                >
                  <Icon
                    name={suiteExecutionJob()?.status === "running" ? "wave" : "play"}
                    size={13}
                  />
                  {suiteExecutionJob()?.status === "running" ? "Running suite" : "Run suite"}
                </button>
              </div>
            </header>

            <Show when={historyOpen()}>
              <div class="max-h-52 overflow-y-auto border-b border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-deep)] p-2">
                <div class="mb-1 flex min-h-8 items-center justify-between px-1.5">
                  <strong class="text-[11px] text-[var(--text-base)]">Version history</strong>
                  <button
                    type="button"
                    class={productIconButton}
                    aria-label="Close history"
                    data-tip="Close version history"
                    onClick={() => setHistoryOpen(false)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
                <For
                  each={history() ?? []}
                  fallback={
                    <p class="px-2 py-3 text-[11px] text-[var(--text-weak)]">
                      No earlier versions yet.
                    </p>
                  }
                >
                  {(version) => (
                    <button
                      type="button"
                      class="flex min-h-10 w-full items-center justify-between rounded-md px-2 text-left hover:bg-[var(--v2-background-bg-layer-01)]"
                      onClick={() =>
                        void server
                          .restoreSuite(suite().id, version.updatedAt)
                          .then(() => setHistoryOpen(false))
                      }
                    >
                      <span>
                        <strong class="block text-[11px] font-medium text-[var(--text-strong)]">
                          {new Date(version.updatedAt).toLocaleString()}
                        </strong>
                        <small class="text-[10px] text-[var(--text-weak)]">
                          {version.sections.length} sections
                        </small>
                      </span>
                      <Icon name="refresh" size={13} />
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
              <For each={suite().sections}>
                {(section, sectionIndex) => (
                  <section class="mb-4">
                    <div class="flex min-h-9 items-center gap-2 px-1">
                      <div class="group/title relative flex min-w-0 flex-1 items-center">
                        <input
                          ref={(element) => sectionTitleInputs.set(section.id, element)}
                          aria-label={`Section ${sectionIndex() + 1} name`}
                          class="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-[10px] font-semibold tracking-[0.1em] text-[var(--text-weak)] uppercase outline-none transition hover:shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus:text-[var(--text-strong)] focus:shadow-[inset_0_0_0_1px_var(--border-interactive-base)] max-[900px]:text-[16px]"
                          value={section.title}
                          onChange={(event) =>
                            patchSection(suite(), section.id, {
                              ...section,
                              title: event.currentTarget.value,
                            })
                          }
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          class="grid size-5 shrink-0 place-items-center rounded-md text-[var(--text-weak)] opacity-0 transition-opacity hover:text-[var(--text-strong)] group-hover/title:opacity-100 group-focus-within/title:opacity-100"
                          aria-label="Rename section"
                          data-tip="Rename section"
                          onClick={() => {
                            const input = sectionTitleInputs.get(section.id);
                            input?.focus();
                            input?.select();
                          }}
                        >
                          <Icon name="edit" size={11} />
                        </button>
                      </div>
                      <span class="text-[10px] tabular-nums text-[var(--text-weak)]">
                        {section.entries.length}
                      </span>
                      <button
                        type="button"
                        class={productIconButtonDanger}
                        aria-label={`Remove ${section.title} section`}
                        data-tip="Remove this section"
                        onClick={() => {
                          const removeSection = () =>
                            void save(
                              suite(),
                              suite().sections.filter((item) => item.id !== section.id),
                            );
                          if (section.entries.length === 0) return removeSection();
                          confirmAction({
                            title: "Remove section?",
                            body: `“${section.title}” and its ${section.entries.length} suite ${section.entries.length === 1 ? "entry" : "entries"} will be removed. Library tests will remain.`,
                            confirmLabel: "Remove section",
                            onConfirm: removeSection,
                          });
                        }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                    <div class="grid gap-1">
                      <For
                        each={section.entries}
                        fallback={
                          <p class="m-0 rounded-lg border border-dashed border-[var(--v2-border-border-muted)] px-3 py-4 text-center text-[11px] text-[var(--text-weak)]">
                            Add an existing test or record a new one.
                          </p>
                        }
                      >
                        {(entry, entryIndex) => {
                          const test = () =>
                            server.recipes().find((item) => item.id === entry.testId);
                          const job = () => latestJob(entry.testId);
                          return (
                            <div
                              class={cn(
                                "group grid min-h-14 grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] px-2 outline-none hover:bg-[var(--v2-background-bg-layer-01)]",
                                selectedEntryId() === entry.id &&
                                  "bg-[var(--v2-background-bg-layer-02)]",
                              )}
                            >
                              <label
                                class="grid size-11 -m-2 cursor-pointer place-items-center"
                                aria-label={`${entry.enabled ? "Skip" : "Include"} ${test()?.title ?? entry.testId}`}
                              >
                                <input
                                  type="checkbox"
                                  class="size-3.5 accent-[var(--text-interactive-base)]"
                                  checked={entry.enabled}
                                  onChange={(event) => {
                                    const entries = section.entries.map((item) =>
                                      item.id === entry.id
                                        ? { ...item, enabled: event.currentTarget.checked }
                                        : item,
                                    );
                                    patchSection(suite(), section.id, { ...section, entries });
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                class="min-w-0 py-2 text-left"
                                onClick={() => selectEntry(entry.id, entry.testId)}
                              >
                                <span class="flex items-center gap-1.5">
                                  <span
                                    class={cn(
                                      "size-1.5 shrink-0 rounded-full",
                                      statusTone(job()?.status),
                                    )}
                                  />
                                  <strong class="truncate text-[12px] font-medium text-[var(--text-strong)]">
                                    {test()?.title ?? "Missing test"}
                                  </strong>
                                </span>
                                <small class="mt-1 block truncate text-[10px] text-[var(--text-weak)]">
                                  {usedIn(entry.testId)}{" "}
                                  {usedIn(entry.testId) === 1 ? "suite" : "suites"} ·{" "}
                                  {entry.version === "latest" ? "Follows latest" : "Pinned"}
                                </small>
                              </button>
                              <div class="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                                <button
                                  type="button"
                                  class={productIconButton}
                                  aria-label="Move test up"
                                  data-tip="Move up"
                                  disabled={entryIndex() === 0}
                                  onClick={() => {
                                    const entries = [...section.entries];
                                    [entries[entryIndex() - 1], entries[entryIndex()]] = [
                                      entries[entryIndex()]!,
                                      entries[entryIndex() - 1]!,
                                    ];
                                    patchSection(suite(), section.id, { ...section, entries });
                                  }}
                                >
                                  <Icon name="chevron-up" size={12} />
                                </button>
                                <button
                                  type="button"
                                  class={productIconButton}
                                  aria-label="Move test down"
                                  data-tip="Move down"
                                  disabled={entryIndex() === section.entries.length - 1}
                                  onClick={() => {
                                    const entries = [...section.entries];
                                    [entries[entryIndex()], entries[entryIndex() + 1]] = [
                                      entries[entryIndex() + 1]!,
                                      entries[entryIndex()]!,
                                    ];
                                    patchSection(suite(), section.id, { ...section, entries });
                                  }}
                                >
                                  <Icon name="chevron-down" size={12} />
                                </button>
                                <button
                                  type="button"
                                  class={productIconButtonDanger}
                                  aria-label="Remove from suite"
                                  data-tip="Remove from suite"
                                  onClick={() =>
                                    patchSection(suite(), section.id, {
                                      ...section,
                                      entries: section.entries.filter(
                                        (item) => item.id !== entry.id,
                                      ),
                                    })
                                  }
                                >
                                  <Icon name="x" size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                    <div class="relative mt-2 flex items-center gap-1.5" data-add-test-popover>
                      <button
                        type="button"
                        class="flex min-h-9 min-w-0 flex-1 items-center justify-between gap-1.5 rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-deep)] px-2 text-left text-[11px] text-[var(--text-weak)] outline-none focus:border-[var(--v2-border-border-strong)] max-[900px]:text-[16px]"
                        aria-haspopup="dialog"
                        aria-expanded={addPopoverSection() === section.id}
                        aria-label={`Add test to ${section.title}`}
                        data-tip="Add a test from your library"
                        onClick={() => {
                          setAddQuery("");
                          setAddPopoverSection((current) =>
                            current === section.id ? null : section.id,
                          );
                        }}
                      >
                        <span class="truncate">Add from library…</span>
                        <Icon
                          name="chevron-down"
                          size={12}
                          class="shrink-0 text-[var(--text-weak)]"
                        />
                      </button>
                      <button
                        type="button"
                        class={productIconButton}
                        aria-label={`Record a new test in ${section.title}`}
                        data-tip="Record a new test into this section"
                        onClick={() => props.onRecordTest(suite().id, section.id)}
                      >
                        <span class="size-2 rounded-full bg-[var(--icon-critical-base)]" />
                      </button>
                      <Show when={addPopoverSection() === section.id}>
                        <div
                          class={cn(
                            popover,
                            "absolute left-0 top-[calc(100%+6px)] z-30 flex max-h-72 w-[300px] flex-col p-0",
                          )}
                          role="dialog"
                          aria-label={`Add test to ${section.title}`}
                        >
                          <div class="border-b border-[var(--v2-border-border-muted)] p-1.5">
                            <label class="flex h-8 items-center gap-2 rounded-md bg-[var(--v2-background-bg-deep)] px-2 text-[var(--text-weak)] shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus-within:shadow-[inset_0_0_0_1px_var(--border-interactive-base)]">
                              <Icon name="search" size={13} />
                              <span class="sr-only">Search tests</span>
                              <input
                                ref={(element) => (addSearchInput = element)}
                                class="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)]"
                                type="search"
                                value={addQuery()}
                                placeholder="Search tests"
                                autocomplete="off"
                                spellcheck={false}
                                onInput={(event) => setAddQuery(event.currentTarget.value)}
                                onKeyDown={(event) => {
                                  if (event.key !== "Escape") return;
                                  event.stopPropagation();
                                  closeAddPopover();
                                }}
                              />
                            </label>
                          </div>
                          <div class="min-h-0 flex-1 overflow-y-auto p-1">
                            <For
                              each={filteredLibraryTests()}
                              fallback={
                                <p class="m-0 px-2 py-4 text-center text-[11px] text-[var(--text-weak)]">
                                  No tests match.
                                </p>
                              }
                            >
                              {(test) => {
                                const title = () => displayTitle(test.title);
                                const duplicate = () =>
                                  (libraryTitleCounts().get(title()) ?? 0) > 1;
                                return (
                                  <button
                                    type="button"
                                    class="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-[var(--v2-background-bg-layer-01)]"
                                    onClick={() => addTestToSection(suite(), section, test.id)}
                                  >
                                    <span class="min-w-0 flex-1">
                                      <strong class="block truncate text-[11.5px] font-medium text-[var(--text-strong)]">
                                        {title()}
                                      </strong>
                                      <small class="block truncate text-[10px] text-[var(--text-weak)]">
                                        {test.steps.length} step{test.steps.length === 1 ? "" : "s"}
                                        {duplicate() ? ` · ${test.id.slice(0, 8)}` : ""}
                                      </small>
                                    </span>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </section>
                )}
              </For>
              <button
                type="button"
                class={cn(productSecondary, "w-full")}
                onClick={() =>
                  void save(suite(), [
                    ...suite().sections,
                    {
                      id: crypto.randomUUID(),
                      title: `Section ${suite().sections.length + 1}`,
                      entries: [],
                    },
                  ])
                }
              >
                <Icon name="plus" size={13} /> Add section
              </button>
            </div>
            <Show when={selectedTest()}>
              {(test) => (
                <footer class="border-t border-[var(--v2-border-border-muted)] p-3">
                  <button
                    type="button"
                    class={cn(productSecondary, "w-full")}
                    onClick={() => props.onOpenTest(test().id)}
                  >
                    Open “{test().title}”
                  </button>
                </footer>
              )}
            </Show>
          </aside>
        )}
      </Show>
    </section>
  );
}

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
          Example journeys
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

/**
 * A small, always-visible mental-model cue. A flow only orchestrates named
 * journeys: each journey owns its own return path and the flow has one clear
 * beginning and end. We do not make people reason about a generic graph.
 */
function FlowPathGuide(props: { suite: TestSuite; titleForTest: (testId: string) => string }) {
  const entries = () => props.suite.sections.flatMap((section) => section.entries);
  const enabled = () => entries().filter((entry) => entry.enabled);
  const first = () => enabled()[0];
  const remaining = () => Math.max(0, enabled().length - 1);

  return (
    <div class="border-b border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-deep)] px-4 py-2.5">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[10px] font-semibold tracking-[0.09em] text-[var(--text-weak)] uppercase">
          This flow
        </span>
        <span class="text-[10px] text-[var(--text-weak)]">Runs in order</span>
      </div>
      <div class="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-base)]">
        <span class="shrink-0 font-medium text-[var(--text-strong)]">Start</span>
        <Icon name="chevron-right" size={12} class="shrink-0 text-[var(--text-weak)]" />
        <span class="min-w-0 truncate rounded-md bg-[var(--v2-background-bg-layer-02)] px-1.5 py-0.5 font-medium text-[var(--text-strong)]">
          {first() ? props.titleForTest(first()!.testId) : "Add the first test"}
        </span>
        <Show when={remaining() > 0}>
          <span class="shrink-0 text-[var(--text-weak)]">+{remaining()}</span>
        </Show>
        <Icon name="chevron-right" size={12} class="shrink-0 text-[var(--text-weak)]" />
        <span class="shrink-0 font-medium text-[var(--text-strong)]">Finish</span>
      </div>
      <p class="mt-1.5 text-[10px]/[1.35] text-[var(--text-weak)]">
        Every journey starts from its recorded state and leaves the device ready for the next one.
      </p>
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
      title: `Flow ${server.suites().length + 1}`,
      sections: [{ title: "Main path", entries: [] }],
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

  // A Flow is a sequence, not a blank container. Opening one should immediately
  // show the first runnable test; the user can then move through the sequence
  // deliberately instead of first having to discover a second selection.
  createEffect(() => {
    const suite = selectedSuite();
    if (!suite) {
      if (selectedEntryId()) setSelectedEntryId(null);
      return;
    }
    const entries = suite.sections.flatMap((section) => section.entries);
    if (entries.some((entry) => entry.id === selectedEntryId())) return;
    const first = entries.find((entry) => entry.enabled) ?? entries[0];
    if (first) selectEntry(first.id, first.testId);
    else setSelectedEntryId(null);
  });

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
  const titleForTest = (testId: string) =>
    displayTitle(server.recipes().find((test) => test.id === testId)?.title ?? "Missing test");
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

  // The user sees one ordered Flow even when they use named stages to keep a
  // longer release journey readable. Moving therefore crosses stage boundaries
  // instead of silently stopping at the first or last item in a stage.
  const moveEntry = (suite: TestSuite, entryId: string, direction: -1 | 1) => {
    const ordered = suite.sections.flatMap((section) =>
      section.entries.map((entry) => ({ sectionId: section.id, entry })),
    );
    const from = ordered.findIndex((item) => item.entry.id === entryId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;

    const source = ordered[from]!;
    const destination = ordered[to]!;
    const sections = suite.sections.map((section) => ({
      ...section,
      entries: [...section.entries],
    }));
    const sourceSection = sections.find((section) => section.id === source.sectionId)!;
    const destinationSection = sections.find((section) => section.id === destination.sectionId)!;
    const sourceIndex = sourceSection.entries.findIndex((entry) => entry.id === entryId);
    const [moved] = sourceSection.entries.splice(sourceIndex, 1);
    if (!moved) return;
    const destinationIndex = destinationSection.entries.findIndex(
      (entry) => entry.id === destination.entry.id,
    );
    destinationSection.entries.splice(
      direction < 0 ? destinationIndex : destinationIndex + 1,
      0,
      moved,
    );
    void save(suite, sections);
  };

  return (
    <section
      class={cn(
        "grid min-h-0 min-w-0 flex-1 overflow-hidden max-[900px]:grid-cols-1",
        selectedSuite()
          ? "grid-cols-[minmax(280px,300px)_minmax(420px,1fr)_224px] max-[1160px]:grid-cols-[minmax(248px,280px)_minmax(360px,1fr)_200px]"
          : "grid-cols-[224px_minmax(0,1fr)] max-[1160px]:grid-cols-[200px_minmax(0,1fr)]",
      )}
    >
      <aside
        class={cn(
          "flex min-h-0 flex-col border-r border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]",
          selectedSuite() && "col-start-3 row-start-1 border-r-0 border-l",
        )}
      >
        <header class="flex min-h-14 items-center justify-between gap-2 border-b border-[var(--v2-border-border-muted)] px-3">
          <div>
            <strong class="block text-[13px] font-semibold text-[var(--text-strong)]">Flows</strong>
            <small class="text-[10px] text-[var(--text-weak)]">
              {server.suites().length} saved flow{server.suites().length === 1 ? "" : "s"}
            </small>
          </div>
          <button
            type="button"
            class={productIconButton}
            aria-label="New flow"
            data-tip="Create a new flow"
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
                title="No flows yet"
                description="Arrange named journeys into one ordered run."
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
                      {count()} {count() === 1 ? "journey" : "journeys"}
                    </small>
                  </span>
                </SelectableRow>
              );
            }}
          </For>
        </div>
      </aside>

      <div
        class={cn(
          shellStageWrap,
          "flex min-h-0 flex-col",
          selectedSuite() && "col-start-2 row-start-1",
        )}
      >
        <Show
          when={selectedSuite()}
          fallback={
            <div class="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-6 py-10">
              <div class="grid w-full max-w-[380px] justify-items-center gap-6">
                <SuiteChecklistPreview />
                <EmptyState
                  size="lg"
                  icon="check"
                  title="Create a flow"
                  description="Arrange existing journeys into one reusable sequence."
                  actionLabel="Create a flow"
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
                title="Select a journey"
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
          <aside class="relative col-start-1 row-start-1 flex min-h-0 flex-col border-r border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]">
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
                    aria-label="Flow name"
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
                    aria-label="Rename flow"
                    data-tip="Rename flow"
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
                  aria-label="Flow history"
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
                  aria-label="Delete flow"
                  data-tip="Delete this flow"
                  onClick={() => {
                    confirmAction({
                      title: "Delete flow?",
                      body: `“${suite().title}” will be removed. Journeys inside it are not deleted.`,
                      confirmLabel: "Delete flow",
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
                  {suiteExecutionJob()?.status === "running" ? "Running flow" : "Run flow"}
                </button>
              </div>
            </header>

            <FlowPathGuide suite={suite()} titleForTest={titleForTest} />

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
                          {version.sections.length} stages
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
                          aria-label={`Stage ${sectionIndex() + 1} name`}
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
                          aria-label="Rename stage"
                          data-tip="Rename stage"
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
                        aria-label={`Remove ${section.title} stage`}
                        data-tip="Remove this stage"
                        onClick={() => {
                          const removeSection = () =>
                            void save(
                              suite(),
                              suite().sections.filter((item) => item.id !== section.id),
                            );
                          if (section.entries.length === 0) return removeSection();
                          confirmAction({
                            title: "Remove stage?",
                            body: `“${section.title}” and its ${section.entries.length} ${section.entries.length === 1 ? "journey" : "journeys"} will be removed from this flow.`,
                            confirmLabel: "Remove stage",
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
                        {(entry) => {
                          const test = () =>
                            server.recipes().find((item) => item.id === entry.testId);
                          const job = () => latestJob(entry.testId);
                          const flowEntries = () =>
                            suite().sections.flatMap((item) => item.entries);
                          const flowIndex = () =>
                            flowEntries().findIndex((item) => item.id === entry.id);
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
                                  {usedIn(entry.testId) === 1 ? "flow" : "flows"} ·{" "}
                                  {entry.version === "latest" ? "Follows latest" : "Pinned"}
                                </small>
                              </button>
                              <div class="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                                <button
                                  type="button"
                                  class={productIconButton}
                                  aria-label="Move test earlier in flow"
                                  data-tip="Move earlier"
                                  disabled={flowIndex() === 0}
                                  onClick={() => moveEntry(suite(), entry.id, -1)}
                                >
                                  <Icon name="chevron-up" size={12} />
                                </button>
                                <button
                                  type="button"
                                  class={productIconButton}
                                  aria-label="Move test later in flow"
                                  data-tip="Move later"
                                  disabled={flowIndex() === flowEntries().length - 1}
                                  onClick={() => moveEntry(suite(), entry.id, 1)}
                                >
                                  <Icon name="chevron-down" size={12} />
                                </button>
                                <button
                                  type="button"
                                  class={productIconButtonDanger}
                                  aria-label="Remove from flow"
                                  data-tip="Remove from flow"
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
                        data-tip="Record a new test into this stage"
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
                              <span class="sr-only">Search journeys</span>
                              <input
                                ref={(element) => (addSearchInput = element)}
                                class="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)]"
                                type="search"
                                value={addQuery()}
                                placeholder="Search journeys"
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
                                  No journeys match.
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
                      title: `Stage ${suite().sections.length + 1}`,
                      entries: [],
                    },
                  ])
                }
              >
                <Icon name="plus" size={13} /> Add stage
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

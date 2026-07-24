import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useServer, type SuiteSection, type TestSuite } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { productIconButton, productIconButtonDanger, productPrimary } from "../lib/ui";
import { shellStageWrap } from "../lib/shell-layout";
import { DeviceStage } from "./stage";
import { ExecutionInspector } from "./execution-inspector";
import { ExecutionTimeline } from "./execution-timeline";
import { EmptyState } from "./empty-state";
import { Icon } from "./icon";
import { executionDuration, executionElapsedAt, executionMoments } from "../lib/execution-moments";
import { displayTitle } from "../lib/job";
import { confirmAction } from "./confirm-dialog";

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
        // The flow list lives in the navigator, so this pane only ever shows
        // the open flow: its ordered journeys and the selected entry.
        selectedSuite()
          ? "grid-cols-[minmax(420px,1fr)_336px] max-[1160px]:grid-cols-[minmax(360px,1fr)_300px]"
          : "grid-cols-1",
      )}
    >
      <div class={cn(shellStageWrap, "flex min-h-0 flex-col")}>
        <Show
          when={selectedSuite()}
          fallback={
            // The navigator already lists flows and offers "New flow", so this
            // is a one-line hint, not a second front door.
            <EmptyState
              size="lg"
              icon="check"
              title={server.suites().length ? "Select a flow" : "Create a flow"}
              description="A flow runs named journeys in order, one after another."
              {...(server.suites().length
                ? {}
                : { actionLabel: "Create a flow", onAction: () => void createSuite() })}
              class="h-full justify-center"
            />
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
            {/* One header row. A flow is an ordered list of journeys — the
                list itself says so, so it needs no diagram above it and no
                full-width call to action shouting at an empty list. */}
            <header class="flex min-h-[52px] shrink-0 items-center gap-1.5 border-b border-[var(--v2-border-border-muted)] px-3">
              <input
                ref={(element) => (suiteTitleInput = element)}
                aria-label="Flow name"
                data-tip="Rename flow"
                class="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[14px] font-semibold tracking-[-0.015em] text-[var(--text-strong)] outline-none transition hover:bg-[var(--v2-background-bg-layer-01)] focus:bg-[var(--v2-background-bg-layer-01)] focus:shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]"
                value={suite().title}
                onChange={(event) =>
                  void save(suite(), suite().sections, event.currentTarget.value)
                }
              />
              <button
                type="button"
                class={productIconButton}
                aria-label="Flow history"
                data-tip="Version history"
                aria-expanded={historyOpen()}
                onClick={() => {
                  const open = !historyOpen();
                  setHistoryOpen(open);
                  if (open) void server.loadSuiteHistory(suite().id).then(setHistory);
                }}
              >
                <Icon name="clock" size={15} />
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
                <Icon name="trash" size={15} />
              </button>
              <button
                type="button"
                class={cn(productPrimary, "min-h-8 shrink-0 px-3 text-[12px]")}
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
                  size={12}
                />
                {suiteExecutionJob()?.status === "running" ? "Running" : "Run"}
              </button>
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
                          {version.sections.length} stages
                        </small>
                      </span>
                      <Icon name="refresh" size={13} />
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              <For each={suite().sections}>
                {(section, sectionIndex) => {
                  // Journeys are numbered across the whole flow: the number is
                  // run order, and stages are only a way to name a span of it.
                  const offset = () =>
                    suite()
                      .sections.slice(0, sectionIndex())
                      .reduce((sum, item) => sum + item.entries.length, 0);
                  return (
                    <section class="mb-3">
                      <div class="group/stage flex min-h-8 items-center gap-1 px-1">
                        <input
                          ref={(element) => sectionTitleInputs.set(section.id, element)}
                          aria-label={`Stage ${sectionIndex() + 1} name`}
                          data-tip="Rename stage"
                          class="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[10px] font-semibold tracking-[0.09em] text-[var(--text-weaker)] uppercase outline-none transition hover:bg-[var(--v2-background-bg-layer-01)] focus:text-[var(--text-strong)] focus:bg-[var(--v2-background-bg-layer-01)] max-[900px]:text-[16px]"
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
                          class={cn(
                            productIconButtonDanger,
                            "size-6 opacity-0 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100",
                          )}
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

                      <For each={section.entries}>
                        {(entry, entryIndex) => {
                          const test = () =>
                            server.recipes().find((item) => item.id === entry.testId);
                          const job = () => latestJob(entry.testId);
                          const flowEntries = () =>
                            suite().sections.flatMap((item) => item.entries);
                          const flowIndex = () =>
                            flowEntries().findIndex((item) => item.id === entry.id);
                          const steps = () => test()?.steps.length ?? 0;
                          return (
                            <div
                              class={cn(
                                "group grid min-h-9 grid-cols-[26px_16px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-lg pr-1 pl-1 transition-colors",
                                selectedEntryId() === entry.id
                                  ? "bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_15%,transparent)]"
                                  : "hover:bg-[var(--v2-background-bg-layer-01)]",
                                !entry.enabled && "opacity-45",
                              )}
                            >
                              <label
                                class="grid h-9 cursor-pointer grid-cols-[auto_auto] items-center gap-1.5 pl-1"
                                aria-label={`${entry.enabled ? "Skip" : "Include"} ${test()?.title ?? entry.testId}`}
                              >
                                <input
                                  type="checkbox"
                                  class="size-3 accent-[var(--text-interactive-base)]"
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
                                <small class="font-mono text-[9.5px] tabular-nums text-[var(--text-weaker)]">
                                  {String(offset() + entryIndex() + 1).padStart(2, "0")}
                                </small>
                              </label>
                              <span
                                class={cn(
                                  "justify-self-center size-1.5 rounded-full",
                                  statusTone(job()?.status),
                                )}
                                aria-hidden="true"
                              />
                              <button
                                type="button"
                                class="min-w-0 py-1.5 text-left"
                                title={test()?.title ?? "Missing journey"}
                                onClick={() => selectEntry(entry.id, entry.testId)}
                                onDblClick={() => props.onOpenTest(entry.testId)}
                              >
                                <span class="block truncate text-[12px] font-medium text-[var(--text-strong)]">
                                  {test()?.title ?? "Missing journey"}
                                </span>
                              </button>
                              <div class="flex items-center gap-0.5">
                                <small class="mr-1 font-mono text-[9.5px] tabular-nums text-[var(--text-weaker)] group-hover:hidden">
                                  {steps() || "—"}
                                </small>
                                <div class="hidden items-center group-hover:flex group-focus-within:flex [@media(hover:none)]:flex">
                                  <button
                                    type="button"
                                    class={cn(productIconButton, "size-6")}
                                    aria-label="Open this journey"
                                    data-tip="Open journey"
                                    onClick={() => props.onOpenTest(entry.testId)}
                                  >
                                    <Icon name="chevron-right" size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    class={cn(productIconButton, "size-6")}
                                    aria-label="Move journey earlier in flow"
                                    data-tip="Move earlier"
                                    disabled={flowIndex() === 0}
                                    onClick={() => moveEntry(suite(), entry.id, -1)}
                                  >
                                    <Icon name="chevron-up" size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    class={cn(productIconButton, "size-6")}
                                    aria-label="Move journey later in flow"
                                    data-tip="Move later"
                                    disabled={flowIndex() === flowEntries().length - 1}
                                    onClick={() => moveEntry(suite(), entry.id, 1)}
                                  >
                                    <Icon name="chevron-down" size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    class={cn(productIconButtonDanger, "size-6")}
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
                            </div>
                          );
                        }}
                      </For>

                      {/* One way in. The dropzone, the combobox, and the bare
                          red dot were three affordances for the same act. */}
                      <div class="relative" data-add-test-popover>
                        <button
                          type="button"
                          class="grid min-h-8 w-full grid-cols-[26px_minmax(0,1fr)] items-center gap-1.5 rounded-lg pl-1 text-left text-[11.5px] font-medium text-[var(--text-weaker)] transition-colors hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--text-base)]"
                          aria-haspopup="dialog"
                          aria-expanded={addPopoverSection() === section.id}
                          onClick={() => {
                            setAddQuery("");
                            setAddPopoverSection((current) =>
                              current === section.id ? null : section.id,
                            );
                          }}
                        >
                          <Icon name="plus" size={13} class="justify-self-center" />
                          <span>Add journey</span>
                        </button>
                        <Show when={addPopoverSection() === section.id}>
                          <div
                            class="ui-pop absolute top-[calc(100%+4px)] left-0 z-30 flex max-h-[300px] w-[268px] flex-col overflow-hidden rounded-xl border border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha shadow-[var(--v2-elevation-overlay)]"
                            role="dialog"
                            aria-label={`Add journey to ${section.title}`}
                          >
                            <label class="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--v2-border-border-muted)] px-2.5 text-[var(--text-weaker)]">
                              <Icon name="search" size={13} />
                              <span class="sr-only">Search journeys</span>
                              <input
                                ref={(element) => (addSearchInput = element)}
                                class="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weaker)]"
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
                            <div class="min-h-0 flex-1 overflow-y-auto p-1">
                              <button
                                type="button"
                                class="grid min-h-8 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 text-left text-[11.5px] font-medium text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                                onClick={() => {
                                  closeAddPopover();
                                  props.onRecordTest(suite().id, section.id);
                                }}
                              >
                                <span
                                  class="size-2 justify-self-center rounded-full bg-[var(--icon-critical-base)]"
                                  aria-hidden="true"
                                />
                                <span>Record a new journey</span>
                              </button>
                              <div class="my-1 h-px bg-[var(--v2-border-border-muted)]" />
                              <For
                                each={filteredLibraryTests()}
                                fallback={
                                  <p class="px-2 py-4 text-center text-[11px] text-[var(--text-weak)]">
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
                                      class="grid min-h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left hover:bg-[var(--v2-background-bg-layer-02)]"
                                      onClick={() => addTestToSection(suite(), section, test.id)}
                                    >
                                      <span class="truncate text-[11.5px] font-medium text-[var(--text-strong)]">
                                        {title()}
                                        {duplicate() ? ` · ${test.id.slice(0, 8)}` : ""}
                                      </span>
                                      <small class="font-mono text-[9.5px] tabular-nums text-[var(--text-weaker)]">
                                        {test.steps.length}
                                      </small>
                                    </button>
                                  );
                                }}
                              </For>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </section>
                  );
                }}
              </For>
              <button
                type="button"
                class="grid min-h-8 w-full grid-cols-[26px_minmax(0,1fr)] items-center gap-1.5 rounded-lg pl-1 text-left text-[11.5px] font-medium text-[var(--text-weaker)] transition-colors hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--text-base)]"
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
                <Icon name="plus" size={13} class="justify-self-center" />
                <span>Add stage</span>
              </button>
            </div>
          </aside>
        )}
      </Show>
    </section>
  );
}

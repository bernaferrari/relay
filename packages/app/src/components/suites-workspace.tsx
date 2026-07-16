import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useServer, type SuiteSection, type TestSuite } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import {
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
import { executionDuration, executionElapsedAt, executionMoments } from "../lib/execution-moments";

export function SuitesWorkspace(props: {
  onOpenTest: (id: string) => void;
  onOpenRun: (id: string) => void;
  onOpenTargets: () => void;
  onRecordTest: (suiteId: string, sectionId: string) => void;
}) {
  const server = useServer();
  const workbench = useWorkbench();
  const [selectedEntryId, setSelectedEntryId] = createSignal<string | null>(null);
  const [addingTest, setAddingTest] = createSignal<Record<string, string>>({});
  const [history, setHistory] = createSignal<TestSuite[] | null>(null);
  const [historyOpen, setHistoryOpen] = createSignal(false);

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
    if (suite) server.setSelectedSuiteId(suite.id);
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
      ? "bg-[var(--relay-green)]"
      : status === "error"
        ? "bg-[var(--relay-red)]"
        : status === "running" || status === "queued" || status === "paused"
          ? "bg-[var(--text-interactive-base)]"
          : "bg-[var(--relay-text-tertiary)]";

  const usedIn = (testId: string) =>
    server
      .suites()
      .filter((suite) =>
        suite.sections.some((section) => section.entries.some((entry) => entry.testId === testId)),
      ).length;

  return (
    <section
      class={cn(
        "grid min-h-0 min-w-0 flex-1 overflow-hidden max-[900px]:grid-cols-1",
        selectedSuite()
          ? "grid-cols-[224px_minmax(420px,1fr)_390px] max-[1160px]:grid-cols-[200px_minmax(360px,1fr)_340px]"
          : "grid-cols-[224px_minmax(0,1fr)] max-[1160px]:grid-cols-[200px_minmax(0,1fr)]",
      )}
    >
      <aside class="flex min-h-0 flex-col border-r border-[var(--relay-line)] bg-[var(--relay-panel)]">
        <header class="flex min-h-14 items-center justify-between gap-2 border-b border-[var(--relay-line)] px-3">
          <div>
            <strong class="block text-[13px] font-semibold text-[var(--relay-text)]">Suites</strong>
            <small class="text-[10px] text-[var(--relay-text-tertiary)]">
              {server.suites().length} saved
            </small>
          </div>
          <button
            type="button"
            class={productIconButton}
            aria-label="New suite"
            onClick={() => void createSuite()}
          >
            <Icon name="plus" size={14} />
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <For
            each={server.suites()}
            fallback={
              <div class="grid min-h-48 place-items-center px-4 text-center">
                <div>
                  <strong class="text-[12px] text-[var(--relay-text)]">No suites yet</strong>
                  <p class="mt-1 text-[11px]/[1.45] text-[var(--relay-text-tertiary)]">
                    Your release checklists will appear here.
                  </p>
                </div>
              </div>
            }
          >
            {(suite) => {
              const count = () =>
                suite.sections.reduce((sum, section) => sum + section.entries.length, 0);
              return (
                <button
                  type="button"
                  class={cn(
                    "flex min-h-12 w-full items-center gap-2 rounded-lg px-2.5 text-left outline-none hover:bg-[var(--relay-surface-raised)] focus-visible:outline-1 focus-visible:outline-offset-1",
                    selectedSuite()?.id === suite.id && "bg-[var(--relay-surface-strong)]",
                  )}
                  aria-current={selectedSuite()?.id === suite.id ? "page" : undefined}
                  onClick={() => {
                    server.setSelectedSuiteId(suite.id);
                    setSelectedEntryId(null);
                    setHistoryOpen(false);
                  }}
                >
                  <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--relay-surface-strong)] text-[var(--relay-text-secondary)]">
                    <Icon name="check" size={14} />
                  </span>
                  <span class="min-w-0">
                    <strong class="block truncate text-[12px] font-medium text-[var(--relay-text)]">
                      {suite.title}
                    </strong>
                    <small class="text-[10px] text-[var(--relay-text-tertiary)]">
                      {count()} {count() === 1 ? "test" : "tests"}
                    </small>
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </aside>

      <div class={cn(shellStageWrap, "flex min-h-0 flex-col")}>
        <Show
          when={selectedSuite()}
          fallback={
            <EmptyState
              size="lg"
              icon="check"
              title="Create a release suite"
              description="Group existing tests into a checklist your team can edit, reuse, and run together."
              actionLabel="Create a suite"
              onAction={() => void createSuite()}
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
          <aside class="relative flex min-h-0 flex-col border-l border-[var(--relay-line)] bg-[var(--relay-panel)]">
            <Show
              when={
                suiteExecutionJob() &&
                ["queued", "running", "paused"].includes(suiteExecutionJob()!.status)
                  ? suiteExecutionJob()
                  : null
              }
            >
              {(job) => (
                <div class="absolute inset-0 z-10 bg-[var(--relay-panel)]">
                  <ExecutionInspector job={job()} onOpenReport={props.onOpenRun} />
                </div>
              )}
            </Show>
            <header class="border-b border-[var(--relay-line)] px-4 py-3.5">
              <div class="flex items-center gap-2">
                <input
                  aria-label="Suite name"
                  class="min-w-0 flex-1 rounded-md bg-transparent text-[16px] font-semibold tracking-[-0.015em] text-[var(--relay-text)] outline-none focus:bg-[var(--relay-surface-raised)] focus:px-2"
                  value={suite().title}
                  onChange={(event) =>
                    void save(suite(), suite().sections, event.currentTarget.value)
                  }
                />
                <button
                  type="button"
                  class={productIconButton}
                  aria-label="Suite history"
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
                  onClick={() => {
                    if (
                      window.confirm(`Delete “${suite().title}”? The library tests will remain.`)
                    ) {
                      void server.deleteSuite(suite().id);
                    }
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
              <div class="max-h-52 overflow-y-auto border-b border-[var(--relay-line)] bg-[var(--relay-bg)] p-2">
                <div class="mb-1 flex min-h-8 items-center justify-between px-1.5">
                  <strong class="text-[11px] text-[var(--relay-text-secondary)]">
                    Version history
                  </strong>
                  <button
                    type="button"
                    class={productIconButton}
                    aria-label="Close history"
                    onClick={() => setHistoryOpen(false)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
                <For
                  each={history() ?? []}
                  fallback={
                    <p class="px-2 py-3 text-[11px] text-[var(--relay-text-tertiary)]">
                      No earlier versions yet.
                    </p>
                  }
                >
                  {(version) => (
                    <button
                      type="button"
                      class="flex min-h-10 w-full items-center justify-between rounded-md px-2 text-left hover:bg-[var(--relay-surface-raised)]"
                      onClick={() =>
                        void server
                          .restoreSuite(suite().id, version.updatedAt)
                          .then(() => setHistoryOpen(false))
                      }
                    >
                      <span>
                        <strong class="block text-[11px] font-medium text-[var(--relay-text)]">
                          {new Date(version.updatedAt).toLocaleString()}
                        </strong>
                        <small class="text-[10px] text-[var(--relay-text-tertiary)]">
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
                      <input
                        aria-label={`Section ${sectionIndex() + 1} name`}
                        class="min-w-0 flex-1 bg-transparent text-[10px] font-semibold tracking-[0.1em] text-[var(--relay-text-tertiary)] uppercase outline-none focus:text-[var(--relay-text)] max-[900px]:text-[16px]"
                        value={section.title}
                        onChange={(event) =>
                          patchSection(suite(), section.id, {
                            ...section,
                            title: event.currentTarget.value,
                          })
                        }
                      />
                      <span class="text-[10px] tabular-nums text-[var(--relay-text-tertiary)]">
                        {section.entries.length}
                      </span>
                      <button
                        type="button"
                        class={productIconButtonDanger}
                        aria-label={`Remove ${section.title} section`}
                        onClick={() => {
                          const remove =
                            section.entries.length === 0 ||
                            window.confirm(
                              `Remove “${section.title}” and its ${section.entries.length} suite ${section.entries.length === 1 ? "entry" : "entries"}? Library tests will remain.`,
                            );
                          if (!remove) return;
                          void save(
                            suite(),
                            suite().sections.filter((item) => item.id !== section.id),
                          );
                        }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                    <div class="grid gap-1">
                      <For
                        each={section.entries}
                        fallback={
                          <p class="m-0 rounded-lg border border-dashed border-[var(--relay-line)] px-3 py-4 text-center text-[11px] text-[var(--relay-text-tertiary)]">
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
                                "group grid min-h-14 grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] px-2 outline-none hover:bg-[var(--relay-surface-raised)]",
                                selectedEntryId() === entry.id &&
                                  "bg-[var(--relay-surface-strong)]",
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
                                  <strong class="truncate text-[12px] font-medium text-[var(--relay-text)]">
                                    {test()?.title ?? "Missing test"}
                                  </strong>
                                </span>
                                <small class="mt-1 block truncate text-[10px] text-[var(--relay-text-tertiary)]">
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
                    <div class="mt-2 flex items-center gap-1.5">
                      <select
                        aria-label={`Test to add to ${section.title}`}
                        class="min-h-9 min-w-0 flex-1 rounded-lg border border-[var(--relay-line)] bg-[var(--relay-bg)] px-2 text-[11px] text-[var(--relay-text)] outline-none focus:border-[var(--relay-line-strong)] max-[900px]:text-[16px]"
                        value={addingTest()[section.id] ?? ""}
                        onChange={(event) =>
                          setAddingTest((items) => ({
                            ...items,
                            [section.id]: event.currentTarget.value,
                          }))
                        }
                      >
                        <option value="">Add from library…</option>
                        <For each={server.recipes()}>
                          {(test) => <option value={test.id}>{test.title}</option>}
                        </For>
                      </select>
                      <button
                        type="button"
                        class={productIconButton}
                        aria-label={`Add test to ${section.title}`}
                        disabled={!addingTest()[section.id]}
                        onClick={() => {
                          const testId = addingTest()[section.id];
                          if (!testId) return;
                          patchSection(suite(), section.id, {
                            ...section,
                            entries: [
                              ...section.entries,
                              { id: crypto.randomUUID(), testId, enabled: true, version: "latest" },
                            ],
                          });
                          setAddingTest((items) => ({ ...items, [section.id]: "" }));
                        }}
                      >
                        <Icon name="plus" size={13} />
                      </button>
                      <button
                        type="button"
                        class={productIconButton}
                        aria-label={`Record a new test in ${section.title}`}
                        onClick={() => props.onRecordTest(suite().id, section.id)}
                      >
                        <span class="size-2 rounded-full bg-[var(--relay-red)]" />
                      </button>
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
                <footer class="border-t border-[var(--relay-line)] p-3">
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

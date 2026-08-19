import {
  For,
  type JSX,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { Button } from "@relay/ui/button";
import type { CorpusFinding, CorpusSession } from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { cn } from "../lib/cn";
import {
  type CorpusReview,
  type CorpusReviewCell,
  corpusReview,
  corpusScreenUrl,
  corpusStateLabel,
  localeGridColumns,
  sortCorpusSessions,
  tallyCorpusVerdicts,
} from "../lib/corpus-review";
import {
  forgetKnownFinding,
  listCorpusSweeps,
  listKnownFindings,
  markFindingKnown,
  readCorpusAnalysis,
  readCorpusCoverage,
  readCorpusSweep,
  startCorpusSweep,
  stopCorpusSweep,
} from "../lib/corpus-remote";
import { humanError } from "../lib/human-error";
import {
  FALLBACK_MEDIA_RATIO,
  boundedMediaRatio,
  mediaAspectStyle,
} from "../lib/app-map-screen-media-aspect";
import { type LocaleCellVerdict, localeVerdictPresentation } from "../lib/locale-matrix-verdict";
import { EmptyState } from "./empty-state";
import { Icon } from "./icon";
import {
  LocaleMatrixCell,
  LocaleMatrixCellSkeleton,
  LocaleVerdictLegend,
} from "./locale-matrix-cell";
import { LocaleSweepCompare } from "./locale-sweep-compare";
import { LocaleSweepStart } from "./locale-sweep-start";

/** A live sweep is re-read often enough to watch, rarely enough to stay quiet. */
const POLL_MS = 4000;

/**
 * Reading a locale sweep: forty screens crawled once, replayed in every
 * language, and compared.
 *
 * The grid is the Combine grid — same cell, same verdicts, same defect-first
 * legend — because a corpus finding and a Combine cell are the same idea seen
 * from two angles, and a person should not have to learn the difference. What
 * is new here is the shape of the thing being reviewed: one screen at a time
 * across every language, rather than one Test across the values of a Variable.
 */
export function LocaleSweepReview(props: { suggestedName?: string }) {
  const server = useServer();
  const [sweeps, { refetch: refetchSweeps }] = createResource(
    () => (server.health() === "online" ? "online" : null),
    () => listCorpusSweeps(server.runAction),
  );
  const [selectedId, setSelectedId] = createSignal("");
  const [screenKey, setScreenKey] = createSignal("");
  const [verdictFilter, setVerdictFilter] = createSignal<LocaleCellVerdict | null>(null);
  const [localeQuery, setLocaleQuery] = createSignal("");
  const [focusedLocale, setFocusedLocale] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  // Why the grid has no verdicts, when it has none. A swallowed read looks
  // exactly like a clean sweep, which is the one thing it must not look like.
  const [analysisError, setAnalysisError] = createSignal("");
  // One frame shape for the whole grid, learned from the first capture that
  // loads. Kept here rather than per cell so the grid settles once instead of
  // reflowing behind every lazy image.
  const [cellRatio, setCellRatio] = createSignal(FALLBACK_MEDIA_RATIO);
  const adoptCellRatio = (size: { width: number; height: number }) => {
    const ratio = boundedMediaRatio(size);
    if (ratio !== undefined && Math.abs(ratio - cellRatio()) > 0.01) setCellRatio(ratio);
  };

  const ordered = createMemo(() => sortCorpusSessions(sweeps.latest ?? []));
  createEffect(() => {
    const list = ordered();
    if (!list.length || list.some((sweep) => sweep.id === selectedId())) return;
    setSelectedId(list[0]!.id);
  });

  // Accepted findings are workspace-wide, so they load once rather than per
  // sweep — and the grid re-reads itself when one is accepted or restored.
  const [known, { refetch: refetchKnown }] = createResource(
    () => (server.health() === "online" ? "online" : null),
    () => listKnownFindings(server.runAction),
  );
  const knownFindings = createMemo(() => known.latest ?? []);

  const [detail, { refetch: refetchDetail }] = createResource(
    () => selectedId() || null,
    async (sessionId: string) => {
      const session = await readCorpusSweep(server.runAction, sessionId);
      // Coverage names and orders the screens; the analysis judges them. Either
      // can be missing on a sweep that has not run yet, and a grid that says
      // "not checked" is more honest than one that refuses to draw. The server
      // derives the analysis on every read, so a sweep is checked by opening
      // it — but a read that failed has to say so rather than read as clean.
      const [coverage, analysis] = await Promise.all([
        readCorpusCoverage(server.runAction, sessionId).catch(() => null),
        readCorpusAnalysis(server.runAction, sessionId).then(
          (report) => {
            setAnalysisError("");
            return report;
          },
          (error: unknown) => {
            setAnalysisError(humanError(error, "Could not check this sweep"));
            return null;
          },
        ),
      ]);
      return { session, coverage, analysis };
    },
  );
  // `latest` so a poll mid-sweep never blanks the grid a person is reading.
  const review = createMemo((): CorpusReview | null => {
    const parts = detail.latest;
    return parts ? corpusReview({ ...parts, known: knownFindings() }) : null;
  });

  createEffect(() => {
    if (!review()?.sweeping) return;
    const timer = setInterval(() => {
      void refetchDetail();
      void refetchSweeps();
    }, POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const screens = () => review()?.screens ?? [];
  // Forty screens is more than anybody reads in order, so the sweep opens on the
  // screen with the most to answer for. The picker keeps coverage's own order,
  // because scanning a list for a screen you remember beats a list that moves.
  const worstScreen = createMemo(() =>
    screens().reduce(
      (worst, item) => (worst && worst.defects >= item.defects ? worst : item),
      screens()[0],
    ),
  );
  const screen = createMemo(
    () => screens().find((item) => item.canonicalKey === screenKey()) ?? worstScreen(),
  );
  createEffect(() => {
    // A screen that exists on one sweep will not exist on the next, and a
    // stale selection reads as an empty grid rather than a changed sweep.
    selectedId();
    setScreenKey("");
    setVerdictFilter(null);
    setFocusedLocale(null);
  });

  const matchedCells = createMemo(() => {
    const needle = localeQuery().trim().toLocaleLowerCase();
    return (screen()?.cells ?? []).filter(
      (cell) =>
        !needle ||
        cell.locale.toLocaleLowerCase().includes(needle) ||
        languageName(cell.locale).toLocaleLowerCase().includes(needle),
    );
  });
  const visibleCells = createMemo(() => {
    const verdict = verdictFilter();
    return verdict ? matchedCells().filter((cell) => cell.verdict === verdict) : matchedCells();
  });
  const tallies = createMemo(() => tallyCorpusVerdicts(matchedCells()));

  const sourceFor = (screenId: string | undefined) =>
    screenId && selectedId() ? corpusScreenUrl(server.serverUrl(), selectedId(), screenId) : "";

  const focusedIndex = createMemo(() =>
    visibleCells().findIndex((cell) => cell.locale === focusedLocale()),
  );
  const focusedCell = createMemo(() => visibleCells()[focusedIndex()] ?? null);
  const moveFocus = (offset: -1 | 1) => {
    const next = visibleCells()[focusedIndex() + offset];
    if (next) setFocusedLocale(next.locale);
  };

  /**
   * Accepting a finding is the only way a second sweep is quieter than the
   * first. Finding ids are derived from the screen, the language and the
   * control rather than from the sweep, so the same clipped label stays
   * accepted the next time the crawl walks past it.
   */
  async function accept(
    finding: CorpusFinding,
    options: { scope: "locale" | "control"; note?: string },
  ) {
    try {
      await markFindingKnown(server.runAction, finding, options);
      await refetchKnown();
      toast(`“${finding.screenLabel}” in ${finding.locale} is known`, "success");
    } catch (error) {
      toast(humanError(error, "Could not mark it as known"), "error");
    }
  }

  async function restore(finding: CorpusFinding) {
    try {
      await forgetKnownFinding(server.runAction, finding.id);
      await refetchKnown();
      toast("Back in the queue", "success");
    } catch (error) {
      toast(humanError(error, "Could not restore it"), "error");
    }
  }

  async function control(action: "start" | "stop") {
    const current = review();
    if (!current || busy()) return;
    setBusy(true);
    try {
      const session =
        action === "start"
          ? await startCorpusSweep(server.runAction, current.sessionId)
          : await stopCorpusSweep(server.runAction, current.sessionId);
      await Promise.all([refetchDetail(), refetchSweeps()]);
      toast(action === "start" ? `Sweeping ${session.name}` : `Stopped ${session.name}`, "success");
    } catch (error) {
      toast(
        humanError(error, action === "start" ? "Could not start this sweep" : "Could not stop it"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="grid gap-3">
      <Show when={creating()}>
        <LocaleSweepStart
          {...(props.suggestedName ? { suggestedName: props.suggestedName } : {})}
          onCancel={() => setCreating(false)}
          onStarted={(session) => {
            setCreating(false);
            setSelectedId(session.id);
            void refetchSweeps();
          }}
        />
      </Show>

      <Show
        when={ordered().length}
        fallback={
          <Show when={!creating()}>
            <section class="grid min-h-[320px] place-items-center rounded-2xl bg-[var(--background-base)] px-6 py-10 shadow-[0_0_0_1px_var(--border-weak-base)]">
              <EmptyState
                size="lg"
                icon="grid"
                title={sweeps.loading ? "Looking for sweeps…" : "No locale sweeps yet"}
                description="A sweep crawls every screen once, replays the same tree in each language, and reports what changed — clipped labels, untranslated copy, screens a language never reached."
                actionLabel="New sweep"
                onAction={() => setCreating(true)}
              />
            </section>
          </Show>
        }
      >
        <section
          class="grid gap-2.5 rounded-2xl bg-[var(--background-base)] p-3.5 shadow-[0_0_0_1px_var(--border-weak-base)]"
          aria-label="Locale sweep"
        >
          <div class="flex flex-wrap items-center gap-2">
            <SweepSelect
              label="Sweep"
              value={selectedId()}
              onChange={setSelectedId}
              class="min-w-[220px] flex-1 sm:max-w-[420px]"
            >
              <For each={ordered()}>
                {(sweep) => <option value={sweep.id}>{sweepLabel(sweep)}</option>}
              </For>
            </SweepSelect>
            <Show when={review()}>
              {(current) => (
                <span
                  class="min-w-0 truncate text-micro tabular-nums text-[var(--text-weak)]"
                  aria-live="polite"
                >
                  {corpusStateLabel(current())} ·{" "}
                  {current().locales.length === 1
                    ? "1 language"
                    : `${current().locales.length} languages`}{" "}
                  ·{" "}
                  {current().screens.length === 1
                    ? "1 screen"
                    : `${current().screens.length} screens`}
                  <Show when={current().defects}>
                    <span class="ml-1.5 text-[var(--text-critical-base,var(--icon-critical-base))]">
                      {current().defects} {current().defects === 1 ? "defect" : "defects"}
                    </span>
                  </Show>
                  <Show when={current().known}>
                    <span class="ml-1.5">{current().known} known</span>
                  </Show>
                  {/* Only when it is bad news: every check but "was it there"
                      compares control labels, so screenshots taken without a
                      tree are captured rather than checked. */}
                  {/* Warning colour is not the signal — an icon carries it too,
                      because this line is the only place a sweep admits some of
                      its screenshots were never actually compared. */}
                  <Show when={current().coverage.inspected < current().coverage.captured}>
                    <span class="ml-1.5 inline-flex items-center gap-1 text-[var(--text-warning-base,var(--icon-warning-base))]">
                      <Icon name="alert" size={10} />
                      {current().coverage.captured - current().coverage.inspected} of{" "}
                      {current().coverage.captured} captured without a tree
                    </span>
                  </Show>
                </span>
              )}
            </Show>
            <div class="ml-auto flex shrink-0 items-center gap-2">
              <Show when={review()}>
                {(current) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy()}
                    aria-busy={busy()}
                    onClick={() => void control(current().sweeping ? "stop" : "start")}
                  >
                    <Icon name={current().sweeping ? "slash" : "play"} size={12} />
                    {current().sweeping ? "Stop" : "Run sweep"}
                  </Button>
                )}
              </Show>
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Icon name="plus" size={12} /> New sweep
              </Button>
            </div>
          </div>

          {/* Per-language coverage. On a forty-language sweep this is the only
              place that answers "has it got to Japanese yet", and it stays
              readable because each language is one pill, not one row. */}
          <Show when={review()}>
            {(current) => (
              <div class="flex flex-wrap gap-1" aria-label="Language coverage">
                <For each={current().localeProgress}>
                  {(item) => (
                    <span
                      class={cn(
                        "inline-flex min-h-6 items-center gap-1.5 rounded-full px-2 text-micro tabular-nums",
                        item.complete
                          ? "bg-[var(--surface-base)] text-[var(--text-base)]"
                          : "text-[var(--text-weak)] shadow-[inset_0_0_0_1px_var(--border-weak-base)]",
                      )}
                      title={`${languageName(item.locale)} · ${item.captured} of ${item.total} screens${
                        item.locale === current().baselineLocale ? " · baseline" : ""
                      }`}
                    >
                      <Show when={item.locale === current().baselineLocale}>
                        <Icon name="dot" size={9} />
                      </Show>
                      {item.locale}
                      <span class="text-[var(--text-weaker)]">
                        {item.captured}/{item.total}
                      </span>
                    </span>
                  )}
                </For>
              </div>
            )}
          </Show>
        </section>

        <section
          class="grid overflow-hidden rounded-2xl bg-[var(--background-base)] shadow-[0_0_0_1px_var(--border-weak-base)]"
          aria-label="Locale sweep findings"
        >
          {/* A finished sweep with no analysis behind it is one click from
              having one, and the click has to be here: a person reading "Not
              checked" forty times should never have to reach for a CLI. */}
          <Show when={review() && !review()!.analyzed && !review()!.sweeping}>
            <div
              class="flex flex-wrap items-center gap-2 border-b border-[var(--border-weak-base)] bg-[var(--surface-base)] px-5 py-2.5"
              role="status"
            >
              <Icon name="alert" size={12} class="text-[var(--icon-warning-base)]" />
              <span class="min-w-0 flex-1 text-caption text-[var(--text-base)]">
                {analysisError() || "Nothing has compared these languages yet."}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={detail.loading}
                aria-busy={detail.loading}
                onClick={() => void refetchDetail()}
              >
                Check now
              </Button>
            </div>
          </Show>
          <Show when={tallies().length}>
            <LocaleVerdictLegend
              tallies={tallies()}
              active={verdictFilter()}
              onSelect={setVerdictFilter}
            />
          </Show>
          <Show when={screens().length}>
            <div class="flex flex-wrap items-center gap-2 border-b border-[var(--border-weak-base)] px-5 py-2.5">
              <SweepSelect
                label="Screen to review"
                value={screen()?.canonicalKey ?? ""}
                onChange={setScreenKey}
                class="min-w-[220px] flex-1 sm:max-w-[360px]"
              >
                <For each={screens()}>
                  {(item) => (
                    <option value={item.canonicalKey}>
                      {item.label}
                      {item.defects
                        ? ` · ${item.defects} ${item.defects === 1 ? "defect" : "defects"}`
                        : ""}
                    </option>
                  )}
                </For>
              </SweepSelect>
              <label class="ml-auto flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-lg bg-[var(--surface-base)] px-2.5 shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus-within:shadow-[inset_0_0_0_1px_var(--border-strong-base)] sm:max-w-[260px]">
                <Icon name="search" size={12} class="text-[var(--text-weak)]" />
                <span class="sr-only">Filter languages</span>
                <input
                  type="search"
                  class="min-w-0 flex-1 border-0 bg-transparent text-caption text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)]"
                  value={localeQuery()}
                  placeholder="Filter languages"
                  onInput={(event) => setLocaleQuery(event.currentTarget.value)}
                />
              </label>
              <span class="shrink-0 text-micro tabular-nums text-[var(--text-weak)]">
                {visibleCells().length} {visibleCells().length === 1 ? "language" : "languages"}
              </span>
            </div>
          </Show>

          <div class="min-h-0 px-5 py-4">
            {/* Portrait captures make narrow cells, so the grid packs more of
                them per row than a landscape frame allowed. */}
            <div
              class="grid justify-start gap-3"
              style={{
                "--locale-cell-aspect": mediaAspectStyle(cellRatio()),
                "grid-template-columns": localeGridColumns(visibleCells().length),
              }}
            >
              <For each={visibleCells()}>
                {(cell) => (
                  <LocaleMatrixCell
                    label={languageName(cell.locale)}
                    secondaryLabel={cell.locale}
                    screenLabel={screen()?.label ?? "Screen"}
                    source={sourceFor(cell.screenId)}
                    verdict={cell.verdict}
                    analysis={analysisFor(cell, review()?.baselineLocale)}
                    onOpen={() => setFocusedLocale(cell.locale)}
                    onCompare={() => setFocusedLocale(cell.locale)}
                    onNaturalSize={adoptCellRatio}
                  />
                )}
              </For>
              <Show when={!screens().length && detail.loading}>
                <For each={Array.from({ length: 4 })}>{() => <LocaleMatrixCellSkeleton />}</For>
              </Show>
            </div>

            <Show when={screens().length > 0 && visibleCells().length === 0}>
              <div class="grid min-h-48 place-items-center text-center">
                <div class="max-w-[42ch]">
                  <strong class="block text-caption text-[var(--text-strong)]">
                    {verdictFilter()
                      ? `Nothing on this screen is ${localeVerdictPresentation(
                          verdictFilter()!,
                        ).label.toLocaleLowerCase()}`
                      : "No matching languages"}
                  </strong>
                  <Button
                    variant="secondary"
                    size="sm"
                    class="mt-3"
                    onClick={() => {
                      setVerdictFilter(null);
                      setLocaleQuery("");
                    }}
                  >
                    Show every language
                  </Button>
                </div>
              </div>
            </Show>
            <Show when={!screens().length && !detail.loading}>
              <EmptyState
                icon="camera"
                title="This sweep has no screenshots yet"
                description="Run it to crawl the app once and replay that tree in every language. Findings appear here as each language lands."
              />
            </Show>
          </div>
        </section>
      </Show>

      <Show when={focusedCell()}>
        {(cell) => (
          <LocaleSweepCompare
            screenLabel={screen()?.label ?? "Screen"}
            baselineLocale={review()?.baselineLocale ?? ""}
            baselineSource={sourceFor(screen()?.baselineScreenId)}
            locale={cell().locale}
            localeLabel={`${languageName(cell().locale)} (${cell().locale})`}
            source={sourceFor(cell().screenId)}
            verdict={cell().verdict}
            findings={cell().findings}
            known={cell().known}
            onMarkKnown={(finding, options) => void accept(finding, options)}
            onRestoreKnown={(finding) => void restore(finding)}
            position={focusedIndex() + 1}
            total={visibleCells().length}
            {...(focusedIndex() > 0 ? { onPrevious: () => moveFocus(-1) } : {})}
            {...(focusedIndex() < visibleCells().length - 1 ? { onNext: () => moveFocus(1) } : {})}
            onClose={() => setFocusedLocale(null)}
          />
        )}
      </Show>
    </div>
  );
}

/**
 * The sweep and screen pickers were bare `<select>`s, so they rendered with the
 * platform's own chevron and control metrics beside Relay's buttons — the one
 * place in the product that looked like a browser form. Resetting the
 * appearance and drawing the chevron matches the filters on the Screens grid,
 * while keeping a real `<select>` and its native keyboard and mobile behaviour.
 */
function SweepSelect(props: {
  label: string;
  value: string;
  class?: string;
  onChange: (value: string) => void;
  children: JSX.Element;
}) {
  return (
    <label class={cn("relative flex items-center", props.class)}>
      <span class="sr-only">{props.label}</span>
      <select
        aria-label={props.label}
        class="h-8 w-full appearance-none rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] pr-7 pl-2.5 text-caption font-medium text-[var(--text-strong)] outline-none transition-colors duration-hover hover:border-[var(--border-base)] focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.children}
      </select>
      <Icon
        name="chevron-down"
        size={11}
        class="pointer-events-none absolute right-2.5 text-[var(--text-weak)]"
      />
    </label>
  );
}

function analysisFor(cell: CorpusReviewCell, baselineLocale: string | undefined) {
  // Only a checked cell gets an analysis object: "not checked" has to stay
  // distinguishable from "checked and clean" all the way to the cell. The
  // baseline is not labelled against itself, because "vs en" on the en cell is
  // a comparison nobody made.
  if (!cell.findings.length && cell.verdict !== "pass" && cell.verdict !== "known") {
    return undefined;
  }
  const compared = baselineLocale && baselineLocale !== cell.locale ? baselineLocale : undefined;
  return { findings: cell.findings, ...(compared ? { baselineLabel: compared } : {}) };
}

function sweepLabel(sweep: CorpusSession): string {
  const languages = sweep.scope.locales.length;
  return `${sweep.name} · ${languages} ${languages === 1 ? "language" : "languages"} · ${sweep.status}`;
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" });
  } catch {
    return null;
  }
})();

/** A tag nobody can read is not a label. "pt-BR" becomes "Brazilian Portuguese"
 * where the platform knows how, and stays itself where it does not. */
function languageName(locale: string): string {
  try {
    return languageNames?.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

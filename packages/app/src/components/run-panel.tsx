import { For, Show, createMemo, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { useServer, type JobInfo, type RecipeInfo, type PersistedRun } from "../context/server";
import { describeStep, useRecorder } from "../context/recorder";
import { Glyphs } from "./glyphs";
import { EmptyState } from "./empty-state";
import { useCommand } from "../context/command";
import { Icon, GLYPH_META } from "./icon";
import { RecipeEditor } from "./recipe-editor";
import { statusTone, fmtDur, fmtAgo, fmtMs, n, titleize } from "../lib/job";

/** Hover tip describing what a step does (its actions + timing). */
function stepTip(step: { title: string; glyphs?: string[]; durationMs?: number }): string {
  const acts = (step.glyphs ?? []).map((g) => GLYPH_META[g]?.label).filter(Boolean);
  const parts = [step.title];
  if (acts.length) parts.push(acts.join(" · "));
  if (step.durationMs) parts.push(fmtMs(step.durationMs));
  return parts.join(" — ");
}

/**
 * The run pane (plan 012) — the primary surface. The header's title is the
 * recipe switcher (a dropdown, like the device picker); below it: run-head ·
 * steps (custom authored steps, builtin planned-step preview, or live trace
 * steps) · recent runs · error box · collapsible console. Reads contexts — no
 * props. The header renders outside the scroll container so the switcher menu
 * does not clip.
 */
export function StepsPane() {
  const server = useServer();
  const cmd = useCommand();
  const [editingRecipe, setEditingRecipe] = createSignal<RecipeInfo | "new" | null>(null);
  const [consoleOpen, setConsoleOpen] = createSignal(false);

  const selectedRecipe = createMemo(() => server.selectedRecipe());
  const selectedMeta = createMemo(() =>
    server.actions().find((a) => a.id === selectedRecipe()?.id),
  );
  const selectedJob = createMemo(
    () => server.jobs().find((j) => j.id === server.selectedJobId()) ?? null,
  );

  const persistedRun = createMemo(() => {
    const id = server.persistedRunId();
    if (!id) return null;
    const live = server.jobs().find((j) => j.id === id);
    if (live) return null;
    return server.persistedRuns().find((r) => r.id === id) ?? null;
  });

  const jobDevice = createMemo(() => {
    const j = selectedJob();
    if (!j?.serial) return undefined;
    return server.devices().find((d) => d.serial === j.serial)?.name ?? j.serial;
  });

  const jobLogs = createMemo(() => {
    const run = persistedRun();
    if (run) return run.logs.join("\n");
    const j = selectedJob();
    if (j?.steps?.length) {
      const step = j.steps[j.steps.length - 1];
      if (step?.log) return step.log;
    }
    if (j?.logs?.length) return j.logs.join("\n");
    const id = server.selectedJobId();
    return server
      .logs()
      .filter((l) => !id || l.jobId === id || !l.jobId)
      .slice(-40)
      .map((l) => l.text)
      .join("\n");
  });

  // Auto-expand the console while a job is running; collapse otherwise.
  createEffect(() => {
    setConsoleOpen(server.running());
  });

  const canRun = () =>
    server.health() === "online" && !server.isEmptyDevices() && Boolean(selectedRecipe());
  const runDisabledReason = () => {
    if (server.health() !== "online") return "Server is offline — start with pnpm dev:serve";
    // No-device case: the device column already says it — one message per fact.
    if (server.isEmptyDevices()) return "";
    if (!selectedRecipe()) return "Select a recipe";
    return "";
  };

  /** Human label for a builtin flow step. Used only as a fallback when a
   *  builtin lacks planned steps (real planned titles come via /actions). */
  function flowLabel(step: RecipeInfo["steps"][number]): string {
    if (step.kind === "flow")
      return `Runs the built-in ${titleize(step.flow, server.recipes())} flow`;
    return describeStep(step);
  }

  const consoleLabel = () => {
    const run = persistedRun();
    if (run) return `Log — ${titleize(run.action, server.recipes())}`;
    const j = selectedJob();
    if (j) return `Log — ${j.title ?? titleize(j.action, server.recipes())}`;
    const r = selectedRecipe();
    if (r) return `Log — ${r.title}`;
    return "Log";
  };

  const hasContent = () => Boolean(selectedRecipe() || persistedRun());

  // ── Recipe switcher (plan 012) — the report header's title is the nav ──
  const rec = useRecorder();
  const [menuOpen, setMenuOpen] = createSignal(false);
  // Delete confirmation: first click arms a 3s "Sure?" state per recipe id.
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null);
  function armDelete(id: string): void {
    if (confirmDeleteId() === id) {
      setConfirmDeleteId(null);
      void server.deleteRecipeRemote(id);
      return;
    }
    setConfirmDeleteId(id);
    const t = setTimeout(() => setConfirmDeleteId((cur) => (cur === id ? null : cur)), 3000);
    onCleanup(() => clearTimeout(t));
  }
  const selectRecipe = (id: string) => {
    server.setSelectedRecipeId(id);
    server.setPersistedRunId(null);
  };
  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".runpane__switcher")) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    onCleanup(() => document.removeEventListener("mousedown", onDoc));
  });

  type SwitcherGroup = { key: string; label: string; items: RecipeInfo[]; custom: boolean };
  const switcherGroups = createMemo<SwitcherGroup[]>(() => {
    const cats = new Map<string, string>();
    for (const a of server.actions()) cats.set(a.id, a.category);
    const custom: RecipeInfo[] = [];
    const playStore: RecipeInfo[] = [];
    const grok: RecipeInfo[] = [];
    for (const r of server.recipes()) {
      if (r.source === "custom") {
        custom.push(r);
        continue;
      }
      const cat = cats.get(r.id) ?? "play-store";
      (cat === "grok" ? grok : playStore).push(r);
    }
    return [
      { key: "play-store", label: "Play Store", items: playStore, custom: false },
      { key: "grok", label: "Grok app", items: grok, custom: false },
      { key: "custom", label: "Custom", items: custom, custom: true },
    ].filter((g) => g.items.length > 0);
  });

  // ── Recent runs (plan 012 step 6) — rehomes the sidebar's History + Queue ──
  type RecentRow =
    | { kind: "live"; id: string; ts: number; job: JobInfo; queuePos?: number }
    | { kind: "disk"; id: string; ts: number; run: PersistedRun };
  const recentRuns = createMemo(() => {
    const r = selectedRecipe();
    if (!r) return { rows: [] as RecentRow[], extra: 0 };
    const jobs = server.jobs();
    const liveIds = new Set(jobs.map((j) => j.id));
    const queued = server.queuedJobs();
    const rows: RecentRow[] = [];
    for (const j of jobs) {
      if (j.action !== r.id) continue;
      rows.push({
        kind: "live",
        id: j.id,
        ts: j.finishedAt ?? j.startedAt ?? j.queuedAt,
        job: j,
        queuePos: j.status === "queued" ? queued.findIndex((q) => q.id === j.id) + 1 : undefined,
      });
    }
    for (const run of server.persistedRuns()) {
      if (run.action !== r.id || liveIds.has(run.id)) continue;
      rows.push({ kind: "disk", id: run.id, ts: run.writtenAt, run });
    }
    rows.sort((a, b) => b.ts - a.ts);
    return { rows: rows.slice(0, 8), extra: Math.max(0, rows.length - 8) };
  });

  return (
    <>
      {/* ── Persisted-run (disk) view — read-only ── */}
      <Show when={persistedRun()}>
        {(run) => (
          <>
            <div class="runpane__head">
              <div class="runpane__head-copy">
                <h2 class="runpane__title">{titleize(run().action, server.recipes())}</h2>
              </div>
              <div class="runpane__head-actions">
                <button
                  type="button"
                  class="btn btn-ghost"
                  onClick={() => server.setPersistedRunId(null)}
                >
                  <Icon name="x" size={13} />
                  Close
                </button>
              </div>
            </div>
            <div class="runpane__scroll">
              <div class="run-head">
                <span
                  class={`run-head__chip tone tone--${statusTone(run().status as JobInfo["status"])}`}
                >
                  {run().healed
                    ? "Healed"
                    : run().status === "ok"
                      ? "Passed"
                      : run().status === "error"
                        ? "Failed"
                        : titleize(run().status)}
                </span>
                <span class="run-head__fact">{new Date(run().writtenAt).toLocaleString()}</span>
                <Show
                  when={fmtMs(run().durationMs)}
                  fallback={
                    <Show when={run().steps.reduce((a, s) => a + (s.durationMs ?? 0), 0) > 0}>
                      <span class="run-head__fact mono">
                        {fmtMs(run().steps.reduce((a, s) => a + (s.durationMs ?? 0), 0))}
                      </span>
                    </Show>
                  }
                >
                  <span class="run-head__fact mono">{fmtMs(run().durationMs)}</span>
                </Show>
                <span class="run-head__fact">{n(run().frames.length, "frame")}</span>
              </div>

              <For each={run().steps}>
                {(step, i) => {
                  const tone =
                    step.status === "ok"
                      ? "pass"
                      : step.status === "healed"
                        ? "heal"
                        : step.status === "error"
                          ? "fail"
                          : step.status === "running"
                            ? "run"
                            : "dim";
                  return (
                    <div class="srow srow--static" title={stepTip(step)}>
                      <span class={`snum snum--${tone}`}>{String(i() + 1).padStart(2, "0")}</span>
                      <span class="srow__body">
                        <Show
                          when={Boolean(
                            (step.kind && step.kind !== "Replay") ||
                            fmtMs(step.durationMs) ||
                            tone === "fail" ||
                            tone === "heal" ||
                            tone === "run" ||
                            (step.glyphs?.length ?? 0) > 0,
                          )}
                        >
                          <span class="smeta">
                            <Show when={step.kind && step.kind !== "Replay"}>
                              <span class="smeta__kind">{step.kind}</span>
                            </Show>
                            <Show when={fmtMs(step.durationMs)}>
                              <span class="mono">{fmtMs(step.durationMs)}</span>
                            </Show>
                            <Show when={tone === "fail" || tone === "heal" || tone === "run"}>
                              <span class={`tone tone--${tone}`}>{step.status}</span>
                            </Show>
                            <Glyphs glyphs={step.glyphs} max={6} />
                          </span>
                        </Show>
                        <span class="stitle">{step.title}</span>
                      </span>
                    </div>
                  );
                }}
              </For>
            </div>
          </>
        )}
      </Show>

      {/* ── Recipe view: switcher in the header, body below ── */}
      <Show when={!persistedRun()}>
        <div class="runpane__head">
          <div class="runpane__head-copy">
            <div
              class="pick-wrap runpane__switcher"
              onKeyDown={(e) => {
                if (e.key === "Escape" && menuOpen()) {
                  e.stopPropagation();
                  setMenuOpen(false);
                }
              }}
            >
              <button
                type="button"
                class="runpane__title-btn"
                aria-haspopup="listbox"
                aria-expanded={menuOpen()}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <span>{selectedRecipe()?.title ?? "Pick a recipe"}</span>
                <span class="runpane__title-chev" aria-hidden="true">
                  <Icon name="chevron-down" size={16} />
                </span>
              </button>
              <Show when={menuOpen()}>
                <div class="pick-menu" role="listbox">
                  <For each={switcherGroups()}>
                    {(g) => (
                      <div class="pick-group">
                        <div class="pick-group__label">{g.label}</div>
                        <For each={g.items}>
                          {(r) => (
                            <div class="pick-row">
                              <button
                                type="button"
                                role="option"
                                class="pick-item"
                                classList={{ on: server.selectedRecipeId() === r.id }}
                                onClick={() => {
                                  selectRecipe(r.id);
                                  setMenuOpen(false);
                                }}
                              >
                                <span class="pick-item__title">{r.title}</span>
                              </button>
                              <Show when={g.custom}>
                                <button
                                  type="button"
                                  class="pick-row__action"
                                  title="Edit recipe"
                                  aria-label={`Edit ${r.title}`}
                                  onClick={() => {
                                    setEditingRecipe(r);
                                    setMenuOpen(false);
                                  }}
                                >
                                  <Icon name="sliders" size={12} />
                                </button>
                                <button
                                  type="button"
                                  class="pick-row__action pick-row__action--del"
                                  title={
                                    confirmDeleteId() === r.id
                                      ? "Click again to confirm"
                                      : "Delete recipe"
                                  }
                                  aria-label={`Delete ${r.title}`}
                                  onClick={() => armDelete(r.id)}
                                >
                                  <Show
                                    when={confirmDeleteId() !== r.id}
                                    fallback={<span class="pick-row__sure">Sure?</span>}
                                  >
                                    <Icon name="trash" size={12} />
                                  </Show>
                                </button>
                              </Show>
                              <Show when={!g.custom}>
                                <button
                                  type="button"
                                  class="pick-row__action"
                                  title="Fork to custom recipe"
                                  aria-label={`Fork ${r.title}`}
                                  onClick={() => {
                                    void rec.forkRecipe(r);
                                    setMenuOpen(false);
                                  }}
                                >
                                  <Icon name="external" size={12} />
                                </button>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                  <button
                    type="button"
                    class="pick-item pick-item--action"
                    onClick={() => {
                      setEditingRecipe("new");
                      setMenuOpen(false);
                    }}
                  >
                    New recipe
                  </button>
                </div>
              </Show>
            </div>
            <Show when={selectedRecipe()?.description}>
              <p class="runpane__desc">{selectedRecipe()!.description}</p>
            </Show>
          </div>
          <div class="runpane__head-actions">
            <Show when={selectedRecipe()?.source === "custom"}>
              <button
                type="button"
                class="btn btn-ghost"
                title="Edit recipe"
                onClick={() => setEditingRecipe(selectedRecipe()!)}
              >
                <Icon name="sliders" size={13} />
                Edit
              </button>
            </Show>
            <Show when={selectedJob()?.status === "error"}>
              <button
                type="button"
                class="btn btn-ghost"
                title="Retry / heal job"
                onClick={() => void server.retrySelectedJob(selectedJob()!.id)}
              >
                <Icon name="refresh" size={13} />
                Retry
              </button>
            </Show>
            <Show when={selectedRecipe()}>
              <button
                type="button"
                class="btn btn-acc"
                disabled={!canRun()}
                title={!canRun() && server.isEmptyDevices() ? "No device connected" : undefined}
                onClick={() => {
                  const r = server.selectedRecipe();
                  if (r) void server.runRecipeRemote(r.id);
                }}
              >
                <Show when={server.activeJob()} fallback={<Icon name="play" size={13} />}>
                  <Icon name="plus" size={13} />
                </Show>
                {server.activeJob() ? "Queue" : "Run"}
              </button>
            </Show>
          </div>
        </div>

        <div class="runpane__scroll">
          {/* Disabled-run reason as visible caption */}
          <Show when={selectedRecipe() && !canRun() && runDisabledReason()}>
            <p class="runpane__run-reason">{runDisabledReason()}</p>
          </Show>

          {/* Prod-account-match notice */}
          <Show when={selectedMeta()?.requiresProdMatch && !server.prodAccountMatch()}>
            <div class="panel__recipe-notice">
              <span class="panel__recipe-notice-icon" aria-hidden="true">
                <Icon name="alert" size={14} />
              </span>
              <span class="panel__recipe-notice-text">
                Needs a prod account match (e.g. gmail.com).
              </span>
              <button type="button" class="btn btn-ghost" onClick={() => cmd.run("nav.settings")}>
                Configure
              </button>
            </div>
          </Show>

          {/* Empty state: no recipe selected */}
          <Show when={!selectedRecipe()}>
            <div class="runpane__empty">
              <EmptyState
                size="md"
                icon="run"
                title="Pick a recipe"
                description="Choose a recipe to see its steps and run it."
                actionLabel="Browse recipes"
                onAction={() => setMenuOpen(true)}
              />
            </div>
          </Show>

          {/* Selected-recipe body */}
          <Show when={selectedRecipe()}>
            {/* Run header when a job exists */}
            <Show when={selectedJob()}>
              {(j) => (
                <div class="run-head">
                  <span class={`run-head__chip tone tone--${statusTone(j().status)}`}>
                    <Show when={j().status === "running" || j().status === "queued"}>
                      <span class="run-head__spinner" aria-hidden="true" />
                    </Show>
                    {j().status === "ok"
                      ? "Passed"
                      : j().status === "error"
                        ? "Failed"
                        : j().status === "healed"
                          ? "Healed"
                          : j().status === "cancelled"
                            ? "Cancelled"
                            : j().status === "paused"
                              ? "Paused"
                              : "Running"}
                  </span>
                  <Show when={j().startedAt}>
                    <span class="run-head__fact">{new Date(j().startedAt!).toLocaleString()}</span>
                  </Show>
                  <span class="run-head__fact mono">{fmtDur(j(), server.clock())}</span>
                  <Show when={jobDevice()}>
                    <span class="run-head__fact">{jobDevice()}</span>
                  </Show>
                </div>
              )}
            </Show>

            {/* Live job steps */}
            <Show when={(selectedJob()?.steps?.length ?? 0) > 0}>
              <For each={selectedJob()!.steps ?? []}>
                {(step, i) => {
                  const tone =
                    step.status === "ok"
                      ? "pass"
                      : step.status === "healed"
                        ? "heal"
                        : step.status === "error"
                          ? "fail"
                          : step.status === "running"
                            ? "run"
                            : "dim";
                  return (
                    <div
                      class="srow srow--static"
                      classList={{ on: i() === (selectedJob()!.steps?.length ?? 1) - 1 }}
                      title={stepTip(step)}
                    >
                      <span class={`snum snum--${tone}`}>{String(i() + 1).padStart(2, "0")}</span>
                      <span class="srow__body">
                        <span class="stitle">{step.title}</span>
                        <Show
                          when={Boolean(
                            (step.kind && step.kind !== "Replay") ||
                            fmtMs(step.durationMs) ||
                            tone === "fail" ||
                            tone === "heal" ||
                            tone === "run" ||
                            (step.glyphs?.length ?? 0) > 0,
                          )}
                        >
                          <span class="smeta">
                            <Show when={step.kind && step.kind !== "Replay"}>
                              <span class="smeta__kind">{step.kind}</span>
                            </Show>
                            <Show when={fmtMs(step.durationMs)}>
                              <span class="mono">{fmtMs(step.durationMs)}</span>
                            </Show>
                            <Show when={tone === "fail" || tone === "heal" || tone === "run"}>
                              <span class={`tone tone--${tone}`}>{step.status}</span>
                            </Show>
                            <Glyphs glyphs={step.glyphs} max={6} />
                          </span>
                        </Show>
                      </span>
                    </div>
                  );
                }}
              </For>
            </Show>

            {/* Custom recipe step preview (before first run) */}
            <Show
              when={
                !selectedJob() &&
                selectedRecipe()?.source === "custom" &&
                (selectedRecipe()?.steps.length ?? 0) > 0
              }
            >
              <For each={selectedRecipe()!.steps}>
                {(step, i) => (
                  <button
                    type="button"
                    class="srow srow--static srow--clickable"
                    title="Click to edit this step"
                    onClick={() => setEditingRecipe(selectedRecipe()!)}
                  >
                    <span class="snum snum--dim">{String(i() + 1).padStart(2, "0")}</span>
                    <span class="srow__body">
                      <span class="stitle">{describeStep(step)}</span>
                      <span class="smeta">
                        <span class="smeta__kind">{step.kind}</span>
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </Show>

            {/* Builtin recipe step preview (before first run). Real planned
                steps come from RECIPE_TRACE_PLANS via /actions; flowLabel is
                the fallback when planned titles are absent. */}
            <Show when={!selectedJob() && selectedRecipe()?.source === "builtin"}>
              <Show
                when={selectedMeta()?.planned?.length}
                fallback={
                  <For each={selectedRecipe()!.steps}>
                    {(step, i) => (
                      <div class="srow srow--static" title={flowLabel(step)}>
                        <span class="snum snum--dim">{String(i() + 1).padStart(2, "0")}</span>
                        <span class="srow__body">
                          <span class="stitle">{flowLabel(step)}</span>
                          <span class="smeta">
                            <span class="smeta__kind">{step.kind}</span>
                          </span>
                        </span>
                      </div>
                    )}
                  </For>
                }
              >
                <For each={selectedMeta()!.planned!}>
                  {(step, i) => (
                    <button
                      type="button"
                      class="srow srow--static srow--clickable"
                      title="Click to fork and edit this recipe"
                      onClick={() => {
                        const r = selectedRecipe();
                        if (r) void rec.forkRecipe(r);
                      }}
                    >
                      <span class="snum snum--dim">{String(i() + 1).padStart(2, "0")}</span>
                      <span class="srow__body">
                        <span class="stitle">{step.title}</span>
                        <Show when={(step.glyphs?.length ?? 0) > 0}>
                          <span class="smeta">
                            <Glyphs glyphs={step.glyphs} max={6} />
                          </span>
                        </Show>
                      </span>
                    </button>
                  )}
                </For>
              </Show>
            </Show>

            {/* Error box */}
            <Show when={selectedJob()?.error}>
              <div class="heal-box heal-box--fail heal-box--spaced" role="alert">
                <span class="heal-box__icon" aria-hidden="true">
                  <Icon name="alert" size={12} />
                </span>
                <span>{selectedJob()!.error}</span>
              </div>
            </Show>
            {/* Recent runs — rehomes the sidebar's History + Queue (plan 012 step 6) */}
            <Show when={recentRuns().rows.length > 0}>
              <div class="recent">
                <div class="recent__label">Recent runs</div>
                <For each={recentRuns().rows}>
                  {(row) => {
                    const status: JobInfo["status"] =
                      row.kind === "live" ? row.job.status : (row.run.status as JobInfo["status"]);
                    const tone = statusTone(status);
                    const isQueued = status === "queued";
                    const isDone =
                      status === "ok" ||
                      status === "error" ||
                      status === "healed" ||
                      status === "cancelled";
                    const isActive = status === "running" || status === "paused";
                    const isErr = status === "error";
                    const queuePos =
                      row.kind === "live" && row.job.status === "queued" ? row.queuePos : undefined;
                    const jobId = row.kind === "live" ? row.job.id : null;
                    const selected =
                      row.kind === "live"
                        ? server.selectedJobId() === row.id
                        : server.persistedRunId() === row.id;
                    const statusWord =
                      status === "ok" ? "Passed" : status === "error" ? "Failed" : titleize(status);
                    const timeText =
                      row.kind === "disk"
                        ? fmtAgo(row.run.writtenAt, server.clock())
                        : isQueued
                          ? ""
                          : isDone
                            ? fmtAgo(row.job.finishedAt, server.clock())
                            : fmtDur(row.job, server.clock());
                    const durText =
                      row.kind === "disk"
                        ? fmtMs(row.run.durationMs)
                        : isDone
                          ? fmtDur(row.job, server.clock())
                          : "";
                    return (
                      <div class="nav-row-wrap">
                        <button
                          type="button"
                          class="rrow"
                          classList={{
                            on: selected,
                            "rrow--active": row.kind === "live" && isActive,
                          }}
                          title={
                            row.kind === "live"
                              ? (row.job.title ?? titleize(row.job.action, server.recipes()))
                              : `Disk run · ${row.run.dir}`
                          }
                          onClick={() => {
                            if (row.kind === "live") {
                              server.jumpToJob(row.id);
                              server.setPersistedRunId(null);
                            } else {
                              server.setSelectedJobId(null);
                              server.setPersistedRunId(row.id);
                            }
                          }}
                        >
                          <span class={`nav-row__dot nav-row__dot--${tone}`} aria-hidden="true" />
                          <span class="rrow__facts">
                            <Show when={isQueued && queuePos}>
                              <span class="rrow__pos mono">{queuePos}</span>
                            </Show>
                            <span class={`rrow__fact rrow__word rrow__word--${tone}`}>
                              {statusWord}
                            </span>
                            <Show when={timeText}>
                              <span class="rrow__fact rrow__time">{timeText}</span>
                            </Show>
                            <Show when={durText}>
                              <span class="rrow__fact rrow__dur mono">{durText}</span>
                            </Show>
                          </span>
                        </button>
                        <span class="nav-row__actions">
                          <Show when={row.kind === "live" && isQueued && jobId}>
                            <button
                              type="button"
                              class="nav-row__action"
                              aria-label="Remove from queue"
                              title="Remove from queue"
                              onClick={() => jobId && void server.cancelJob(jobId)}
                            >
                              <Icon name="x" size={11} />
                            </button>
                          </Show>
                          <Show when={row.kind === "live" && isErr && jobId}>
                            <button
                              type="button"
                              class="nav-row__action"
                              aria-label="Retry job"
                              title="Retry / heal job"
                              onClick={() => jobId && void server.retrySelectedJob(jobId)}
                            >
                              <Icon name="refresh" size={11} />
                            </button>
                          </Show>
                        </span>
                      </div>
                    );
                  }}
                </For>
                <Show when={recentRuns().extra > 0}>
                  <p class="recent__more">and {recentRuns().extra} more on disk</p>
                </Show>
              </div>
            </Show>
          </Show>
        </div>
      </Show>

      {/* ── Collapsible console ── */}
      <Show when={hasContent()}>
        <div class="console" classList={{ "console--open": consoleOpen() }}>
          <button
            type="button"
            class="console__head"
            aria-expanded={consoleOpen()}
            aria-label={consoleOpen() ? "Collapse console" : "Expand console"}
            onClick={() => setConsoleOpen((o) => !o)}
          >
            <Icon
              name={consoleOpen() ? "chevron-down" : "chevron-right"}
              size={12}
              class="console__chev"
            />
            <span class="console__label">{consoleLabel()}</span>
          </button>
          <Show when={consoleOpen()}>
            <pre>{jobLogs() || "— live logs stream here via SSE —"}</pre>
          </Show>
        </div>
      </Show>

      <Show when={editingRecipe()}>
        {(() => {
          const er = editingRecipe();
          return (
            <RecipeEditor
              recipe={er === "new" ? null : er}
              onClose={() => setEditingRecipe(null)}
            />
          );
        })()}
      </Show>
    </>
  );
}

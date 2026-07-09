import { For, Show, createMemo, createSignal, onMount, onCleanup } from "solid-js";
import { useServer, type RecipeInfo, type JobInfo } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useWorkbench, type RunChip } from "../context/workbench";
import { useRecorder } from "../context/recorder";
import { EmptyState } from "./empty-state";
import { useCommand } from "../context/command";
import { Icon } from "./icon";
import { RecipeStepsEditor } from "./step-list";
import { statusTone, fmtDur, fmtAgo, fmtMs, titleize, displayTitle } from "../lib/job";

/**
 * The run pane — one step list that gets annotated. The header's title is
 * both the test switcher (chevron) and, for custom tests, an inline-editable
 * name. Below it: a compact run-history strip (chips), then THE step list —
 * the same rows whether you're building, stepping through, watching a live
 * job, or reviewing a past run. Reads contexts — no props.
 */
export function StepsPane() {
  const server = useServer();
  const cmd = useCommand();
  const draft = useRecipeDraft();
  const wb = useWorkbench();
  const rec = useRecorder();

  const selectedRecipe = createMemo(() => server.selectedRecipe());
  const isCustomSelected = () => selectedRecipe()?.source === "custom";
  const selectedMeta = createMemo(() =>
    server.actions().find((a) => a.id === selectedRecipe()?.id),
  );

  const canRun = () =>
    server.health() === "online" && !server.isEmptyDevices() && Boolean(selectedRecipe());
  const runDisabledReason = () => {
    if (server.health() !== "online") return "Server is offline — start with pnpm dev:serve";
    if (server.isEmptyDevices())
      return "No device connected — connect one over USB or Wi-Fi, then refresh";
    if (!selectedRecipe()) return "Select a test";
    return "";
  };

  // ── Test switcher ────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = createSignal(false);
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

  // ── Header title / description inline-edit (custom tests only) ───────
  const [titleEditing, setTitleEditing] = createSignal(false);
  const [titleBuf, setTitleBuf] = createSignal("");
  const [descEditing, setDescEditing] = createSignal(false);
  const [descBuf, setDescBuf] = createSignal("");

  function startTitleEdit(): void {
    if (!selectedRecipe()) return;
    setTitleBuf(draft.title());
    setTitleEditing(true);
  }
  function commitTitle(): void {
    if (!titleEditing()) return;
    setTitleEditing(false);
    draft.setTitle(titleBuf().trim() || "Untitled test");
  }
  function startDescEdit(): void {
    if (!selectedRecipe()) return;
    setDescBuf(draft.description());
    setDescEditing(true);
  }
  function commitDesc(): void {
    if (!descEditing()) return;
    setDescEditing(false);
    draft.setDescription(descBuf().trim());
  }

  async function createNewTest(): Promise<void> {
    const saved = await server.saveRecipeRemote({ title: "Untitled test", steps: [] });
    if (!saved) return;
    server.setSelectedRecipeId(saved.id);
    startTitleEdit();
  }

  const saveStatusLabel = () => {
    const st = draft.saveState();
    if (st === "invalid") {
      const count = draft.invalidCount();
      return `Fix ${count} step${count === 1 ? "" : "s"} to save`;
    }
    if (st === "saving") return "Saving…";
    return "Saved";
  };

  // ── Run summary + raw log (for the selected/live run) ────────────────
  const [logOpen, setLogOpen] = createSignal(false);

  const reviewedFacts = createMemo(() => {
    const c = wb.reviewedRun();
    if (!c) return null;
    const status: JobInfo["status"] =
      c.kind === "live" ? c.job.status : (c.run.status as JobInfo["status"]);
    const tone = statusTone(status);
    const live = c.kind === "live" && (status === "running" || status === "paused");
    const word =
      status === "ok"
        ? "Passed"
        : status === "error"
          ? "Failed"
          : status === "healed"
            ? "Healed"
            : titleize(status);
    const serial = c.kind === "live" ? c.job.serial : c.run.serial;
    const device = serial
      ? (server.devices().find((d) => d.serial === serial)?.name ?? serial)
      : "";
    const when =
      c.kind === "disk"
        ? fmtAgo(c.run.writtenAt, server.clock())
        : live
          ? ""
          : fmtAgo(c.job.finishedAt, server.clock());
    const dur = c.kind === "disk" ? fmtMs(c.run.durationMs) : fmtDur(c.job, server.clock());
    return { tone, word, when, dur, device, live };
  });

  const rawLog = () => {
    const c = wb.reviewedRun();
    if (!c) return "";
    if (c.kind === "disk") return c.run.logs.join("\n");
    if (c.job.logs?.length) return c.job.logs.join("\n");
    return server
      .logs()
      .filter((l) => l.jobId === c.job.id)
      .map((l) => l.text)
      .join("\n");
  };

  /** Retry surfaces only for a reviewed failed job (live kind). */
  const retryableJobId = () => {
    const c = wb.reviewedRun();
    return c && c.kind === "live" && c.job.status === "error" ? c.job.id : null;
  };

  function chipFacts(c: RunChip): { tone: string; label: string; live: boolean; tip: string } {
    const status: JobInfo["status"] =
      c.kind === "live" ? c.job.status : (c.run.status as JobInfo["status"]);
    const tone = statusTone(status);
    const live =
      c.kind === "live" && (status === "running" || status === "paused" || status === "queued");
    const label =
      live && c.kind === "live"
        ? status === "queued"
          ? "queued"
          : fmtDur(c.job, server.clock())
        : fmtAgo(c.ts, server.clock()) || "now";
    const word = status === "ok" ? "Passed" : status === "error" ? "Failed" : titleize(status);
    const tip = `${word} · ${new Date(c.ts).toLocaleString()}`;
    return { tone, label, live, tip };
  }

  /** The switcher + (for custom tests) inline-editable title/description. */
  function SwitcherHeader() {
    return (
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
          <div class="runpane__title-row">
            <Show
              when={selectedRecipe() && titleEditing()}
              fallback={
                <button
                  type="button"
                  class="runpane__title-text"
                  classList={{
                    "runpane__title-text--editable": Boolean(selectedRecipe()),
                    "runpane__title-text--dim": Boolean(selectedRecipe()) && !draft.title().trim(),
                  }}
                  onClick={() => (selectedRecipe() ? startTitleEdit() : setMenuOpen((o) => !o))}
                >
                  {selectedRecipe() ? displayTitle(draft.title()) : "Pick a test"}
                </button>
              }
            >
              <input
                class="runpane__title-input"
                value={titleBuf()}
                ref={(el) =>
                  queueMicrotask(() => {
                    el.focus();
                    el.select();
                  })
                }
                onInput={(e) => setTitleBuf(e.currentTarget.value)}
                onBlur={() => commitTitle()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTitle();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setTitleEditing(false);
                  }
                }}
                spellcheck={false}
              />
            </Show>
            <button
              type="button"
              class="runpane__title-chev"
              aria-haspopup="listbox"
              aria-label="Switch test"
              data-tip="Switch test"
              aria-expanded={menuOpen()}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Icon name="chevron-down" size={16} />
            </button>
          </div>
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
                              server.setSelectedRecipeId(r.id);
                              setMenuOpen(false);
                            }}
                          >
                            <span
                              class="pick-item__title"
                              classList={{ "pick-item__title--dim": !r.title.trim() }}
                            >
                              {displayTitle(r.title)}
                            </span>
                          </button>
                          <Show when={g.custom}>
                            <button
                              type="button"
                              class="pick-row__action pick-row__action--del"
                              title={
                                confirmDeleteId() === r.id
                                  ? "Click again to confirm"
                                  : "Delete test"
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
                  setMenuOpen(false);
                  void createNewTest();
                }}
              >
                <Icon name="plus" size={12} />
                New test
              </button>
            </div>
          </Show>
        </div>

        <Show when={selectedRecipe()}>
          <div class="runpane__desc-row">
            <Show
              when={descEditing()}
              fallback={
                <button
                  type="button"
                  class="runpane__desc runpane__desc--editable"
                  onClick={() => startDescEdit()}
                >
                  {draft.description() || "Add a description…"}
                </button>
              }
            >
              <input
                class="runpane__desc-input"
                value={descBuf()}
                ref={(el) => queueMicrotask(() => el.focus())}
                placeholder="Description (optional)…"
                onInput={(e) => setDescBuf(e.currentTarget.value)}
                onBlur={() => commitDesc()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitDesc();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setDescEditing(false);
                  }
                }}
                spellcheck={false}
              />
            </Show>
            <Show when={draft.source() === "custom"}>
              <span
                class="runpane__save-state"
                classList={{ "runpane__save-state--invalid": draft.saveState() === "invalid" }}
              >
                {saveStatusLabel()}
              </span>
            </Show>
          </div>
        </Show>
      </div>
    );
  }

  return (
    <>
      <div class="runpane__head">
        <SwitcherHeader />
        <div class="runpane__head-actions">
          <Show when={selectedRecipe()}>
            <button
              type="button"
              class="autoc"
              classList={{ "autoc--on": wb.autoContinue() }}
              role="switch"
              aria-checked={wb.autoContinue()}
              data-tip="After a row ▶, keep running the following steps — stops on failure"
              onClick={() => wb.setAutoContinue(!wb.autoContinue())}
            >
              <span class="autoc__track" aria-hidden="true">
                <span class="autoc__thumb" />
              </span>
              Auto-continue
            </button>
          </Show>
          <Show when={wb.running()}>
            <button
              type="button"
              class="btn btn-ghost"
              aria-label="Stop stepping"
              onClick={() => wb.stop()}
            >
              <Icon name="square" size={11} />
              Stop
            </button>
          </Show>
          <button type="button" class="btn btn-ghost" onClick={() => void createNewTest()}>
            <Icon name="plus" size={13} />
            New test
          </button>
          <Show when={retryableJobId()}>
            <button
              type="button"
              class="btn btn-ghost"
              data-tip="Retry / heal this run"
              onClick={() => void server.retrySelectedJob(retryableJobId()!)}
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
              data-tip={
                canRun()
                  ? "Full recorded run — history, frames, healing"
                  : runDisabledReason() || undefined
              }
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
        {/* ── History strip — runs as chips; click to review, click again for idle ── */}
        <Show when={wb.chips().length > 0}>
          <div class="histrip" role="group" aria-label="Run history">
            <For each={wb.chips()}>
              {(c) => {
                const f = () => chipFacts(c);
                return (
                  <button
                    type="button"
                    class="hchip"
                    classList={{
                      "hchip--on": wb.reviewedRun()?.id === c.id,
                      "hchip--live": f().live,
                    }}
                    data-tip={f().tip}
                    aria-label={f().tip}
                    onClick={() => wb.toggleChip(c.id)}
                  >
                    <span class={`hchip__dot hchip__dot--${f().tone}`} aria-hidden="true" />
                    <span class="hchip__label mono">{f().label}</span>
                  </button>
                );
              }}
            </For>
            <Show when={wb.reviewedRun()}>
              <button type="button" class="histrip__log" onClick={() => setLogOpen(true)}>
                Raw log
              </button>
            </Show>
          </div>
        </Show>

        {/* ── Reviewed-run summary: one quiet line, no card ── */}
        <Show when={reviewedFacts()}>
          {(f) => (
            <div class="runsum">
              <span class={`runsum__word runsum__word--${f().tone}`}>
                <Show when={f().live}>
                  <span class="runsum__spin" aria-hidden="true" />
                </Show>
                {f().word}
              </span>
              <Show when={f().when}>
                <span class="runsum__fact">{f().when}</span>
              </Show>
              <Show when={f().dur}>
                <span class="runsum__fact mono">{f().dur}</span>
              </Show>
              <Show when={f().device}>
                <span class="runsum__fact">{f().device}</span>
              </Show>
            </div>
          )}
        </Show>

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

        {/* Empty state: no test selected */}
        <Show when={!selectedRecipe()}>
          <div class="runpane__empty">
            <EmptyState
              size="md"
              icon="run"
              title="Build your first test"
              description="Record yourself using the app on the device, or add steps by hand — both land in the same editable test."
              actionLabel="New test"
              onAction={() => void createNewTest()}
            >
              <button
                type="button"
                class="btn btn-ghost"
                disabled={server.isEmptyDevices()}
                data-tip={server.isEmptyDevices() ? "No device connected" : undefined}
                onClick={() => rec.enterRecordMode()}
              >
                <Icon name="scan" size={13} />
                Record from device
              </button>
            </EmptyState>
          </div>
        </Show>

        {/* ── THE step list — every test, annotated in place. Builtins are
            just steps too; the first edit silently forks them. ── */}
        <Show when={selectedRecipe()}>
          <RecipeStepsEditor />
        </Show>
      </div>

      {/* ── Raw log overlay — the only place the full log lives ── */}
      <Show when={logOpen()}>
        <RawLogOverlay text={rawLog()} onClose={() => setLogOpen(false)} />
      </Show>
    </>
  );
}

/** Lightweight raw-log viewer: mono, scrollable, copy button. */
function RawLogOverlay(props: { text: string; onClose: () => void }) {
  const cmd = useCommand();
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onMount(() => {
    onCleanup(cmd.pushModal());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(copiedTimer);
    });
  });
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div
      class="logpop-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="logpop" role="dialog" aria-label="Raw log">
        <div class="logpop__head">
          <span class="logpop__title">Raw log</span>
          <button type="button" class="btn btn-ghost logpop__copy" onClick={() => void copy()}>
            <Icon name={copied() ? "check" : "copy"} size={12} />
            {copied() ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            class="logpop__close"
            aria-label="Close"
            onClick={() => props.onClose()}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <pre class="logpop__body mono">{props.text || "— no log lines —"}</pre>
      </div>
    </div>
  );
}

import { For, Show, createMemo, createSignal, onMount, onCleanup } from "solid-js";
import { useServer, type JobInfo, type RecipeInfo } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useWorkbench, type RunChip } from "../context/workbench";
import { useCommand } from "../context/command";
import { Icon } from "./icon";
import { RecipeStepsEditor, StepAnno } from "./step-list";
import { statusTone, fmtDur, fmtAgo, fmtMs, titleize, displayTitle } from "../lib/job";
import {
  canRunRecipe,
  isPackagedFlowSteps,
  resolvePlannedTitles,
  runBlocker as runBlockerOf,
} from "../lib/run-gates";
import { cn } from "../lib/cn";

function toneText(tone: string): string {
  if (tone === "pass") return "text-pass";
  if (tone === "fail") return "text-fail";
  if (tone === "heal") return "text-heal";
  if (tone === "run") return "text-run";
  return "text-text-muted";
}

function toneDot(tone: string): string {
  if (tone === "pass") return "bg-pass";
  if (tone === "fail") return "bg-fail";
  if (tone === "heal") return "bg-heal";
  if (tone === "run") return "bg-run";
  return "bg-text-faint";
}

/**
 * Steps pane — the selected test's living document.
 * Switch tests from the title chevron (no permanent library rail).
 */
export function StepsPane() {
  const server = useServer();
  const cmd = useCommand();
  const draft = useRecipeDraft();
  const wb = useWorkbench();

  const selectedRecipe = createMemo(() => server.selectedRecipe());
  const selectedMeta = createMemo(() =>
    server.actions().find((a) => a.id === selectedRecipe()?.id),
  );

  // ── Test switcher (replaces the left rail) ───────────────────────────
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [historyOpen, setHistoryOpen] = createSignal(false);

  type SwitcherGroup = { key: string; label: string; items: RecipeInfo[]; custom: boolean };
  const switcherGroups = createMemo<SwitcherGroup[]>(() => {
    const cats = new Map<string, string>();
    for (const a of server.actions()) cats.set(a.id, a.category);
    const named: RecipeInfo[] = [];
    const untitled: RecipeInfo[] = [];
    const playStore: RecipeInfo[] = [];
    const grok: RecipeInfo[] = [];
    for (const r of server.recipes()) {
      if (r.source === "custom") {
        if (r.title.startsWith("Untitled") && (r.steps?.length ?? 0) === 0) untitled.push(r);
        else named.push(r);
        continue;
      }
      const cat = cats.get(r.id) ?? "play-store";
      (cat === "grok" ? grok : playStore).push(r);
    }
    // Named customs first (by updatedAt desc), library, then empty untitled last.
    named.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return [
      { key: "custom", label: "Yours", items: named, custom: true },
      { key: "play-store", label: "Play Store", items: playStore, custom: false },
      { key: "grok", label: "Grok", items: grok, custom: false },
      { key: "drafts", label: "Drafts", items: untitled, custom: true },
    ].filter((g) => g.items.length > 0);
  });

  /**
   * Human step list for packaged flows (builtin OR forked thin flow wrapper).
   * Never show a single “flow” row when we know the real plan titles.
   */
  const plannedSteps = createMemo(() =>
    resolvePlannedTitles({
      source: draft.source(),
      recipeId: server.selectedRecipeId(),
      steps: draft.steps(),
      actions: server.actions(),
    }),
  );
  const showPackagedPlan = () => plannedSteps().length > 0;
  /** Free-form editor only when the user is truly authoring steps. */
  const showStepEditor = () => {
    if (draft.source() === "builtin") return plannedSteps().length === 0;
    // Forked packaged flow: show the plan, not the opaque flow dropdown.
    if (isPackagedFlowSteps(draft.steps()) && plannedSteps().length > 0) return false;
    return true;
  };

  const gate = () => ({
    hasRecipe: Boolean(selectedRecipe()),
    health: server.health(),
    emptyDevices: server.isEmptyDevices(),
    source: draft.source(),
    stepCount: draft.steps().length,
    saveState: draft.saveState(),
    plannedCount: plannedSteps().length,
  });
  const canRun = () => canRunRecipe(gate());
  /** Why Run is blocked — short, for the button area (not a lecture). */
  const runBlocker = () => runBlockerOf(gate());
  const runTip = () => {
    if (!selectedRecipe()) return undefined;
    if (canRun()) return "Run (⌘↵)";
    return runBlocker() || undefined;
  };

  // ── Title / description inline-edit ──────────────────────────────────
  const [titleEditing, setTitleEditing] = createSignal(false);
  const [titleBuf, setTitleBuf] = createSignal("");

  function startTitleEdit(): void {
    if (!selectedRecipe() || draft.source() !== "custom") return;
    setTitleBuf(draft.title());
    setTitleEditing(true);
  }
  function commitTitle(): void {
    if (!titleEditing()) return;
    setTitleEditing(false);
    draft.setTitle(titleBuf().trim() || "Untitled test");
  }

  async function createNewTest(): Promise<void> {
    // Reuse an empty untitled if one is already selected (avoid spam).
    const cur = selectedRecipe();
    if (
      cur?.source === "custom" &&
      cur.title === "Untitled test" &&
      (cur.steps?.length ?? 0) === 0
    ) {
      setTitleBuf("Untitled test");
      setTitleEditing(true);
      return;
    }
    const n =
      server.recipes().filter((r) => r.source === "custom" && r.title.startsWith("Untitled"))
        .length + 1;
    const title = n <= 1 ? "Untitled test" : `Untitled test ${n}`;
    const saved = await server.saveRecipeRemote({ title, steps: [] });
    if (!saved) return;
    server.setSelectedRecipeId(saved.id);
  }

  // Do NOT auto-enter rename on create — keeps the switcher usable (SpaceX: never
  // steal a control's mode without the user asking).

  const stepCount = () => draft.steps().length;
  /**
   * Always show a status strip under the title (Uber shows Passed · date · duration).
   * Never invent fake Library jargon.
   */
  const metaLine = () => {
    if (!selectedRecipe()) return "";
    if (draft.saveState() === "invalid" && draft.expandedStep() == null) return "Incomplete steps";
    if (draft.saveState() === "saving") return "Saving…";
    const reviewed = reviewedFacts();
    if (reviewed) {
      const bits = [reviewed.word];
      if (reviewed.when) bits.push(reviewed.when);
      if (reviewed.dur) bits.push(reviewed.dur);
      return bits.join(" · ");
    }
    const planned = plannedSteps().length;
    const n = planned > 0 ? planned : draft.steps().length;
    if (n === 0) return "Draft · not run";
    return `${n} step${n === 1 ? "" : "s"} · not run`;
  };
  const metaTone = () => {
    const r = reviewedFacts();
    if (!r) return "";
    return r.tone;
  };
  /** Only teach blockers that aren't already obvious from the stage (no device). */
  const showRunWhy = () => {
    if (!selectedRecipe() || canRun()) return false;
    const why = runBlocker();
    if (!why) return false;
    // Device seat already says "No device" — don't repeat under Run.
    if (why === "Connect a device" || why === "Server offline") return false;
    return true;
  };

  // ── Run summary + raw log ───────────────────────────────────────────
  const [logOpen, setLogOpen] = createSignal(false);

  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.("[data-switcher]")) setMenuOpen(false);
      if (!t?.closest?.("[data-runhist]")) setHistoryOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuOpen()) {
        e.stopPropagation();
        setMenuOpen(false);
      }
      if (historyOpen()) {
        e.stopPropagation();
        setHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    });
  });

  function chipFacts(c: RunChip): {
    tone: string;
    label: string;
    detail: string;
    live: boolean;
    tip: string;
    word: string;
  } {
    const status: JobInfo["status"] =
      c.kind === "live" ? c.job.status : (c.run.status as JobInfo["status"]);
    const tone = statusTone(status);
    const live =
      c.kind === "live" && (status === "running" || status === "paused" || status === "queued");
    const word =
      status === "ok"
        ? "Passed"
        : status === "error"
          ? "Failed"
          : status === "healed"
            ? "Healed"
            : status === "queued"
              ? "Queued"
              : status === "running"
                ? "Running"
                : status === "paused"
                  ? "Paused"
                  : titleize(status);
    const when =
      live && c.kind === "live"
        ? fmtDur(c.job, server.clock())
        : fmtAgo(c.ts, server.clock()) || "now";
    const clock = new Date(c.ts);
    const hm = clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dur =
      c.kind === "disk"
        ? fmtMs(c.run.durationMs)
        : c.kind === "live" && c.job.finishedAt
          ? fmtDur(c.job, server.clock())
          : "";
    const errRaw = c.kind === "disk" ? c.run.error : c.kind === "live" ? c.job.error : undefined;
    const err = errRaw ? errRaw.replace(/\s+/g, " ").slice(0, 48) : "";
    const serial = c.kind === "disk" ? c.run.serial : c.job.serial;
    const device = serial
      ? (server.devices().find((d) => d.serial === serial)?.name ?? serial.slice(0, 8))
      : "";
    // List row: status · time · duration · error snippet (not five identical "Failed · 2d")
    const bits = [word, when, hm];
    if (dur) bits.push(dur);
    const label = bits.join(" · ");
    const detail = [err, device].filter(Boolean).join(" · ");
    const tip = `${word} · ${clock.toLocaleString()}${errRaw ? ` — ${errRaw}` : ""}`;
    return { tone, label, detail, live, tip, word };
  }

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
    const error = c.kind === "live" ? c.job.error : c.kind === "disk" ? c.run.error : undefined;
    return { tone, word, when, dur, device, live, error };
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

  const retryableJobId = () => {
    const c = wb.reviewedRun();
    return c && c.kind === "live" && c.job.status === "error" ? c.job.id : null;
  };

  const switcherLabel = () => (selectedRecipe() ? displayTitle(draft.title()) : "Select test");

  return (
    <>
      {/*
        SpaceX header: one switcher · status · primary actions.
        No nag captions. Empty steps are self-explanatory in the body.
      */}
      <div class="runpane-head">
        <div class="min-w-0 flex-1">
          <div class="relative" data-switcher>
            <Show
              when={selectedRecipe() && titleEditing()}
              fallback={
                <button
                  type="button"
                  class={cn(
                    "inline-flex h-[34px] max-w-full items-center gap-2 rounded-[10px] border border-border bg-layer-2 py-0 pr-3 pl-3.5 text-sm font-semibold tracking-tight text-text shadow-[0_1px_0_rgb(0_0_0_/0.06)] transition-[border-color,background,box-shadow] hover:border-border-strong",
                    !selectedRecipe() && "font-medium text-text-faint",
                    menuOpen() &&
                      "border-border-focus shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]",
                  )}
                  aria-haspopup="listbox"
                  aria-expanded={menuOpen()}
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  <span class="max-w-[280px] min-w-0 truncate">{switcherLabel()}</span>
                  <Icon
                    name="chevron-down"
                    size={14}
                    class={cn(
                      "shrink-0 text-text-faint transition-transform duration-150",
                      menuOpen() && "rotate-180",
                    )}
                  />
                </button>
              }
            >
              <input
                class="m-0 h-8 max-w-full min-w-40 rounded-lg border border-border-focus bg-base px-2.5 text-sm font-semibold tracking-tight text-text outline-none"
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

            <Show when={menuOpen()}>
              <div
                class="absolute top-[calc(100%+8px)] left-0 z-50 max-h-[min(400px,70vh)] min-w-[min(300px,90vw)] overflow-y-auto rounded-xl border border-border bg-layer-1 p-1.5 shadow-xl"
                role="listbox"
              >
                <For each={switcherGroups()}>
                  {(g, gi) => (
                    <div class={cn(gi() > 0 && "mt-1 border-t border-border pt-1")}>
                      <div class="px-2.5 pt-1.5 pb-0.5 text-meta font-medium text-text-faint">
                        {g.label}
                      </div>
                      <For each={g.items}>
                        {(r) => (
                          <div class="group flex items-center gap-px pr-1">
                            <button
                              type="button"
                              role="option"
                              class={cn(
                                "flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-text transition-colors hover:bg-hover",
                                server.selectedRecipeId() === r.id && "bg-accent/12",
                              )}
                              onClick={() => {
                                server.setSelectedRecipeId(r.id);
                                setMenuOpen(false);
                              }}
                            >
                              <span
                                class={cn(
                                  "block min-w-0 truncate text-body font-medium",
                                  !r.title.trim() && "text-text-faint",
                                )}
                              >
                                {displayTitle(r.title)}
                              </span>
                              <span class="mono shrink-0 text-[10.5px] text-text-faint opacity-80">
                                {(() => {
                                  const planned =
                                    server.actions().find((a) => a.id === r.id)?.planned?.length ??
                                    0;
                                  const n =
                                    r.source === "builtin" && planned > 0
                                      ? planned
                                      : (r.steps?.length ?? 0);
                                  return n > 0 ? `${n} step${n === 1 ? "" : "s"}` : "";
                                })()}
                              </span>
                            </button>
                            <Show when={g.custom}>
                              <button
                                type="button"
                                class="grid size-6 shrink-0 place-items-center rounded-md border-0 bg-transparent text-text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-fail/15 hover:text-fail focus-visible:opacity-100"
                                title="Delete"
                                aria-label={`Delete ${r.title}`}
                                onClick={() => void server.deleteRecipeRemote(r.id)}
                              >
                                <Icon name="trash" size={12} />
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
                  class="mt-0.5 flex w-full items-center justify-center gap-2 rounded-b-[10px] border-t border-border px-2.5 pt-2.5 pb-2 font-medium text-accent-soft transition-colors hover:bg-hover"
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

          <Show when={selectedRecipe() && metaLine()}>
            <div class="mt-1 flex min-h-5 items-center gap-2.5">
              <span
                class={cn(
                  "whitespace-nowrap text-[11.5px] font-medium tracking-wide text-text-faint",
                  draft.saveState() === "invalid" &&
                    draft.expandedStep() == null &&
                    "font-semibold text-fail",
                  (metaTone() === "pass" || metaTone() === "heal") && "font-semibold text-pass",
                  metaTone() === "fail" && "font-semibold text-fail",
                  metaTone() === "run" && "font-semibold text-run",
                )}
              >
                {metaLine()}
              </span>
              <Show when={draft.source() === "custom" && draft.steps().length > 0}>
                <button
                  type="button"
                  class="cursor-pointer border-0 bg-transparent p-0 font-inherit text-meta text-text-faint underline underline-offset-2 hover:text-text-muted"
                  onClick={() => startTitleEdit()}
                >
                  Rename
                </button>
              </Show>
            </div>
          </Show>
          <Show when={selectedRecipe() && (draft.description() || selectedMeta()?.description)}>
            <p class="mt-1.5 mb-0 max-w-[42em] text-[12.5px] leading-snug text-text-muted">
              {draft.description() || selectedMeta()?.description}
            </p>
          </Show>
        </div>

        <div class="flex shrink-0 flex-col items-end gap-1">
          <div class="flex h-[34px] items-center gap-1 self-end">
            <Show when={wb.running()}>
              <button type="button" class="btn btn-ghost" onClick={() => wb.stop()}>
                <Icon name="square" size={11} />
                Stop
              </button>
            </Show>
            <Show when={retryableJobId()}>
              <button
                type="button"
                class="btn btn-ghost"
                onClick={() => void server.retrySelectedJob(retryableJobId()!)}
              >
                <Icon name="refresh" size={13} />
                Retry
              </button>
            </Show>

            <Show when={!selectedRecipe()}>
              <button type="button" class="btn btn-ghost" onClick={() => void createNewTest()}>
                <Icon name="plus" size={13} />
                New
              </button>
            </Show>

            <Show when={selectedRecipe()}>
              {/* Past runs live in the header — not a random chip in the step list. */}
              <Show when={wb.chips().length > 0}>
                <div class="relative" data-runhist>
                  <button
                    type="button"
                    class={cn("btn btn-ghost gap-1.5", historyOpen() && "btn-ghost--on")}
                    aria-expanded={historyOpen()}
                    onClick={() => setHistoryOpen((o) => !o)}
                  >
                    Past runs
                    <span class="mono min-w-[1.1em] text-center text-[11px] opacity-70">
                      {wb.chips().length}
                    </span>
                  </button>
                  <Show when={historyOpen()}>
                    <div
                      class="absolute top-[calc(100%+6px)] right-0 left-auto z-50 max-h-[300px] min-w-[min(380px,92vw)] overflow-y-auto rounded-xl border border-border bg-layer-1 p-1 shadow-xl"
                      role="listbox"
                      aria-label="Past runs"
                    >
                      <For each={wb.chips()}>
                        {(c) => {
                          const f = () => chipFacts(c);
                          return (
                            <button
                              type="button"
                              class={cn(
                                "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-body text-text hover:bg-hover",
                                wb.reviewedRun()?.id === c.id && "bg-accent/12",
                              )}
                              role="option"
                              aria-selected={wb.reviewedRun()?.id === c.id}
                              onClick={() => {
                                wb.toggleChip(c.id);
                                setHistoryOpen(false);
                              }}
                            >
                              <span
                                class={cn(
                                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                                  toneDot(f().tone),
                                )}
                                aria-hidden="true"
                              />
                              <span class="flex min-w-0 flex-col gap-0.5">
                                <span class="text-meta font-medium">{f().label}</span>
                                <Show when={f().detail}>
                                  <span class="max-w-[300px] truncate text-[11px] leading-snug text-text-faint">
                                    {f().detail}
                                  </span>
                                </Show>
                              </span>
                            </button>
                          );
                        }}
                      </For>
                      <Show when={wb.reviewedRun()}>
                        <button
                          type="button"
                          class="mt-0.5 block w-full border-t border-border px-2.5 py-2 text-left text-meta text-text-faint hover:text-text"
                          onClick={() => {
                            setHistoryOpen(false);
                            setLogOpen(true);
                          }}
                        >
                          View log
                        </button>
                      </Show>
                    </div>
                  </Show>
                </div>
              </Show>

              <Show when={draft.source() === "builtin"}>
                <button
                  type="button"
                  class="btn btn-ghost"
                  onClick={() => void draft.forkAsCustom()}
                >
                  <Icon name="copy" size={13} />
                  Edit
                </button>
              </Show>

              {/* Record lives on the phone artboard (View / Drive / Record) — one place. */}

              <button
                type="button"
                class="btn btn-acc min-w-[76px] font-semibold"
                disabled={!canRun()}
                data-tip={runTip()}
                onClick={() => {
                  if (!canRun()) return;
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
          <Show when={showRunWhy()}>
            <p class="m-0 max-w-40 text-right text-[11px] leading-tight font-medium text-text-faint">
              {runBlocker()}
            </p>
          </Show>
        </div>
      </div>

      <div class="runpane-body">
        <Show when={!selectedRecipe()}>
          <div class="flex min-h-[280px] flex-1 items-start justify-center px-2 py-14">
            <div class="max-w-[360px]">
              <p class="mono mb-2.5 text-[10px] font-bold tracking-[0.12em] text-accent-soft">
                SPECIMEN
              </p>
              <p class="mb-2 text-xl font-semibold tracking-tight text-text leading-tight">
                Mobile tests, step by step
              </p>
              <p class="mb-5 text-[13px] leading-normal text-text-muted">
                Pick a test or create one. Connect a phone, hit Run — screenshots land on Canvas.
              </p>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="btn btn-acc" onClick={() => void createNewTest()}>
                  <Icon name="plus" size={13} />
                  New test
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn--bordered"
                  onClick={() => {
                    const firstLib = server.recipes().find((r) => r.source === "builtin");
                    if (firstLib) {
                      server.setSelectedRecipeId(firstLib.id);
                    } else {
                      setMenuOpen(true);
                    }
                  }}
                >
                  Browse tests
                </button>
              </div>
            </div>
          </div>
        </Show>

        <Show when={selectedRecipe()}>
          {/* Only when reviewing a specific past run — not a random "5 failed" chip. */}
          <Show when={reviewedFacts()}>
            {(f) => (
              <>
                <div class="flex flex-wrap items-baseline gap-2 px-4 py-1 pb-2 text-meta text-text-faint">
                  <span
                    class={cn("inline-flex items-center gap-1.5 font-semibold", toneText(f().tone))}
                  >
                    <Show when={f().live}>
                      <span
                        class="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
                        aria-hidden="true"
                      />
                    </Show>
                    {f().word}
                  </span>
                  <Show when={f().when}>
                    <span class="before:mr-2 before:text-border-strong before:opacity-50 before:content-['·'] tabular-nums">
                      {f().when}
                    </span>
                  </Show>
                  <Show when={f().dur}>
                    <span class="mono before:mr-2 before:text-border-strong before:opacity-50 before:content-['·'] tabular-nums">
                      {f().dur}
                    </span>
                  </Show>
                  <Show when={f().device}>
                    <span class="before:mr-2 before:text-border-strong before:opacity-50 before:content-['·'] tabular-nums">
                      {f().device}
                    </span>
                  </Show>
                  <button
                    type="button"
                    class="ml-auto h-[22px] rounded-md px-1.5 text-[11px] font-medium text-text-faint hover:bg-hover hover:text-text"
                    onClick={() => {
                      const id = wb.reviewedRun()?.id;
                      if (id) wb.toggleChip(id);
                    }}
                  >
                    Clear
                  </button>
                </div>
                <Show when={f().error && f().tone === "fail"}>
                  <div
                    class="my-2 mx-4 flex items-start gap-2 rounded-md border border-fail/30 bg-fail/10 px-3 py-2.5 text-body leading-snug text-fail"
                    role="alert"
                  >
                    <span
                      class="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-fail text-meta font-bold text-accent-fg"
                      aria-hidden="true"
                    >
                      !
                    </span>
                    <span>{f().error}</span>
                  </div>
                </Show>
              </>
            )}
          </Show>

          <Show when={selectedMeta()?.requiresProdMatch && !server.prodAccountMatch()}>
            <div class="mx-4 my-2 flex items-center gap-2 rounded-md border border-heal/30 bg-heal/10 px-2.5 py-2 text-meta leading-snug text-heal">
              <span class="grid shrink-0 place-items-center" aria-hidden="true">
                <Icon name="alert" size={14} />
              </span>
              <span class="flex-1">Needs a prod account match (e.g. gmail.com).</span>
              <button
                type="button"
                class="btn btn-ghost shrink-0 text-heal"
                onClick={() => cmd.run("nav.settings")}
              >
                Configure
              </button>
            </div>
          </Show>

          {/* Packaged plan (builtin or forked thin flow) — human titles, never a lone FLOW row. */}
          <Show when={showPackagedPlan()}>
            <div class="mt-1 flex flex-col" aria-label="Steps">
              <For each={plannedSteps()}>
                {(p, i) => {
                  const anno = () => wb.rowAnno(i());
                  const st = () => anno().status;
                  return (
                    <button
                      type="button"
                      class={cn(
                        "flex w-full min-h-[52px] items-center gap-3 border-b border-border px-4 text-left text-inherit hover:bg-hover",
                        wb.focusedIndex() === i()
                          ? "border-l-2 border-l-accent bg-accent/10"
                          : st() === "running"
                            ? "bg-run/10"
                            : st() === "pass"
                              ? "bg-pass/10"
                              : st() === "fail"
                                ? "bg-fail/10"
                                : undefined,
                      )}
                      onClick={() => wb.focusStep(i())}
                    >
                      <span class="mono grid size-[22px] shrink-0 place-items-center rounded-md border border-border bg-layer-1 text-[11px] font-semibold text-text-muted tabular-nums">
                        {i() + 1}
                      </span>
                      <span class="min-w-0 flex-1 text-[13.5px] font-medium tracking-tight text-text">
                        {p.title}
                      </span>
                      <StepAnno anno={anno} />
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
          <Show when={showStepEditor()}>
            <RecipeStepsEditor />
          </Show>
        </Show>
      </div>

      <Show when={logOpen()}>
        <RawLogOverlay text={rawLog()} onClose={() => setLogOpen(false)} />
      </Show>
    </>
  );
}

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
      class="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 px-6 pt-[10vh] pb-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        class="flex max-h-[70vh] w-[min(680px,100%)] flex-col overflow-hidden rounded-xl border border-border bg-layer-1 shadow-xl"
        role="dialog"
        aria-label="Raw log"
      >
        <div class="flex shrink-0 items-center gap-2 border-b border-border py-2.5 pr-3 pl-4">
          <span class="flex-1 text-body font-semibold text-text">Raw log</span>
          <button
            type="button"
            class="btn btn-ghost h-[26px] px-2 text-meta"
            onClick={() => void copy()}
          >
            <Icon name={copied() ? "check" : "copy"} size={12} />
            {copied() ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            class="grid size-[26px] place-items-center rounded-md text-text-faint hover:bg-hover hover:text-text"
            aria-label="Close"
            onClick={() => props.onClose()}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <pre class="mono m-0 flex-1 overflow-auto px-4 pt-3 pb-4 text-meta leading-relaxed break-words whitespace-pre-wrap text-text-muted">
          {props.text || "— no log lines —"}
        </pre>
      </div>
    </div>
  );
}

import { For, Show, createMemo, createSignal, onMount, onCleanup } from "solid-js";
import { useServer, type JobInfo, type RecipeInfo } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useWorkbench, type RunChip } from "../context/workbench";
import { useCommand } from "../context/command";
import { Icon } from "./icon";
import { EmptyState } from "./empty-state";
import { IconButton } from "@grok-device/ui/icon-button";
import { Button } from "@grok-device/ui/button";
import { RecipeStepsEditor } from "./step-list";
import { statusTone, fmtDur, fmtAgo, fmtMs, titleize, displayTitle } from "../lib/job";
import { canRunRecipe, runBlocker as runBlockerOf } from "../lib/run-gates";
import { cn } from "../lib/cn";
import {
  btnGhost,
  mono,
  popover,
  modalPanel,
  modalScrim,
  statusPill,
  statusPillTone,
  menuOption,
  menuOptionOn,
} from "../lib/ui";

function toneText(tone: string): string {
  if (tone === "pass") return "text-icon-success-base";
  if (tone === "fail") return "text-icon-critical-base";
  if (tone === "heal") return "text-icon-warning-base";
  if (tone === "run") return "text-icon-info-base";
  return "text-text-weak";
}

function toneDot(tone: string): string {
  if (tone === "pass") return "bg-icon-success-base";
  if (tone === "fail") return "bg-icon-critical-base";
  if (tone === "heal") return "bg-icon-warning-base";
  if (tone === "run") return "bg-icon-info-base";
  return "bg-text-weaker";
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

  /** Every selected test uses the same step editor — library defaults included. */
  const gate = () => ({
    hasRecipe: Boolean(selectedRecipe()),
    health: server.health(),
    emptyDevices: server.isEmptyDevices(),
    source: draft.source(),
    stepCount: draft.steps().length,
    saveState: draft.saveState(),
    plannedCount: 0,
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
    // Builtin auto-forks on save — title is editable like everything else.
    if (!selectedRecipe()) return;
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
    const n = draft.steps().length;
    if (n === 0) return "Draft · not run";
    return `${n} step${n === 1 ? "" : "s"} · not run`;
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

  /** Dense history strip — last few runs only; overflow lives in the menu. */
  const recentChips = createMemo(() => wb.chips().slice(0, 3));
  const overflowChipCount = createMemo(() => Math.max(0, wb.chips().length - 3));

  return (
    <>
      {/*
        Run chrome: editable title + switcher · calm meta · dense history · primary Run.
        Steps list is the document body (matches step-list density).
      */}
      <div class="relative z-40 shrink-0 border-b border-border-weak-base bg-surface-raised-stronger-non-alpha px-4 pt-3.5 pb-3 text-12-regular text-text-strong">
        <div class="flex items-start gap-3">
          {/* ── Title cluster ─────────────────────────────────────────── */}
          <div class="min-w-0 flex-1">
            <div class="relative" data-switcher>
              <Show
                when={selectedRecipe() && titleEditing()}
                fallback={
                  <div class="group/title -ml-1.5 flex min-w-0 max-w-full items-center gap-0.5">
                    <button
                      type="button"
                      class={cn(
                        "inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border-0 bg-transparent",
                        "py-1 pr-1.5 pl-1.5 text-left text-16-medium tracking-tight text-text-strong",
                        "transition-[background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                        "hover:bg-surface-raised-base-hover",
                        !selectedRecipe() && "text-text-base",
                        menuOpen() && "bg-surface-base-active",
                      )}
                      aria-haspopup="listbox"
                      aria-expanded={menuOpen()}
                      title={
                        selectedRecipe() ? "Switch test · double-click to rename" : "Select test"
                      }
                      onClick={() => setMenuOpen((o) => !o)}
                      onDblClick={(e) => {
                        if (!selectedRecipe()) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        startTitleEdit();
                      }}
                    >
                      <span class="max-w-[min(320px,48vw)] min-w-0 truncate">
                        {switcherLabel()}
                      </span>
                      <Icon
                        name="chevron-down"
                        size={14}
                        class={cn(
                          "shrink-0 text-text-weak transition-transform duration-150",
                          menuOpen() && "rotate-180 text-text-weak",
                        )}
                      />
                    </button>
                    <Show when={selectedRecipe()}>
                      <button
                        type="button"
                        class={cn(
                          "h-7 shrink-0 rounded-md border-0 bg-transparent px-2",
                          "text-12-medium text-text-weak",
                          "opacity-0 transition-[opacity,background-color,color] duration-150",
                          "group-hover/title:opacity-100 hover:bg-surface-raised-base-hover hover:text-text-strong",
                          "focus-visible:opacity-100 focus-visible:bg-surface-raised-base-hover",
                        )}
                        aria-label="Rename test"
                        onClick={(e) => {
                          e.stopPropagation();
                          startTitleEdit();
                        }}
                      >
                        Rename
                      </button>
                    </Show>
                  </div>
                }
              >
                <input
                  class={cn(
                    "m-0 h-8 max-w-full min-w-[12rem] rounded-md border-0 bg-surface-raised-stronger-non-alpha",
                    "px-2 text-14-medium tracking-tight text-text-strong outline-none",
                    "ring-2 ring-inset ring-border-interactive-base/45",
                  )}
                  value={titleBuf()}
                  aria-label="Test title"
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
                  class={cn(
                    popover,
                    "absolute top-[calc(100%+6px)] left-0 z-50 max-h-[min(400px,70vh)] min-w-[min(300px,90vw)] origin-top-left overflow-y-auto",
                  )}
                  role="listbox"
                >
                  <For each={switcherGroups()}>
                    {(g, gi) => (
                      <div class={cn(gi() > 0 && "mt-1 border-t border-border-weak-base pt-1")}>
                        <div class="px-2.5 pt-1.5 pb-0.5 text-12-medium tracking-wide text-text-weak uppercase">
                          {g.label}
                        </div>
                        <For each={g.items}>
                          {(r) => (
                            <div
                              class={cn(
                                "group/session relative flex min-w-0 items-center gap-1 rounded-md pr-1",
                                "hover:bg-surface-raised-base-hover",
                                "[&:has(:focus-visible)]:bg-surface-raised-base-hover",
                                server.selectedRecipeId() === r.id && "bg-surface-base-active",
                              )}
                            >
                              <button
                                type="button"
                                role="option"
                                class="flex min-w-0 flex-1 items-center justify-between gap-2 py-1 pl-2 pr-1 text-left text-14-regular text-text-strong"
                                onClick={() => {
                                  server.setSelectedRecipeId(r.id);
                                  setMenuOpen(false);
                                }}
                              >
                                <span
                                  class={cn(
                                    "block min-w-0 truncate text-14-regular",
                                    !r.title.trim() && "text-text-weak",
                                  )}
                                >
                                  {displayTitle(r.title)}
                                </span>
                                <span class={cn(mono, "shrink-0 text-12-regular text-text-weak")}>
                                  {(() => {
                                    const planned =
                                      server.actions().find((a) => a.id === r.id)?.planned
                                        ?.length ?? 0;
                                    const n =
                                      r.source === "builtin" && planned > 0
                                        ? planned
                                        : (r.steps?.length ?? 0);
                                    return n > 0 ? `${n}` : "";
                                  })()}
                                </span>
                              </button>
                              <Show when={g.custom}>
                                <div class="w-0 shrink-0 overflow-hidden opacity-0 pointer-events-none transition-[width,opacity] group-hover/session:w-6 group-hover/session:opacity-100 group-hover/session:pointer-events-auto group-focus-within/session:w-6 group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto">
                                  <IconButton
                                    variant="ghost"
                                    size="normal"
                                    class="rounded-md hover:text-icon-critical-base"
                                    title="Delete"
                                    aria-label={`Delete ${r.title}`}
                                    onClick={() => void server.deleteRecipeRemote(r.id)}
                                  >
                                    <Icon name="trash" size={12} />
                                  </IconButton>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                  <button
                    type="button"
                    class="mt-0.5 flex w-full items-center justify-center gap-2 border-t border-border-weak-base px-2.5 py-2 text-14-regular text-text-strong transition-colors hover:bg-surface-raised-base-hover"
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

            {/* Calm meta: N steps · status — readable, not muddy */}
            <Show when={selectedRecipe() && metaLine()}>
              <div class="mt-1 flex min-h-[18px] flex-wrap items-center gap-x-2 gap-y-0.5 pl-1">
                <Show when={reviewedFacts()}>
                  {(f) => (
                    <span class={cn(statusPill, statusPillTone(f().tone))}>
                      {f().word}
                      <Show when={f().tone === "pass" || f().tone === "heal"}>
                        <Icon name="check" size={11} />
                      </Show>
                    </span>
                  )}
                </Show>
                <Show when={reviewedFacts()}>
                  {(f) => (
                    <span class="text-12-regular tabular-nums text-text-weak">
                      <Show when={f().when}>
                        <span>{f().when}</span>
                      </Show>
                      <Show when={f().when && f().dur}>
                        <span class="mx-1.5 text-text-weak">·</span>
                      </Show>
                      <Show when={f().dur}>
                        <span>{f().dur}</span>
                      </Show>
                    </span>
                  )}
                </Show>
                <Show when={!reviewedFacts()}>
                  <span
                    class={cn(
                      "text-12-regular tabular-nums text-text-base",
                      draft.saveState() === "invalid" &&
                        draft.expandedStep() == null &&
                        "text-12-medium text-icon-critical-base",
                    )}
                  >
                    {metaLine()}
                  </span>
                </Show>
              </div>
            </Show>

            {/* Description only when it adds info beyond the title */}
            <Show
              when={
                selectedRecipe() &&
                (draft.description() || selectedMeta()?.description) &&
                (draft.description() || selectedMeta()?.description || "")
                  .toLowerCase()
                  .replace(/\s+/g, " ")
                  .trim() !== draft.title().toLowerCase().replace(/\s+/g, " ").trim()
              }
            >
              <p class="mt-0.5 mb-0 max-w-[42em] truncate pl-1 text-12-regular leading-snug text-text-weak">
                {draft.description() || selectedMeta()?.description}
              </p>
            </Show>
          </div>

          {/* ── Actions: secondary · history chips · primary Run ──────── */}
          <div class="flex shrink-0 flex-col items-end gap-1 pt-px">
            <div class="flex h-8 items-center gap-1 self-end">
              <Show when={wb.running()}>
                <button
                  type="button"
                  class={cn(btnGhost, " px-2 text-12-regular")}
                  onClick={() => wb.stop()}
                >
                  <Icon name="square" size={11} />
                  Stop
                </button>
              </Show>
              <Show when={retryableJobId()}>
                <button
                  type="button"
                  class={cn(btnGhost, " px-2 text-12-regular")}
                  onClick={() => void server.retrySelectedJob(retryableJobId()!)}
                >
                  <Icon name="refresh" size={13} />
                  Retry
                </button>
              </Show>

              <Show when={!selectedRecipe()}>
                <button
                  type="button"
                  class={cn(btnGhost, " px-2 text-12-regular")}
                  onClick={() => void createNewTest()}
                >
                  <Icon name="plus" size={13} />
                  New
                </button>
              </Show>

              <Show when={selectedRecipe() && wb.chips().length > 0}>
                <div class="flex items-center gap-0.5" data-runhist>
                  {/* Dense recent chips — not a spam wall */}
                  <For each={recentChips()}>
                    {(c) => {
                      const f = () => chipFacts(c);
                      const on = () => wb.reviewedRun()?.id === c.id;
                      return (
                        <button
                          type="button"
                          class={cn(
                            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2",
                            "text-12-medium tabular-nums transition-colors",
                            "border-border-weak-base bg-surface-raised-stronger-non-alpha text-text-base",
                            "hover:border-border-strong-base hover:bg-surface-raised-base-hover hover:text-text-strong",
                            on() &&
                              "border-border-weak-base bg-surface-base-active text-text-strong",
                          )}
                          data-tip={f().tip}
                          aria-pressed={on()}
                          onClick={() => wb.toggleChip(c.id)}
                        >
                          <span
                            class={cn(
                              "size-1.5 shrink-0 rounded-full",
                              toneDot(f().tone),
                              f().live && "animate-pulse",
                            )}
                            aria-hidden="true"
                          />
                          <span class="max-w-[4.5rem] truncate">{f().word}</span>
                        </button>
                      );
                    }}
                  </For>
                  <div class="relative">
                    <button
                      type="button"
                      class={cn(
                        btnGhost,
                        "h-7 gap-1 px-1.5 text-12-regular text-text-weak",
                        historyOpen() && "bg-surface-base-active text-text-strong",
                      )}
                      aria-expanded={historyOpen()}
                      aria-label={
                        overflowChipCount() > 0
                          ? `All runs, ${overflowChipCount()} more`
                          : "All runs"
                      }
                      data-tip={
                        overflowChipCount() > 0 ? `+${overflowChipCount()} more` : "All runs"
                      }
                      onClick={() => setHistoryOpen((o) => !o)}
                    >
                      <Show
                        when={overflowChipCount() > 0}
                        fallback={<Icon name="chevron-down" size={13} />}
                      >
                        <span class={cn(mono, "text-12-regular")}>+{overflowChipCount()}</span>
                      </Show>
                    </button>
                    <Show when={historyOpen()}>
                      <div
                        class={cn(
                          popover,
                          "absolute top-[calc(100%+6px)] right-0 left-auto max-h-[300px] min-w-[min(360px,92vw)] origin-top-right overflow-y-auto p-1",
                        )}
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
                                  menuOption,
                                  "flex w-full items-start gap-2 px-2 py-1 text-left text-14-regular text-text-strong",
                                  wb.reviewedRun()?.id === c.id && menuOptionOn,
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
                                <span class="flex min-w-0 flex-col gap-px">
                                  <span class="text-14-regular text-text-strong">{f().label}</span>
                                  <Show when={f().detail}>
                                    <span class="max-w-[300px] truncate text-12-regular leading-snug text-text-weak">
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
                            class="mt-0.5 block w-full border-t border-border-weak-base px-2 py-1.5 text-left text-12-medium text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
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
                </div>
              </Show>

              {/* Primary action — always rightmost, highest weight */}
              <Show when={selectedRecipe()}>
                <Button
                  variant="primary"
                  size="normal"
                  class="min-w-[4.75rem] gap-1.5"
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
                </Button>
              </Show>
            </div>
            <Show when={showRunWhy()}>
              <p class="m-0 max-w-44 text-right text-12-regular leading-tight font-medium text-text-weak">
                {runBlocker()}
              </p>
            </Show>
          </div>
        </div>
      </div>

      {/* Builtin fork — one clear line, not a wall of text */}
      <Show when={draft.forkedFrom()}>
        {(origin) => (
          <div class="flex shrink-0 items-center gap-2 border-b border-border-weak-base bg-surface-base px-3.5 py-1.5 text-text-strong">
            <span
              class="grid size-5 shrink-0 place-items-center rounded text-text-weak"
              aria-hidden="true"
            >
              <Icon name="chevron-right" size={13} class="rotate-180" />
            </span>
            <span class="text-12-regular text-text-weak">Editing copy of</span>
            <button
              type="button"
              class={cn(
                "max-w-[240px] truncate rounded px-1 py-0.5 text-12-medium text-text-strong",
                "transition-colors hover:bg-surface-base-hover hover:text-text-strong",
              )}
              onClick={() => draft.openOriginal()}
            >
              {displayTitle(origin().title)}
            </button>
            <button
              type="button"
              class="ml-auto shrink-0 rounded-md px-2 py-1 text-12-medium text-text-strong transition-colors hover:bg-surface-raised-base-hover"
              onClick={() => draft.openOriginal()}
            >
              Open original
            </button>
          </div>
        )}
      </Show>

      <div class="relative z-[1] flex min-h-0 flex-1 flex-col overflow-hidden">
        <Show when={!selectedRecipe()}>
          <div class="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-8 py-16">
            <EmptyState
              align="start"
              title="No test selected"
              description="Create a test or open one from the title menu."
              actionLabel="New test"
              onAction={() => void createNewTest()}
              class="px-0 py-0"
            />
          </div>
        </Show>

        <Show when={selectedRecipe()}>
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Only when reviewing a specific past run — not a random "5 failed" chip. */}
            <Show when={reviewedFacts()}>
              {(f) => (
                <div class="shrink-0">
                  <div class="flex flex-wrap items-baseline gap-2 px-3.5 py-1.5 pb-2 text-12-regular text-text-weak">
                    <span
                      class={cn("inline-flex items-center gap-1.5 font-medium", toneText(f().tone))}
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
                      <span class="before:mr-2 before:text-text-weak before:content-['·'] tabular-nums">
                        {f().when}
                      </span>
                    </Show>
                    <Show when={f().dur}>
                      <span
                        class={cn(
                          mono,
                          "before:mr-2 before:text-text-weak before:content-['·'] tabular-nums",
                        )}
                      >
                        {f().dur}
                      </span>
                    </Show>
                    <Show when={f().device}>
                      <span class="before:mr-2 before:text-text-weak before:content-['·'] tabular-nums">
                        {f().device}
                      </span>
                    </Show>
                    <button
                      type="button"
                      class="ml-auto h-[22px] rounded-md px-1.5 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-strong"
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
                      class="my-2 mx-3.5 flex items-start gap-2 rounded-md border border-border-critical-base/40 bg-icon-critical-base/10 px-3 py-2.5 text-12-regular leading-snug text-icon-critical-base"
                      role="alert"
                    >
                      <span
                        class="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-icon-critical-base text-12-regular font-bold text-text-on-critical-base"
                        aria-hidden="true"
                      >
                        !
                      </span>
                      <span>{f().error}</span>
                    </div>
                  </Show>
                </div>
              )}
            </Show>

            <Show when={selectedMeta()?.requiresProdMatch && !server.prodAccountMatch()}>
              <div class="mx-3.5 my-2 flex shrink-0 items-center gap-2 rounded-md border border-border-warning-base/40 bg-icon-warning-base/10 px-2.5 py-2 text-12-regular leading-snug text-icon-warning-base">
                <span class="grid shrink-0 place-items-center" aria-hidden="true">
                  <Icon name="alert" size={14} />
                </span>
                <span class="flex-1">Needs a prod account match (e.g. gmail.com).</span>
                <button
                  type="button"
                  class={cn(btnGhost, "shrink-0 text-icon-warning-base")}
                  onClick={() => cmd.run("nav.settings")}
                >
                  Configure
                </button>
              </div>
            </Show>

            <RecipeStepsEditor />
          </div>
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
      class={cn(modalScrim, "flex items-start justify-center px-6 pt-[10vh] pb-6 backdrop-blur-sm")}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        class={cn(modalPanel, "flex max-h-[70vh] w-[min(680px,100%)] flex-col")}
        role="dialog"
        aria-label="Raw log"
      >
        <div class="flex shrink-0 items-center gap-2 border-b border-border-weak-base py-2.5 pr-3 pl-4">
          <span class="flex-1 text-12-medium text-text-strong">Raw log</span>
          <button
            type="button"
            class={cn(btnGhost, " px-2 text-12-regular")}
            onClick={() => void copy()}
          >
            <Icon name={copied() ? "check" : "copy"} size={12} />
            {copied() ? "Copied" : "Copy"}
          </button>
          <IconButton
            variant="ghost"
            size="normal"
            aria-label="Close"
            onClick={() => props.onClose()}
          >
            <Icon name="x" size={14} />
          </IconButton>
        </div>
        <pre
          class={cn(
            mono,
            "m-0 flex-1 overflow-auto px-4 pt-3 pb-4 text-12-regular leading-relaxed break-words whitespace-pre-wrap text-text-weak",
          )}
        >
          {props.text || "— no log lines —"}
        </pre>
      </div>
    </div>
  );
}

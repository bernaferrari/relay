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
      if (!t?.closest?.(".runpane__switcher")) setMenuOpen(false);
      if (!t?.closest?.(".runhist")) setHistoryOpen(false);
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
      <div class="runpane__head">
        <div class="runpane__head-copy">
          <div class="pick-wrap runpane__switcher">
            <Show
              when={selectedRecipe() && titleEditing()}
              fallback={
                <button
                  type="button"
                  class="runpane__switch"
                  classList={{
                    "runpane__switch--empty": !selectedRecipe(),
                    "runpane__switch--open": menuOpen(),
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={menuOpen()}
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  <span class="runpane__switch-label">{switcherLabel()}</span>
                  <Icon name="chevron-down" size={14} class="runpane__switch-chev" />
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

            <Show when={menuOpen()}>
              <div class="pick-menu runpane__switcher-menu" role="listbox">
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
                              <span class="pick-item__meta mono">
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
                                class="pick-row__action pick-row__action--del"
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

          <Show when={selectedRecipe() && metaLine()}>
            <div class="runpane__meta-row">
              <span
                class="runpane__meta"
                classList={{
                  "runpane__meta--bad":
                    draft.saveState() === "invalid" && draft.expandedStep() == null,
                  "runpane__meta--pass": metaTone() === "pass" || metaTone() === "heal",
                  "runpane__meta--fail": metaTone() === "fail",
                  "runpane__meta--run": metaTone() === "run",
                }}
              >
                {metaLine()}
              </span>
              <Show when={draft.source() === "custom" && draft.steps().length > 0}>
                <button type="button" class="runpane__rename" onClick={() => startTitleEdit()}>
                  Rename
                </button>
              </Show>
            </div>
          </Show>
          <Show when={selectedRecipe() && (draft.description() || selectedMeta()?.description)}>
            <p class="runpane__desc-static">{draft.description() || selectedMeta()?.description}</p>
          </Show>
        </div>

        <div class="runpane__head-actions-col">
          <div class="runpane__head-actions">
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
                <div class="runhist runhist--head">
                  <button
                    type="button"
                    class="btn btn-ghost runhist__head-btn"
                    classList={{ "btn-ghost--on": historyOpen() }}
                    aria-expanded={historyOpen()}
                    onClick={() => setHistoryOpen((o) => !o)}
                  >
                    Past runs
                    <span class="runhist__head-count mono">{wb.chips().length}</span>
                  </button>
                  <Show when={historyOpen()}>
                    <div class="runhist__list" role="listbox" aria-label="Past runs">
                      <For each={wb.chips()}>
                        {(c) => {
                          const f = () => chipFacts(c);
                          return (
                            <button
                              type="button"
                              class="runhist__item"
                              classList={{
                                "runhist__item--on": wb.reviewedRun()?.id === c.id,
                              }}
                              role="option"
                              aria-selected={wb.reviewedRun()?.id === c.id}
                              onClick={() => {
                                wb.toggleChip(c.id);
                                setHistoryOpen(false);
                              }}
                            >
                              <span
                                class={`hchip__dot hchip__dot--${f().tone}`}
                                aria-hidden="true"
                              />
                              <span class="runhist__item-body">
                                <span class="runhist__item-label">{f().label}</span>
                                <Show when={f().detail}>
                                  <span class="runhist__item-detail">{f().detail}</span>
                                </Show>
                              </span>
                            </button>
                          );
                        }}
                      </For>
                      <Show when={wb.reviewedRun()}>
                        <button
                          type="button"
                          class="runhist__log"
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
                class="btn btn-acc runpane__run"
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
            <p class="runpane__run-why">{runBlocker()}</p>
          </Show>
        </div>
      </div>

      <div class="runpane__scroll">
        <Show when={!selectedRecipe()}>
          <div class="runpane__empty runpane__empty--quiet">
            <div class="runpane__welcome">
              <p class="runpane__welcome-kicker mono">SPECIMEN</p>
              <p class="runpane__welcome-title">Mobile tests, step by step</p>
              <p class="runpane__welcome-body">
                Pick a test or create one. Connect a phone, hit Run — screenshots land on Canvas.
              </p>
              <div class="runpane__welcome-actions">
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
                  <button
                    type="button"
                    class="runsum__clear"
                    onClick={() => {
                      const id = wb.reviewedRun()?.id;
                      if (id) wb.toggleChip(id);
                    }}
                  >
                    Clear
                  </button>
                </div>
                <Show when={f().error && f().tone === "fail"}>
                  <div class="heal-box heal-box--fail heal-box--spaced" role="alert">
                    <span class="heal-box__icon" aria-hidden="true">
                      !
                    </span>
                    <span>{f().error}</span>
                  </div>
                </Show>
              </>
            )}
          </Show>

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

          {/* Packaged plan (builtin or forked thin flow) — human titles, never a lone FLOW row. */}
          <Show when={showPackagedPlan()}>
            <div class="planned" aria-label="Steps">
              <For each={plannedSteps()}>
                {(p, i) => {
                  const anno = () => wb.rowAnno(i());
                  return (
                    <button
                      type="button"
                      class="planned__row"
                      classList={{
                        "planned__row--run": anno().status === "running",
                        "planned__row--pass": anno().status === "pass",
                        "planned__row--fail": anno().status === "fail",
                        "planned__row--on": wb.focusedIndex() === i(),
                      }}
                      onClick={() => wb.focusStep(i())}
                    >
                      <span class="planned__i mono">{i() + 1}</span>
                      <span class="planned__title">{p.title}</span>
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

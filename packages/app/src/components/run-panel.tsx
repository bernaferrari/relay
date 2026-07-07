import { For, Show, createMemo, createSignal, createEffect } from "solid-js";
import { useServer, type JobInfo, type RecipeInfo } from "../context/server";
import { describeStep } from "../context/recorder";
import { Glyphs } from "./glyphs";
import { EmptyState } from "./empty-state";
import { useCommand } from "../context/command";
import { Icon, GLYPH_META } from "./icon";
import { RecipeEditor } from "./recipe-editor";
import { statusTone, fmtDur, fmtMs, n } from "../lib/job";

/** Hover tip describing what a step does (its actions + timing). */
function stepTip(step: { title: string; glyphs?: string[]; durationMs?: number }): string {
  const acts = (step.glyphs ?? []).map((g) => GLYPH_META[g]?.label).filter(Boolean);
  const parts = [step.title];
  if (acts.length) parts.push(acts.join(" · "));
  if (step.durationMs) parts.push(fmtMs(step.durationMs));
  return parts.join(" — ");
}

/**
 * The run pane (plan 009) — the single right surface.
 * Header (recipe title + Run/Queue + disabled-reason caption) · steps (always
 * rendered — custom authored steps, builtin flow preview, or live trace steps)
 * · run-head · error box · collapsible console. Reads contexts — no props.
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

  // ── Run button (moved from topbar — plan 009 step 4) ──
  const canRun = () =>
    server.health() === "online" && !server.isEmptyDevices() && Boolean(selectedRecipe());
  const runDisabledReason = () => {
    if (server.health() !== "online") return "Server is offline — start with pnpm dev:serve";
    if (server.isEmptyDevices()) return "No device connected — connect and refresh";
    if (!selectedRecipe()) return "Select a recipe from the sidebar";
    return "";
  };

  /** Human label for a builtin flow step (C1 fallback — planned titles live in
   *  core's RECIPE_TRACE_PLANS, not exposed via /actions; we render the flow
   *  step as a sentence rather than showing nothing). */
  function flowLabel(step: RecipeInfo["steps"][number]): string {
    if (step.kind === "flow") return `Runs the built-in ${step.flow} flow`;
    return describeStep(step);
  }

  const consoleLabel = () => {
    const run = persistedRun();
    if (run) return `Log — ${run.action}`;
    const j = selectedJob();
    if (j) return `Log — ${j.title ?? j.action}`;
    const r = selectedRecipe();
    if (r) return `Log — ${r.title}`;
    return "Activity";
  };

  const hasContent = () => Boolean(selectedRecipe() || persistedRun());

  return (
    <>
      {/* ── Empty state: no recipe / no run selected ── */}
      <Show when={!hasContent()}>
        <div class="runpane__empty">
          <EmptyState
            size="md"
            icon="run"
            title="Pick a recipe"
            description="Choose a recipe from the sidebar to see its steps and run it."
            actionLabel="New recipe"
            onAction={() => setEditingRecipe("new")}
          />
        </div>
      </Show>

      <Show when={hasContent()}>
        <div class="runpane__scroll">
          {/* ── Persisted-run (disk) view — read-only ── */}
          <Show when={persistedRun()}>
            {(run) => (
              <>
                <div class="runpane__head">
                  <div class="runpane__head-copy">
                    <h2 class="runpane__title">{run().action}</h2>
                    <p class="runpane__desc">
                      <span class={`tone tone--${statusTone(run().status as JobInfo["status"])}`}>
                        {run().healed ? "healed" : run().status}
                      </span>{" "}
                      · {n(run().frames.length, "frame")} · saved run
                    </p>
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

                <div class="section-label">Steps</div>
                <For each={run().steps}>
                  {(step, i) => {
                    const tone =
                      step.status === "ok" || step.status === "healed"
                        ? "pass"
                        : step.status === "error"
                          ? "fail"
                          : step.status === "running"
                            ? "run"
                            : "dim";
                    return (
                      <div class="srow srow--static" title={stepTip(step)}>
                        <span class={`snum snum--${tone}`}>{String(i() + 1).padStart(2, "0")}</span>
                        <span class="srow__body">
                          <span class="stitle">{step.title}</span>
                          <span class="smeta">
                            <span class={`tone tone--${tone === "dim" ? "dim" : tone}`}>
                              {step.status ?? "queued"}
                            </span>
                            <Glyphs glyphs={step.glyphs} />
                          </span>
                        </span>
                        <Show when={fmtMs(step.durationMs)}>
                          <span class="srow__dur mono">{fmtMs(step.durationMs)}</span>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </>
            )}
          </Show>

          {/* ── Normal content: header + steps ── */}
          <Show when={!persistedRun() && selectedRecipe()}>
            {/* Pane header — title + Run/Queue + Edit (plan 009 step 4) */}
            <div class="runpane__head">
              <div class="runpane__head-copy">
                <h2 class="runpane__title">{selectedRecipe()!.title}</h2>
                <Show when={selectedRecipe()!.description}>
                  <p class="runpane__desc">{selectedRecipe()!.description}</p>
                </Show>
              </div>
              <div class="runpane__head-actions">
                <Show when={selectedRecipe()!.source === "custom"}>
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
                <button
                  type="button"
                  class="btn btn-acc"
                  disabled={!canRun()}
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
              </div>
            </div>
            {/* Disabled-run reason as visible caption (N2) */}
            <Show when={!canRun() && runDisabledReason()}>
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
              <div class="section-label">Steps</div>
              <For each={selectedJob()!.steps ?? []}>
                {(step, i) => {
                  const tone =
                    step.status === "ok" || step.status === "healed"
                      ? "pass"
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
                        <span class="smeta">
                          <span class={`tone tone--${tone === "dim" ? "dim" : tone}`}>
                            {step.status ?? "queued"}
                          </span>
                          <Glyphs glyphs={step.glyphs} />
                        </span>
                      </span>
                      <Show when={fmtMs(step.durationMs)}>
                        <span class="srow__dur mono">{fmtMs(step.durationMs)}</span>
                      </Show>
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
              <div class="section-label">Steps</div>
              <For each={selectedRecipe()!.steps}>
                {(step, i) => (
                  <div class="srow srow--static" title={describeStep(step)}>
                    <span class="snum snum--dim">{String(i() + 1).padStart(2, "0")}</span>
                    <span class="srow__body">
                      <span class="stitle">{describeStep(step)}</span>
                    </span>
                  </div>
                )}
              </For>
            </Show>

            {/* Builtin recipe step preview (before first run — C1 fix).
                Planned titles live in core's RECIPE_TRACE_PLANS, not exposed
                client-side; each flow step renders as a sentence. */}
            <Show
              when={
                !selectedJob() &&
                selectedRecipe()?.source === "builtin" &&
                (selectedRecipe()?.steps.length ?? 0) > 0
              }
            >
              <div class="section-label">Steps</div>
              <For each={selectedRecipe()!.steps}>
                {(step, i) => (
                  <div class="srow srow--static" title={flowLabel(step)}>
                    <span class="snum snum--dim">{String(i() + 1).padStart(2, "0")}</span>
                    <span class="srow__body">
                      <span class="stitle">{flowLabel(step)}</span>
                    </span>
                  </div>
                )}
              </For>
            </Show>

            {/* Error box */}
            <Show when={selectedJob()?.error}>
              <div class="heal-box heal-box--fail" role="alert" style={{ margin: "8px 0" }}>
                <span class="heal-box__icon" aria-hidden="true">
                  <Icon name="alert" size={12} />
                </span>
                <span>{selectedJob()!.error}</span>
              </div>
            </Show>
          </Show>
        </div>

        {/* ── Collapsible console ── */}
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

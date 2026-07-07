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
 * Steps surface: recipe card + run header + step rows + error box + collapsible
 * console. Shared by the classic tabbed panel (inside its Steps tab) and the
 * deck layout (as the whole right pane). Reads contexts — no props.
 *
 * Plan 008 step 2 extracted this from RunPanel; step 4 added the persisted-run
 * (disk) read-only view folded in from the retired Artifacts tab.
 */
export function StepsPane() {
  const server = useServer();
  const cmd = useCommand();
  const [editingRecipe, setEditingRecipe] = createSignal<RecipeInfo | null>(null);
  const [consoleOpen, setConsoleOpen] = createSignal(false);

  /** The selected recipe (builtin or custom) — the single selection source. */
  const selectedRecipe = createMemo(() => server.selectedRecipe());

  /** ActionInfo metadata for the selected recipe, when it's a builtin (ids match). */
  const selectedMeta = createMemo(() =>
    server.actions().find((a) => a.id === selectedRecipe()?.id),
  );

  const selectedJob = createMemo(
    () => server.jobs().find((j) => j.id === server.selectedJobId()) ?? null,
  );

  /** Persisted-run view (disk runs folded into History by plan 008 step 4).
   *  When a disk run with no matching live job is selected, render its steps
   *  directly — job-selection model is live-only. */
  const persistedRun = createMemo(() => {
    const id = server.persistedRunId();
    if (!id) return null;
    const live = server.jobs().find((j) => j.id === id);
    if (live) return null; // a live job exists — let the normal path render it
    return server.persistedRuns().find((r) => r.id === id) ?? null;
  });

  /** Device display name for the selected job's serial (falls back to serial). */
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

  return (
    <>
      <div class="panel__scroll">
        {/* ── Persisted-run (disk) view — replaces recipe/live content ── */}
        <Show when={persistedRun()}>
          {(run) => (
            <>
              <div class="panel__recipe-card">
                <div class="panel__recipe-card-title">{run().action}</div>
                <p class="panel__recipe-card-desc">
                  <span class={`tone tone--${statusTone(run().status as JobInfo["status"])}`}>
                    {run().healed ? "healed" : run().status}
                  </span>{" "}
                  · {n(run().frames.length, "frame")} · saved run
                </p>
                <div class="panel__recipe-card-actions">
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

        {/* ── Normal content: recipe card + live steps ── */}
        <Show when={!persistedRun()}>
          {/* Recipe card — title + description only, no Run (topbar owns Run) */}
          <Show when={selectedRecipe()}>
            {(r) => (
              <div class="panel__recipe-card">
                <div class="panel__recipe-card-title">{r().title}</div>
                <Show when={r().description}>
                  <p class="panel__recipe-card-desc">{r().description}</p>
                </Show>
                <Show when={r().source === "custom" && r().steps.length > 0}>
                  <p class="panel__recipe-card-desc">
                    {n(r().steps.length, "step")} · custom recipe
                  </p>
                </Show>
                <Show when={r().source === "builtin"}>
                  <p class="panel__recipe-card-desc">Built-in flow</p>
                </Show>
                <Show when={selectedMeta()?.requiresProdMatch && !server.prodAccountMatch()}>
                  <div class="panel__recipe-notice">
                    <span class="panel__recipe-notice-icon" aria-hidden="true">
                      <Icon name="alert" size={14} />
                    </span>
                    <span class="panel__recipe-notice-text">
                      Needs a prod account match (e.g. gmail.com).
                    </span>
                    <button
                      type="button"
                      class="btn btn-ghost"
                      onClick={() => cmd.run("nav.settings")}
                    >
                      Configure
                    </button>
                  </div>
                </Show>
                <div class="panel__recipe-card-actions">
                  <Show when={r().source === "custom"}>
                    <button
                      type="button"
                      class="btn btn-ghost"
                      onClick={() => setEditingRecipe(r())}
                    >
                      <Icon name="sliders" size={13} /> Edit
                    </button>
                  </Show>
                  <Show when={selectedJob()?.status === "error"}>
                    <button
                      type="button"
                      class="btn btn-ghost"
                      onClick={() => void server.retrySelectedJob(selectedJob()!.id)}
                    >
                      <Icon name="refresh" size={13} /> Retry
                    </button>
                  </Show>
                </div>
              </div>
            )}
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
                    ? "Passed ✓"
                    : j().status === "error"
                      ? "Failed ✗"
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

          {/* No recipe selected — inline picker, not dead text */}
          <Show when={!selectedRecipe() && !persistedRun() && !selectedJob()}>
            <div class="panel__pick-recipe">
              <select
                class="panel__pick-select"
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  if (id) server.setSelectedRecipeId(id);
                }}
              >
                <option value="">Choose a recipe…</option>
                <For each={server.recipes()}>{(r) => <option value={r.id}>{r.title}</option>}</For>
              </select>
            </div>
          </Show>

          <Show when={selectedJob()?.error}>
            <div class="heal-box heal-box--fail" role="alert" style={{ margin: "8px 14px" }}>
              <span class="heal-box__icon" aria-hidden="true">
                <Icon name="alert" size={12} />
              </span>
              <span>{selectedJob()!.error}</span>
            </div>
          </Show>
        </Show>
      </div>

      {/* ── Collapsible console (plan 008 step 2) ── */}
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
          <span class="console__label mono">
            {persistedRun()
              ? `DISK · ${persistedRun()!.action}`
              : selectedJob()
                ? `LOG · ${selectedJob()!.action}`
                : selectedRecipe()
                  ? `RECIPE · ${selectedRecipe()!.title}`
                  : "ACTIVITY"}
          </span>
        </button>
        <Show when={consoleOpen()}>
          <pre>{jobLogs() || "— live logs stream here via SSE —"}</pre>
        </Show>
      </div>

      <Show when={editingRecipe()}>
        {(r) => <RecipeEditor recipe={r()} onClose={() => setEditingRecipe(null)} />}
      </Show>
    </>
  );
}

export function RunPanel() {
  const server = useServer();

  /** The selected recipe (builtin or custom) — used in the panel header. */
  const selectedRecipe = createMemo(() => server.selectedRecipe());
  const selectedMeta = createMemo(() =>
    server.actions().find((a) => a.id === selectedRecipe()?.id),
  );

  const stats = createMemo(() => {
    const jobs = server.jobs();
    const ok = jobs.filter((j) => j.status === "ok" && !j.healed).length;
    const fail = jobs.filter((j) => j.status === "error").length;
    const healed = jobs.filter((j) => j.status === "healed" || j.healed).length;
    const run = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
    return { total: jobs.length, ok, fail, healed, run, frames: server.frames().length };
  });

  return (
    <aside class="panel" aria-label="Run panel">
      <div class="panel__head">
        <div class="panel__title-row">
          <h1 class="panel__flow">
            {selectedRecipe()?.title ?? "No recipe selected"}
            <Show when={selectedRecipe() && selectedRecipe()!.id !== selectedRecipe()!.title}>
              <span class="mono panel__flow-id">{selectedRecipe()!.id}</span>
            </Show>
          </h1>
          <Show when={stats().total > 0}>
            <span class="panel__stats">
              <span class="panel__stats-pass">{n(stats().ok, "passed")}</span> ·{" "}
              <span class="panel__stats-fail">{n(stats().fail, "failed")}</span>
              {stats().healed ? (
                <span class="panel__stats-heal"> · {n(stats().healed, "healed")}</span>
              ) : null}
              {stats().run ? ` · ${stats().run} active` : ""}
              {stats().frames ? ` · ${n(stats().frames, "frame")}` : ""}
            </span>
          </Show>
        </div>
        <nav class="tabs-nav" aria-label="Panel tabs">
          {(
            [
              ["summary", "Summary"],
              ["steps", "Steps"],
              ["inspector", "Inspector"],
              ["artifacts", "Artifacts"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              class="tab"
              classList={{ on: server.panelTab() === id }}
              onClick={() => server.setPanelTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <Show when={server.panelTab() === "steps"}>
        <StepsPane />
      </Show>

      <Show when={server.panelTab() === "summary"}>
        <div class="panel__scroll panel__pad">
          <div class="tiles">
            <div class="tile">
              <span class="tile__label">Jobs</span>
              <b class="mono">{stats().total}</b>
            </div>
            <div class="tile">
              <span class="tile__label">Passed</span>
              <b class="mono tile__val--pass">{stats().ok}</b>
            </div>
            <div class="tile">
              <span class="tile__label">Failed</span>
              <b class="mono tile__val--fail">{stats().fail}</b>
            </div>
            <div class="tile">
              <span class="tile__label">Healed</span>
              <b class="mono tile__val--heal">{stats().healed}</b>
            </div>
            <div class="tile">
              <span class="tile__label">Frames</span>
              <b class="mono">{stats().frames}</b>
            </div>
            <div class="tile">
              <span class="tile__label">Disk runs</span>
              <b class="mono">{server.persistedRuns().length}</b>
            </div>
          </div>

          <Show when={stats().healed > 0}>
            <div class="tile tile--wide tile--heal-note">
              <div class="tile__note-row">
                <span class="tile__note-ico" aria-hidden="true">
                  <Icon name="sparkle" size={16} />
                </span>
                <div class="tile__note-body">
                  <span class="tile__note-strong">
                    {n(stats().healed, "step")} self-healed on this session.
                  </span>{" "}
                  Failures were re-run via Retry / heal; successful retries re-record evidence under{" "}
                  <span class="mono">runs/</span>.
                </div>
              </div>
            </div>
          </Show>

          <div class="tile tile--wide">
            <span class="tile__label">Selected recipe</span>
            <div class="mono tile__mono-value">{selectedRecipe()?.id ?? "—"}</div>
            <div class="tile__glyphs">
              <Glyphs glyphs={selectedMeta()?.glyphs} size="md" />
            </div>
            <div class="tile__desc">
              {selectedRecipe()?.description ?? "Pick a recipe in the sidebar, then Run."}
            </div>
          </div>

          <div class="tile tile--wide">
            <span class="tile__label">Device under test</span>
            <div class="mono tile__mono-value">
              {server.selectedDevice() ?? (server.isEmptyDevices() ? "no device" : "—")}
            </div>
          </div>

          <div class="tile tile--wide">
            <span class="tile__label">Runs directory</span>
            <div class="mono tile__path">{server.runsRoot() || "runs/"}</div>
          </div>
        </div>
      </Show>

      <Show when={server.panelTab() === "inspector"}>
        <InspectorBody />
      </Show>

      <Show when={server.panelTab() === "artifacts"}>
        <div class="panel__scroll panel__pad">
          <div class="section-label section-label--flush">Session</div>
          <For
            each={[
              { name: "frames (live)", meta: `${server.frames().length} captures` },
              { name: "jobs (live)", meta: `${server.jobs().length} runs` },
              {
                name: "ui snapshot",
                meta: server.snapshot()
                  ? `${server.snapshot()!.nodes.length} nodes · ${server.snapshot()!.bounds?.width ?? "?"}×${server.snapshot()!.bounds?.height ?? "?"}`
                  : "none",
              },
              {
                name: "overlays",
                meta: server.showOverlays() && server.snapshot()?.bounds ? "enabled" : "off",
              },
            ]}
          >
            {(row) => (
              <div class="tile tile--row">
                <span class="mono tile__row-name">{row.name}</span>
                <span class="mono tile__row-meta">{row.meta}</span>
              </div>
            )}
          </For>

          <div class="section-label section-label--flush-top">Disk · runs/</div>
          <button
            type="button"
            class="btn btn-ghost artifacts-refresh"
            disabled={server.isOffline()}
            onClick={() => void server.refreshRuns()}
          >
            <Icon name="refresh" size={14} />
            Refresh disk runs
          </button>

          <Show
            when={server.persistedRuns().length > 0}
            fallback={
              <EmptyState
                size="sm"
                icon="artifact"
                title="No saved runs"
                description="Completed runs are saved here with their frames and logs."
              />
            }
          >
            <For each={server.persistedRuns()}>
              {(run) => (
                <button
                  type="button"
                  class="tile tile--row"
                  onClick={() => {
                    const live = server.jobs().find((j) => j.id === run.id);
                    if (live) server.jumpToJob(live.id);
                    server.appendLog(`disk run ${run.dir}`, "info");
                  }}
                >
                  <span class="tile__run-body">
                    <span class="mono tile__run-action">{run.action}</span>
                    <span class="mono tile__run-meta">
                      {run.status}
                      {run.healed ? " · healed" : ""}
                      {" · "}
                      {run.frames?.length ?? 0} frames
                      {" · "}
                      {run.id.slice(0, 8)}
                    </span>
                    <span class="mono tile__path tile__path--inline">{run.dir}</span>
                  </span>
                  <span class={`tone tone--${statusTone(run.status as JobInfo["status"])}`}>
                    {run.healed ? "healed" : run.status}
                  </span>
                </button>
              )}
            </For>
          </Show>

          <p class="artifacts-note">
            Plain files under{" "}
            <span class="mono">{server.runsRoot() || "runs/<ts>_<action>_<device>_<id>/"}</span>—{" "}
            <span class="mono">run.json</span>, <span class="mono">log.txt</span>,{" "}
            <span class="mono">frames/*.png</span>.
          </p>
        </div>
      </Show>
    </aside>
  );
}

function InspectorBody() {
  const server = useServer();
  const nodes = createMemo(() => server.snapshot()?.nodes.slice(0, 200) ?? []);

  return (
    <div class="panel__scroll">
      <div class="panel__pad panel__pad--tight">
        <button
          type="button"
          class="btn btn-acc inspector-capture"
          disabled={server.busyCapture() || server.health() !== "online" || server.isEmptyDevices()}
          title={
            server.health() !== "online"
              ? "Server offline"
              : server.isEmptyDevices()
                ? "No device connected"
                : "Capture accessibility tree"
          }
          onClick={() => void server.captureUiSnapshot()}
        >
          <Show
            when={server.busyCapture()}
            fallback={
              <>
                <Icon name="scan" size={14} /> Capture UI snapshot
              </>
            }
          >
            <span class="btn-spinner" aria-hidden="true" />
            Capturing…
          </Show>
        </button>
      </div>
      <Show
        when={server.snapshot()}
        fallback={
          <EmptyState
            size="sm"
            icon="info"
            title="No snapshot yet"
            description="Capture a snapshot to inspect the accessibility tree and draw hit-rects on the stage. Click a node to press it on-device."
          />
        }
      >
        <For each={nodes()}>
          {(n) => {
            const label = () => (n.label ?? n.value ?? n.identifier ?? "(unnamed)").trim();
            return (
              <button type="button" class="inspector-row" onClick={() => void server.pressNode(n)}>
                <span class="inspector-row__hit">{n.hittable ? "●" : "○"}</span>
                <span class="inspector-row__label">{label()}</span>
                <span class="inspector-row__meta mono">
                  {n.ref ? (n.ref.startsWith("@") ? n.ref : `@${n.ref}`) : ""}
                </span>
              </button>
            );
          }}
        </For>
      </Show>
    </div>
  );
}

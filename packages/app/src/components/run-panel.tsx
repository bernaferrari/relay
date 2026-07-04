import { For, Show, createMemo } from "solid-js";
import { useServer, type ActionInfo, type JobInfo } from "../context/server";
import { Glyphs } from "./glyphs";
import { EmptyState } from "./empty-state";

function statusTone(status: JobInfo["status"] | "idle") {
  if (status === "ok") return "pass";
  if (status === "healed") return "heal";
  if (status === "error") return "fail";
  if (status === "running" || status === "queued") return "run";
  return "dim";
}

function fmtDur(job: JobInfo) {
  const end =
    job.finishedAt ?? (job.status === "running" ? Date.now() : (job.startedAt ?? job.queuedAt));
  const start = job.startedAt ?? job.queuedAt;
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function RunPanel() {
  const server = useServer();

  const selectedMeta = createMemo(() =>
    server.actions().find((a) => a.id === server.selectedAction()),
  );

  const selectedJob = createMemo(
    () => server.jobs().find((j) => j.id === server.selectedJobId()) ?? null,
  );

  const jobLogs = createMemo(() => {
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

  const stats = createMemo(() => {
    const jobs = server.jobs();
    const ok = jobs.filter((j) => j.status === "ok").length;
    const fail = jobs.filter((j) => j.status === "error").length;
    const healed = jobs.filter((j) => j.status === "healed" || j.healed).length;
    const run = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
    return { total: jobs.length, ok, fail, healed, run, frames: server.frames().length };
  });

  const groups = createMemo(() => {
    const byCat = new Map<string, ActionInfo[]>();
    for (const a of server.actions()) {
      const list = byCat.get(a.category) ?? [];
      list.push(a);
      byCat.set(a.category, list);
    }
    return [...byCat.entries()];
  });

  return (
    <aside class="panel" aria-label="Run panel">
      <div class="panel__head">
        <div class="panel__title-row">
          <h1 class="mono panel__flow">{server.selectedAction() ?? "ready"}</h1>
          <span class="panel__stats">
            {stats().ok} passed · {stats().fail} failed
            {stats().healed ? (
              <span class="panel__stats-heal"> · {stats().healed} healed</span>
            ) : null}
            {stats().run ? ` · ${stats().run} active` : ""}
            {stats().frames ? ` · ${stats().frames} frames` : ""}
          </span>
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
        <div class="panel__scroll">
          <div class="section-label">Recipes</div>
          <Show
            when={server.actions().length > 0}
            fallback={
              <EmptyState
                size="sm"
                icon="run"
                title={server.isOffline() ? "Server offline" : "No recipes loaded"}
                description={
                  server.isOffline()
                    ? "Start the API to load available recipes."
                    : "Actions will appear here when the server is online."
                }
                actionLabel="Retry"
                onAction={() => void server.retryConnection()}
              />
            }
          >
            <For each={groups()}>
              {([category, actions]) => (
                <div class="action-block">
                  <div class="section-label section-label--sub">{category}</div>
                  <For each={actions}>
                    {(a, i) => {
                      const job = () => server.jobs().find((j) => j.action === a.id);
                      const on = () => server.selectedAction() === a.id;
                      return (
                        <button
                          type="button"
                          class="srow"
                          classList={{ on: on() }}
                          onClick={() => server.setSelectedAction(a.id)}
                          onDblClick={() => {
                            server.setSelectedAction(a.id);
                            void server.runSelected();
                          }}
                        >
                          <span class="snum">{String(i() + 1).padStart(2, "0")}</span>
                          <span class="srow__body">
                            <span class="smeta">
                              <span class={`tone tone--${a.category === "grok" ? "acc" : "dim"}`}>
                                {a.category === "grok" ? "App" : "Store"}
                              </span>
                              <span>·</span>
                              <span class="mono">{a.id}</span>
                              <span class="smeta__rule" />
                              <Glyphs glyphs={a.glyphs} />
                              <Show when={job()}>
                                <span>·</span>
                                <span class={`tone tone--${statusTone(job()!.status)}`}>
                                  {job()!.status}
                                </span>
                                <span class="mono">{fmtDur(job()!)}</span>
                              </Show>
                            </span>
                            <span class="stitle">{a.title}</span>
                            <Show when={on() && a.description}>
                              <span class="sdesc">{a.description}</span>
                            </Show>
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
          </Show>

          <div class="section-label" style={{ "margin-top": "1rem" }}>
            Run history
          </div>
          <Show
            when={server.jobs().length > 0}
            fallback={
              <EmptyState
                size="sm"
                icon="run"
                title="No runs yet"
                description="Pick a recipe and press Run — steps and evidence land here."
              />
            }
          >
            <For each={server.jobs()}>
              {(j, i) => (
                <button
                  type="button"
                  class="srow"
                  classList={{ on: server.selectedJobId() === j.id }}
                  onClick={() => server.jumpToJob(j.id)}
                >
                  <span class={`snum snum--${statusTone(j.status)}`}>
                    {String(i() + 1).padStart(2, "0")}
                  </span>
                  <span class="srow__body">
                    <span class="smeta">
                      <span class={`tone tone--${statusTone(j.status)}`}>
                        {j.kind ?? (j.healed ? "Healed" : "Replay")}
                      </span>
                      <span>·</span>
                      <span class="mono">{fmtDur(j)}</span>
                      <span class="smeta__rule" />
                      <Glyphs glyphs={j.glyphs ?? j.steps?.[0]?.glyphs} />
                      <Show when={(j.attempts ?? 1) > 1}>
                        <span class="mono">×{j.attempts}</span>
                      </Show>
                    </span>
                    <span class="stitle">{j.title ?? j.action}</span>

                    <Show
                      when={
                        (j.healed || j.status === "healed" || j.healMessage) &&
                        server.selectedJobId() === j.id
                      }
                    >
                      <span class="heal-box" role="status">
                        <span class="heal-box__icon" aria-hidden="true">
                          ⚠
                        </span>
                        <span>
                          {j.healMessage ?? "Step self-healed on retry."}{" "}
                          <span class="mono heal-box__meta">attempt {j.attempts}</span>
                        </span>
                      </span>
                    </Show>

                    <Show when={j.status === "error" && server.selectedJobId() === j.id}>
                      <span class="heal-box heal-box--fail" role="alert">
                        <span class="heal-box__icon" aria-hidden="true">
                          !
                        </span>
                        <span>
                          {j.error}
                          <div class="heal-box__actions">
                            <button
                              type="button"
                              class="mono link-heal"
                              onClick={(e) => {
                                e.stopPropagation();
                                void server.retrySelectedJob(j.id);
                              }}
                            >
                              Retry / heal →
                            </button>
                          </div>
                        </span>
                      </span>
                    </Show>
                  </span>
                  <span class="srow__frames mono">
                    {j.frames?.length ||
                      server.frames().filter((f) => f.jobId === j.id).length ||
                      "·"}
                    <span class="srow__frames-ico" aria-hidden="true">
                      🎞
                    </span>
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>

        <div class="console">
          <div class="console__label mono">
            {selectedJob()
              ? `STEP ${String(selectedJob()!.steps?.length ?? 1).padStart(2, "0")} · LOG`
              : selectedMeta()
                ? `ACTION · ${selectedMeta()!.id}`
                : "ACTIVITY"}
          </div>
          <pre>{jobLogs() || "— live logs stream here via SSE —"}</pre>
        </div>
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
                  ✦
                </span>
                <div class="tile__note-body">
                  <span class="tile__note-strong">
                    {stats().healed} step{stats().healed === 1 ? "" : "s"} self-healed on this
                    session.
                  </span>{" "}
                  Failures were re-run via Retry / heal; successful retries re-record evidence under{" "}
                  <span class="mono">runs/</span>.
                </div>
              </div>
            </div>
          </Show>

          <div class="tile tile--wide">
            <span class="tile__label">Selected recipe</span>
            <div class="mono tile__mono-value">{selectedMeta()?.id ?? "—"}</div>
            <div class="tile__glyphs">
              <Glyphs glyphs={selectedMeta()?.glyphs} size="md" />
            </div>
            <div class="tile__desc">
              {selectedMeta()?.description ?? "Pick a step on the Steps tab, then Run."}
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

          <label class="check-row">
            <input
              type="checkbox"
              checked={server.skipAccountSwitch()}
              onChange={(e) => server.setSkipAccountSwitch(e.currentTarget.checked)}
            />
            Skip Play account ensure
          </label>
          <label class="check-row">
            <input
              type="checkbox"
              checked={server.skipRestoreHome()}
              onChange={(e) => server.setSkipRestoreHome(e.currentTarget.checked)}
            />
            Skip restore home after alpha
          </label>
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
            Refresh disk runs
          </button>

          <Show
            when={server.persistedRuns().length > 0}
            fallback={
              <EmptyState
                size="sm"
                icon="artifact"
                title="No disk runs yet"
                description="Finish a job to write run.json and frames to disk."
                code={server.runsRoot() || "runs/<ts>_<action>_<device>_<id>/"}
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
          <Show when={server.busyCapture()} fallback="Capture UI snapshot">
            <span class="btn-spinner" aria-hidden="true" />
            Capturing…
          </Show>
        </button>
        <label class="check-row">
          <input
            type="checkbox"
            checked={server.showOverlays()}
            onChange={(e) => server.setShowOverlays(e.currentTarget.checked)}
          />
          Show rect overlays on phone glass
        </label>
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
